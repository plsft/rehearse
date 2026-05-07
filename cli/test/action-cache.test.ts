/**
 * v0.6.16: shared action cache.
 *
 * Pre-v0.6.16 every JS-action and remote composite was cloned per-repo into
 * `<cwd>/.runner/actions/<slug>/`. Now lives at user-wide
 * ~/.rehearse/actions-cache/ (overridable via REHEARSE_ACTIONS_CACHE) so
 * popular actions are fetched once per host instead of once per repo.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actionSlug, actionsCacheRoot, _resetCacheRootForTests } from '../src/runner/action-cache.js';

let tmp: string;
let savedEnv: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'action-cache-'));
  savedEnv = process.env.REHEARSE_ACTIONS_CACHE;
  _resetCacheRootForTests();
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.REHEARSE_ACTIONS_CACHE;
  else process.env.REHEARSE_ACTIONS_CACHE = savedEnv;
  _resetCacheRootForTests();
  rmSync(tmp, { recursive: true, force: true });
});

describe('actionSlug', () => {
  it('produces a deterministic, filesystem-safe slug', () => {
    expect(actionSlug('actions', 'checkout', 'v4')).toBe('actions__checkout__v4');
  });

  it('replaces unsafe characters', () => {
    // Tag like `release/v1.2` or a SHA — the / and any other non-alphanumeric
    // gets collapsed.
    expect(actionSlug('actions', 'checkout', 'release/v1.2')).toBe('actions__checkout__release_v1.2');
  });
});

describe('actionsCacheRoot', () => {
  it('honors REHEARSE_ACTIONS_CACHE env var', () => {
    process.env.REHEARSE_ACTIONS_CACHE = tmp;
    expect(actionsCacheRoot('/some/repo')).toBe(tmp);
    expect(existsSync(tmp)).toBe(true);
  });

  it('memoises within a process — second call returns same root', () => {
    process.env.REHEARSE_ACTIONS_CACHE = tmp;
    const a = actionsCacheRoot('/some/repo');
    // Even if env changes mid-process, we keep the resolved root.
    process.env.REHEARSE_ACTIONS_CACHE = '/different/dir';
    const b = actionsCacheRoot('/some/repo');
    expect(b).toBe(a);
  });

  it('falls back to user-wide ~/.rehearse/actions-cache when env unset', () => {
    delete process.env.REHEARSE_ACTIONS_CACHE;
    const root = actionsCacheRoot('/some/repo');
    // Match the layout, not the exact path (which depends on $HOME).
    expect(root).toMatch(/[\\/]\.rehearse[\\/]actions-cache$/);
  });
});
