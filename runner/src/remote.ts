/**
 * --remote helpers — git-context auto-detection so the same workflow that
 * runs locally can ship to a Pro sprite and clone the right source.
 */
import { spawnSync } from 'node:child_process';
import { relative, sep } from 'node:path';

export interface GitContext {
  repoUrl: string | null;
  repoRef: string | null;
  /** Path of cwd relative to the git toplevel, POSIX-separated. Empty string when cwd === toplevel. */
  repoSubdir: string | null;
}

/**
 * Detect git remote + current SHA + subpath from `cwd` so the sprite can
 * clone the exact same source AND `cd` into the right subdirectory before
 * running the workflow. Returns nulls (not throws) if cwd isn't a git repo
 * or `origin` isn't set — the remote run can still proceed, just without
 * checkout.
 *
 * Why subpath: monorepos. If the customer runs `runner run --remote` from
 * `<repo>/services/api/` and the workflow does `npm install`, the daemon
 * needs to be in `<clone>/services/api/` — not the clone root.
 *
 * SSH URLs are normalized to HTTPS because the sprite has no SSH key. If
 * REHEARSE_REPO_TOKEN / GH_TOKEN / GITHUB_TOKEN is set, it's embedded into
 * the URL as `https://x-access-token:<tok>@host/...` so private repos work.
 * The token is redacted from any log output by `redactToken`.
 */
export function detectGitContext(cwd: string): GitContext {
  const remoteRaw = git(['remote', 'get-url', 'origin'], cwd);
  const sha = git(['rev-parse', 'HEAD'], cwd);
  const toplevel = git(['rev-parse', '--show-toplevel'], cwd)?.trim();
  const repoSubdir = toplevel
    ? relative(toplevel, cwd).split(sep).join('/') || null
    : null;
  if (!remoteRaw) return { repoUrl: null, repoRef: sha?.trim() ?? null, repoSubdir };

  let url = normalizeRemoteUrl(remoteRaw.trim());
  const token =
    process.env.REHEARSE_REPO_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
  if (token && url.startsWith('https://')) {
    url = url.replace('https://', `https://x-access-token:${token}@`);
  }
  return { repoUrl: url, repoRef: sha?.trim() ?? null, repoSubdir };
}

function git(args: string[], cwd: string): string | null {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) return null;
  return r.stdout;
}

/**
 * `git@host:owner/repo.git` → `https://host/owner/repo.git`.
 * Idempotent on already-HTTPS URLs.
 */
export function normalizeRemoteUrl(raw: string): string {
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const m = raw.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  if (m) return `https://${m[1]}/${m[2]}`;
  const m2 = raw.match(/^ssh:\/\/[\w.-]+@([\w.-]+)(?::\d+)?\/(.+)$/);
  if (m2) return `https://${m2[1]}/${m2[2]}`;
  return raw;
}

/** Strip embedded `user:token@` from a URL for safe display. */
export function redactToken(url: string): string {
  return url.replace(/(https?:\/\/)[^/@]+:[^/@]+@/, '$1***@');
}
