/**
 * Per-cell git-worktree isolation for matrix execution.
 *
 * Matrix cells of the same job have always shared the host workspace,
 * which is why we serialised them — parallel cells race on writes to
 * `coverage/`, `dist/`, etc. With a `git worktree add --detach <path>`
 * each cell gets its own checkout of HEAD, isolated from siblings.
 *
 * Note on `node_modules`: NOT symlinked back to the parent. Doing so
 * lets parallel `npm install` / `yarn install` cells race on writes to
 * the SAME tree (the symlink resolves to one shared location). Each
 * cell installs into its own worktree's node_modules instead, paired
 * with the per-cell package-manager scratch caches in host.ts. The
 * `.runner/` symlink is preserved so artifacts + cache directories ARE
 * shared (cache layout itself does the per-cell vs shared isolation).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface WorktreeOptions {
  /** Root of the repo (must be a git repo). */
  repoRoot: string;
  /** Stable id for this worktree (e.g. job id with the cell hash). */
  jobId: string;
  /**
   * Directories under repoRoot that should be symlinked into the
   * worktree instead of being checked out fresh. Defaults to common
   * dep + cache dirs; extend as needed.
   */
  symlink?: string[];
}

export interface WorktreeHandle {
  path: string;
  cleanup: () => void;
}

const DEFAULT_SYMLINK = [
  // Build-artifact dirs that are write-rare and read-heavy across cells.
  // `.turbo` uses content-addressed remote-cache semantics — safe to share.
  '.turbo',
  // v0.6.17: `.runner` is NOT in this list anymore. Symlinking it from the
  // worktree back to the repo created an infinite directory loop — the
  // worktree itself lives at `<repo>/.runner/worktrees/<id>/`, so descending
  // through `<worktree>/.runner -> <repo>/.runner -> .../worktrees/<id>/`
  // landed back in the same worktree. Any tool that walks the source tree
  // (c8, eslint, vitest, ripgrep, find) hit Windows ELOOP after ~70 levels.
  // Repro: kleur's `c8 npm test` in Round 3 OSS validation.
  //
  // Practical impact: per-cell caches (npm/yarn/pip) are unaffected — they
  // use absolute env-var paths set by host.ts::setupCellCaches, not the
  // worktree-relative `.runner/`. Content-addressed caches (pnpm/bun/cargo)
  // also live in the user's global cache, not `<repoRoot>/.runner/`.
  // `actions/upload-artifact` writes per-worktree now; consolidate at
  // `<repoRoot>/.runner/artifacts/` post-run if needed.
  //
  // Note: `node_modules`, `.pnpm-store`, `.bun-install` were here historically
  // to skip reinstall, but they raced on parallel `npm install` writes.
  // Each cell now installs into its own worktree's node_modules; the shared
  // content-addressed package-manager caches give the same warm-second-run
  // benefit without the race.
];

export function isGitRepo(dir: string): boolean {
  const r = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: dir, encoding: 'utf-8' });
  return r.status === 0;
}

export function createWorktree(opts: WorktreeOptions): WorktreeHandle {
  const safeId = opts.jobId.replace(/[^A-Za-z0-9_.-]+/g, '_');
  const path = resolve(opts.repoRoot, '.runner', 'worktrees', safeId);
  // Stale-state cleanup. Three failure modes git can leave behind:
  //  1. Path exists on disk + registered.
  //  2. Path missing on disk + still registered (e.g. user `rm -rf .runner/`).
  //  3. Path exists but registration is corrupt.
  // `git worktree remove --force` is idempotent and handles all three; if it
  // returns nonzero we fall through to `prune` which sweeps the registry.
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
  spawnSync('git', ['worktree', 'remove', '--force', path], { cwd: opts.repoRoot });
  spawnSync('git', ['worktree', 'prune'], { cwd: opts.repoRoot });
  mkdirSync(dirname(path), { recursive: true });

  const r = spawnSync('git', ['worktree', 'add', '--detach', path, 'HEAD'], {
    cwd: opts.repoRoot,
    encoding: 'utf-8',
  });
  if (r.status !== 0) {
    throw new Error(`git worktree add failed: ${r.stderr.trim() || r.stdout.trim()}`);
  }

  // Symlink shared deps + caches so the cell doesn't re-install.
  const toLink = opts.symlink ?? DEFAULT_SYMLINK;
  for (const name of toLink) {
    const src = resolve(opts.repoRoot, name);
    const dst = resolve(path, name);
    if (!existsSync(src)) continue;
    if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
    try {
      symlinkSync(src, dst, statSync(src).isDirectory() ? 'dir' : 'file');
    } catch {
      // Windows often needs admin to symlink. Fall back to leaving the
      // cell to its own install — slower but correct.
    }
  }

  return {
    path,
    cleanup: () => {
      spawnSync('git', ['worktree', 'remove', '--force', path], { cwd: opts.repoRoot });
      rmSync(path, { recursive: true, force: true });
    },
  };
}

/** Sweep up any worktrees left behind from prior interrupted runs. */
export function pruneWorktrees(repoRoot: string): void {
  const dir = resolve(repoRoot, '.runner', 'worktrees');
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    spawnSync('git', ['worktree', 'remove', '--force', path], { cwd: repoRoot });
  }
  spawnSync('git', ['worktree', 'prune'], { cwd: repoRoot });
}
