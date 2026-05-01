/**
 * Cache shim — implements `actions/cache@v3/4`, plus the split
 * `actions/cache/restore` and `actions/cache/save` variants.
 *
 * Outputs:
 *   cache-hit:        "true" on exact match, "false" otherwise (matching GH)
 *   cache-primary-key (restore-only): the key requested
 *   cache-matched-key (restore-only): the key actually matched (may be a
 *                     restore-key prefix match, in which case cache-hit
 *                     is "false" but the path is still populated)
 */
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { LocalCache, parsePaths } from '../cache.js';
import type { JobSession, PlannedStep, StepResult } from '../types.js';

type Mode = 'restore-and-save' | 'restore' | 'save';

export async function cacheShim(step: PlannedStep, session: JobSession, mode: Mode): Promise<StepResult> {
  const t0 = performance.now();
  const key = String(step.with.key ?? '');
  if (!key) {
    return { label: step.label, status: 'failure', durationMs: 0, outputs: {}, reason: 'cache: missing key' };
  }
  const paths = parsePaths(step.with.path);
  const restoreKeys = parsePaths(step.with['restore-keys']);
  const cacheRoot = resolve(session.hostCwd, '.runner', 'cache');
  const cache = new LocalCache(cacheRoot);

  if (mode === 'save') {
    const saved = cache.save(key, session.hostCwd, paths);
    return {
      label: step.label,
      status: 'success',
      durationMs: performance.now() - t0,
      outputs: {},
      reason: saved ? `saved cache: ${key}` : `key already exists: ${key}`,
    };
  }

  // restore or restore-and-save
  const result = cache.resolve(key, restoreKeys);
  const outputs: Record<string, string> = {
    'cache-hit': result.hit === 'exact' ? 'true' : 'false',
    'cache-primary-key': key,
  };
  if (result.matchedKey) outputs['cache-matched-key'] = result.matchedKey;

  if (result.hit !== 'miss' && result.matchedKey) {
    cache.restore(result.matchedKey, session.hostCwd);
  }

  // Auto-save on cache miss for restore-and-save mode (the default behavior
  // of `actions/cache@v4` is post-action). We approximate by saving now if
  // the path exists; in practice steps after a miss populate the path and
  // a separate `actions/cache/save` step (or post hook) would persist it.
  // Keep the write path explicit by NOT auto-saving here — matching the
  // split-action contract is cleaner.

  return {
    label: step.label,
    status: 'success',
    durationMs: performance.now() - t0,
    outputs,
    reason: result.hit === 'exact'
      ? `cache hit (exact): ${key}`
      : result.hit === 'partial'
        ? `cache hit (restore-key): ${result.matchedKey}`
        : `cache miss: ${key}`,
  };
}
