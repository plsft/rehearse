/**
 * Per-cell scratch-cache injection for matrix runs.
 *
 * Validates the v0.5.4 fix for the npm/yarn/pip race that surfaced on
 * fastify CI on Windows: 9 matrix cells doing parallel `npm install`
 * collide on `~/.npm/_cacache` tar-atomic-rename. Race-prone caches
 * isolated per cell; content-addressed (pnpm/bun/cargo/Go) shared.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HostBackend } from '../src/runner/backends/host.js';
import type { PlannedJob } from '../src/runner/types.js';

const tempRoots: string[] = [];
function mkRoot(): string {
  const d = mkdtempSync(resolve(tmpdir(), 'rehearse-cell-cache-'));
  tempRoots.push(d);
  return d;
}
afterEach(() => {
  for (const d of tempRoots.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeJob(opts: { matrix?: Record<string, unknown> } = {}): PlannedJob {
  return {
    id: 'test_job_id',
    jobKey: 'test',
    jobName: 'test',
    raw: { 'runs-on': 'ubuntu-latest', steps: [] },
    matrixCell: opts.matrix,
    needs: [],
    env: {},
    steps: [],
    backend: 'host',
    runsOn: 'ubuntu-latest',
  };
}

describe('host backend — per-cell scratch caches', () => {
  it('injects per-cell cache env vars for matrix cells', async () => {
    const root = mkRoot();
    const backend = new HostBackend({ worktreeForMatrix: false });
    const session = await backend.prepare({
      jobId: 'test:cell-abc123',
      hostCwd: root,
      job: makeJob({ matrix: { node: '20', os: 'windows-latest' } }),
    });

    // Race-prone managers — isolated per cell (path includes the safe job id).
    expect(session.env.npm_config_cache).toContain('test_cell-abc123');
    expect(session.env.npm_config_cache).toContain('npm');
    expect(session.env.YARN_CACHE_FOLDER).toContain('test_cell-abc123');
    expect(session.env.PIP_CACHE_DIR).toContain('test_cell-abc123');

    // Directories exist so package managers don't race on creation.
    expect(existsSync(session.env.npm_config_cache!)).toBe(true);
    expect(existsSync(session.env.YARN_CACHE_FOLDER!)).toBe(true);
    expect(existsSync(session.env.PIP_CACHE_DIR!)).toBe(true);

    // Content-addressed managers (pnpm/bun/cargo/Go) are NOT redirected —
    // they're parallel-safe and their user-global cache is reused.
    // Setting npm_config_store_dir would trigger an npm warning.
    expect(session.env.npm_config_store_dir).toBeUndefined();
    expect(session.env.BUN_INSTALL_CACHE_DIR).toBeUndefined();
    expect(session.env.CARGO_HOME).toBeUndefined();
    expect(session.env.GOMODCACHE).toBeUndefined();
    expect(session.env.GOCACHE).toBeUndefined();

    await backend.teardown(session);
  });

  it('does NOT inject cache env vars for non-matrix jobs (drop-in compat)', async () => {
    const root = mkRoot();
    const backend = new HostBackend({ worktreeForMatrix: false });
    const session = await backend.prepare({
      jobId: 'simple-job',
      hostCwd: root,
      job: makeJob(),
    });
    expect(session.env.npm_config_cache).toBeUndefined();
    expect(session.env.YARN_CACHE_FOLDER).toBeUndefined();
    expect(session.env.PIP_CACHE_DIR).toBeUndefined();
    await backend.teardown(session);
  });

  it('different cells get different per-cell paths (isolated writes)', async () => {
    const root = mkRoot();
    const backend = new HostBackend({ worktreeForMatrix: false });

    const cellA = await backend.prepare({
      jobId: 'test:node_18_os_ubuntu',
      hostCwd: root,
      job: makeJob({ matrix: { node: '18', os: 'ubuntu-latest' } }),
    });
    const cellB = await backend.prepare({
      jobId: 'test:node_20_os_windows',
      hostCwd: root,
      job: makeJob({ matrix: { node: '20', os: 'windows-latest' } }),
    });

    // Race-prone caches MUST diverge between cells — that's the entire fix.
    expect(cellA.env.npm_config_cache).not.toBe(cellB.env.npm_config_cache);
    expect(cellA.env.YARN_CACHE_FOLDER).not.toBe(cellB.env.YARN_CACHE_FOLDER);
    expect(cellA.env.PIP_CACHE_DIR).not.toBe(cellB.env.PIP_CACHE_DIR);

    await backend.teardown(cellA);
    await backend.teardown(cellB);
  });

  it('per-cell paths are deterministic across runs (warm-cache reuse)', async () => {
    const root = mkRoot();
    const backend = new HostBackend({ worktreeForMatrix: false });

    const run1 = await backend.prepare({
      jobId: 'test:node_18_os_ubuntu',
      hostCwd: root,
      job: makeJob({ matrix: { node: '18', os: 'ubuntu-latest' } }),
    });
    await backend.teardown(run1);
    const run2 = await backend.prepare({
      jobId: 'test:node_18_os_ubuntu',
      hostCwd: root,
      job: makeJob({ matrix: { node: '18', os: 'ubuntu-latest' } }),
    });
    expect(run1.env.npm_config_cache).toBe(run2.env.npm_config_cache);
    await backend.teardown(run2);
  });

  it('sanitizes job id with special characters into safe path components', async () => {
    const root = mkRoot();
    const backend = new HostBackend({ worktreeForMatrix: false });
    const session = await backend.prepare({
      jobId: 'test:os=windows-latest,node=20',
      hostCwd: root,
      job: makeJob({ matrix: { node: '20', os: 'windows-latest' } }),
    });
    // No raw `:` or `=` in the cache path — those are unsafe on Windows.
    expect(session.env.npm_config_cache).not.toMatch(/:[^\\/]/);
    expect(session.env.npm_config_cache).not.toContain('=');
    expect(existsSync(session.env.npm_config_cache!)).toBe(true);
    await backend.teardown(session);
  });
});
