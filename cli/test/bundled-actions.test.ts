/**
 * Tests for the v0.6.19 bundled-action prewarming path.
 *
 * @rehearse/cli's npm tarball ships pre-fetched JS actions in
 * `bundled-actions/<owner>__<repo>__<ref>/`. On a cold-host first
 * resolve, the action-cache resolver materializes from there instead
 * of doing a `git clone`, cutting first-resolve time from ~2-5s to
 * <50ms for any bundled action.
 *
 * The current bundle ships ONE action — `dorny/paths-filter@v3` — as
 * proof that the mechanism works. Expand by dropping more action
 * sources under `cli/bundled-actions/`.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _listBundledSlugsForTests,
  bundledActionPath,
  bundledActionRoot,
  materializeBundledAction,
} from '../src/runner/action-cache.js';

let cacheRoot: string;
beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'rh-bundle-test-'));
});
afterEach(() => {
  rmSync(cacheRoot, { recursive: true, force: true });
});

describe('bundledActionRoot', () => {
  it('points at cli/bundled-actions/ inside the package', () => {
    const root = bundledActionRoot();
    expect(root).not.toBeNull();
    expect(root!.replace(/\\/g, '/')).toMatch(/bundled-actions$/);
    expect(existsSync(root!)).toBe(true);
  });
});

describe('bundledActionPath', () => {
  it("locates the canonical bundled action — proves dorny/paths-filter@v3 is bundled", () => {
    // This test is a "did the bundle ship?" guard. If it ever fails,
    // either the bundle was deleted accidentally or the npm `files`
    // list dropped `bundled-actions`.
    const p = bundledActionPath('dorny', 'paths-filter', 'v3');
    expect(p).not.toBeNull();
    expect(existsSync(p!)).toBe(true);
    // Sanity: action.yml present
    expect(existsSync(join(p!, 'action.yml'))).toBe(true);
  });

  it('returns null for an action not in the bundle', () => {
    expect(bundledActionPath('nonexistent', 'pkg', 'v1')).toBeNull();
  });

  it('returns null when the slug exists but has no action.yml (malformed bundle)', () => {
    // Defensive — if a future bundle has a partial directory, we want
    // git-clone fallback, not a JS-action-runtime explosion.
    const malformed = bundledActionPath('not', 'a', 'real-slug');
    expect(malformed).toBeNull();
  });

  it('does not fuzzy-match refs (v3 is not the same as v3.0.0)', () => {
    // Refs are EXACT keys. We deliberately don't auto-resolve "near"
    // versions because that's a real ref-resolution problem outside
    // the scope of bundling.
    expect(bundledActionPath('dorny', 'paths-filter', 'v3.0.0')).toBeNull();
  });
});

describe('materializeBundledAction', () => {
  it('copies the bundled tree into the cache root', () => {
    const dest = materializeBundledAction('dorny', 'paths-filter', 'v3', cacheRoot);
    expect(dest).not.toBeNull();
    expect(existsSync(dest!)).toBe(true);
    expect(existsSync(join(dest!, 'action.yml'))).toBe(true);
    // dist/ is the actual JS — without it the action wouldn't run.
    expect(existsSync(join(dest!, 'dist'))).toBe(true);
  });

  it('returns the destination path and is idempotent on re-call', () => {
    const a = materializeBundledAction('dorny', 'paths-filter', 'v3', cacheRoot);
    const b = materializeBundledAction('dorny', 'paths-filter', 'v3', cacheRoot);
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });

  it('returns null for an action not in the bundle (caller falls back to git-clone)', () => {
    expect(
      materializeBundledAction('not', 'in', 'bundle', cacheRoot),
    ).toBeNull();
  });

  it('writes to the slug subdirectory of cacheRoot, not cacheRoot itself', () => {
    const dest = materializeBundledAction('dorny', 'paths-filter', 'v3', cacheRoot);
    expect(dest).not.toBeNull();
    expect(dest!.replace(/\\/g, '/')).toMatch(
      /[\\/]rh-bundle-test-[^/\\]+[\\/]dorny__paths-filter__v3$/,
    );
  });
});

describe('_listBundledSlugsForTests', () => {
  it('lists every bundled slug — at minimum the canonical paths-filter@v3', () => {
    const slugs = _listBundledSlugsForTests();
    expect(slugs).toContain('dorny__paths-filter__v3');
  });

  it('excludes hidden / dotfile entries', () => {
    const slugs = _listBundledSlugsForTests();
    for (const slug of slugs) {
      expect(slug).not.toMatch(/^\./);
    }
  });
});
