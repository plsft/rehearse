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
 *
 * v0.6.19 (P7): bundled-action prewarming. The `bundled-actions/`
 * directory inside `@rehearse/cli`'s npm tarball ships a small set of
 * pre-fetched JS actions at canonical refs. On resolve, callers can
 * check the bundled tree FIRST and copy into the user-wide cache,
 * skipping the network round-trip on a cold host. See bundledActionPath().
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * Path to the bundled-actions tree inside the @rehearse/cli npm tarball.
 * The tree lives at `cli/bundled-actions/` in the source repo and ships
 * at the same relative path post-publish. Each direct child is a slug-
 * named directory containing the action.yml + any `dist/` files the
 * action's `runs.main` references — i.e. a usable, pre-fetched action
 * checkout that the resolver can copy in lieu of `git clone`.
 *
 * Returns null if the bundle directory doesn't exist (e.g. running
 * from a dev checkout where no actions have been bundled yet) or if the
 * import.meta.url tracking can't locate it (vitest pool quirks, etc.).
 */
let resolvedBundleRoot: string | null | undefined;
export function bundledActionRoot(): string | null {
  if (resolvedBundleRoot !== undefined) return resolvedBundleRoot;
  try {
    // dist/runner/action-cache.js → cli/bundled-actions/
    // (3 levels up from the compiled file path).
    const here = dirname(fileURLToPath(import.meta.url));
    const candidate = resolve(here, '..', '..', 'bundled-actions');
    resolvedBundleRoot = existsSync(candidate) ? candidate : null;
  } catch {
    resolvedBundleRoot = null;
  }
  return resolvedBundleRoot;
}

/**
 * Look up a (owner, repo, ref) in the bundled tree. Returns the absolute
 * path to the bundled action directory if a matching slug exists, null
 * otherwise. The slug must be EXACT — we don't fuzzy-match refs (a
 * customer asking for `@v4.1.0` doesn't get our bundled `@v4` even if
 * that's "close enough"; that level of trust requires real ref
 * resolution we don't do here).
 */
export function bundledActionPath(owner: string, repo: string, ref: string): string | null {
  const root = bundledActionRoot();
  if (!root) return null;
  const slug = actionSlug(owner, repo, ref);
  const candidate = resolve(root, slug);
  if (!existsSync(candidate)) return null;
  // Sanity check: an action.yml MUST be at the root. Without it the
  // bundled directory is malformed and the JS-action runtime would
  // explode trying to read it. Better to fall back to git-clone.
  const actionYml = resolve(candidate, 'action.yml');
  const actionYaml = resolve(candidate, 'action.yaml');
  if (!existsSync(actionYml) && !existsSync(actionYaml)) return null;
  return candidate;
}

/**
 * Materialize a bundled action into the user-wide cache. Copies the
 * pre-fetched tree from `bundled-actions/<slug>/` to
 * `<cacheRoot>/<slug>/`. After this, subsequent resolves go through
 * the normal cache-hit path; downstream code can't tell whether the
 * cache was populated from npm-bundled bytes or a git clone.
 *
 * Returns the destination path on success, null if the bundled action
 * doesn't exist or the copy failed (caller falls back to git-clone).
 *
 * Why copy instead of symlink / share-readonly: each customer's cache
 * is mutable (e.g. a pre-cli step that writes a package.json shim into
 * the action root, see js-action.ts). Symlinking the bundled tree would
 * let a runtime mutation leak across processes / corrupt the bundle.
 */
export function materializeBundledAction(
  owner: string,
  repo: string,
  ref: string,
  cacheRoot: string,
): string | null {
  const src = bundledActionPath(owner, repo, ref);
  if (!src) return null;
  const slug = actionSlug(owner, repo, ref);
  const dest = resolve(cacheRoot, slug);
  if (existsSync(dest)) return dest; // already cached, no-op
  try {
    mkdirSync(cacheRoot, { recursive: true });
    cpSync(src, dest, { recursive: true });
    return dest;
  } catch {
    return null;
  }
}

/**
 * Test-only: list the slugs currently in the bundled tree. Useful for
 * tests that need to know what's bundled without parsing the directory.
 */
export function _listBundledSlugsForTests(): string[] {
  const root = bundledActionRoot();
  if (!root) return [];
  try {
    return readdirSync(root).filter(
      (name) => name !== '.' && name !== '..' && !name.startsWith('.'),
    );
  } catch {
    return [];
  }
}
