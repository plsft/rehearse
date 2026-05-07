/**
 * Shared content-addressed cache for fetched action repos.
 *
 * Pre-v0.6.16 every JS-action and remote-composite was cloned per-repo into
 * `<cwd>/.runner/actions/<slug>/`. Popular actions (`actions/checkout`,
 * `actions/setup-node`, `actions/cache`, `actions/upload-artifact`) got
 * re-cloned every time you ran `rh` from a new repo, costing ~2-5s of git
 * fetch each. This moves the cache to a user-wide directory so the second
 * run from any repo on the same host is a no-op resolve.
 *
 * Layout: `<cacheRoot>/<owner>__<repo>__<ref>/` — same slug as before.
 *
 * Override with `REHEARSE_ACTIONS_CACHE=/path/to/dir`. Falls back to the
 * legacy `<repoRoot>/.runner/actions/` if HOME isn't writable (CI sandboxes,
 * read-only HOME on some Windows configs).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

let resolvedRoot: string | null = null;

/**
 * Resolve the cache root once per process, with fallback if HOME is unusable.
 * Memoised so we don't re-stat on every action lookup.
 */
export function actionsCacheRoot(repoRoot: string): string {
  if (resolvedRoot !== null) return resolvedRoot;

  const env = process.env.REHEARSE_ACTIONS_CACHE;
  if (env && env.trim().length > 0) {
    if (tryEnsure(env)) return (resolvedRoot = env);
  }

  const home = homedir();
  if (home) {
    const candidate = resolve(home, '.rehearse', 'actions-cache');
    if (tryEnsure(candidate)) return (resolvedRoot = candidate);
  }

  // Last-resort fallback: per-repo, pre-v0.6.16 layout. Don't memoise this
  // one — different repoRoots should each get their own.
  const fallback = resolve(repoRoot, '.runner', 'actions');
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

function tryEnsure(dir: string): boolean {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** Slugify a `<owner>/<repo>@<ref>` triple to a directory name. */
export function actionSlug(owner: string, repo: string, ref: string): string {
  return `${owner}__${repo}__${ref}`.replace(/[^A-Za-z0-9_.-]+/g, '_');
}

/** Test-only: clear the memoised root so a new env var can take effect. */
export function _resetCacheRootForTests(): void {
  resolvedRoot = null;
}
