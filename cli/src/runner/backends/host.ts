/**
 * Host backend: spawn step scripts directly on the developer's machine.
 *
 * Selection criteria (handled by the planner): job has no services, no
 * `container:` block, runs-on label matches the host OS family or is generic.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Backend, JobSession, PrepareArgs, PlannedStep, StepResult } from '../types.js';
import { isJsActionUses, parseGithubOutput, runJsAction } from '../js-action.js';
import { runShim, hasShim } from '../shims/index.js';
import { createWorktree, isGitRepo } from '../worktree.js';

/**
 * Serialise `git worktree add` across all matrix cells in this rh process.
 *
 * Why this matters: parallel cells each call `git worktree remove --force`
 * + `git worktree prune` + `git worktree add`. All three touch the same
 * `.git/worktrees/` registry. On Windows, the registry lock races when 4+
 * cells fire `prepare()` simultaneously — some cells' `git worktree add`
 * fails with "missing but already registered" or similar, the host backend
 * (pre-v0.6.1) would silently fall back to the shared workspace, and those
 * fallback cells would then trample each other's `<repo>/node_modules/`
 * during parallel `npm install`. Symptom: a flood of
 * `npm warn tar TAR_ENTRY_ERROR ... rename '<repo>/node_modules/...'`.
 *
 * Fix: chain worktree creation through a single promise so only one cell
 * is touching `.git/worktrees/` at a time. Each createWorktree() call is
 * fast (50-200ms with shallow checkout), so the serialised step adds at
 * most ~1-2s of total wall time across a 9-cell matrix. Workflow steps
 * after prep continue running in parallel as normal.
 */
let worktreeChain: Promise<void> = Promise.resolve();
async function createWorktreeSerialized(opts: { repoRoot: string; jobId: string }) {
  const prev = worktreeChain;
  let release: () => void = () => {};
  worktreeChain = new Promise<void>((r) => { release = r; });
  try {
    await prev.catch(() => { /* keep chain alive on prior failure */ });
    return createWorktree(opts);
  } finally {
    release();
  }
}

/**
 * Per-cell scratch caches for matrix runs. Eliminates package-manager
 * races on the user's global cache. Canonical case: `npm install` on
 * Windows races on `~/.npm/_cacache` tar atomic-rename when 9 cells
 * fire in parallel — we redirect each cell's npm cache to its own dir.
 *
 * Only redirected managers are the ones whose cache CAN race:
 *   - npm  (cacache uses tar + atomic-rename, races on Windows)
 *   - yarn classic (similar tar-based cache)
 *   - pip  (wheels cache races on parallel wheel-build writes)
 *
 * pnpm / bun / cargo / Go are content-addressed and parallel-safe — we
 * leave them on the user's global cache so all cells share the same
 * warm store with zero extra disk and zero new download.
 *
 * Per-cell paths are deterministic from `<repoRoot>/.runner/cache/<cellId>/`
 * so caches warm across runs of the same matrix configuration. Only
 * activated when the job has a matrix cell; single-job runs keep the
 * user's global cache for drop-in compat.
 */
function setupCellCaches(repoRoot: string, jobId: string): Record<string, string> {
  const safeId = jobId.replace(/[^A-Za-z0-9_.-]+/g, '_');
  const root = resolve(repoRoot, '.runner', 'cache', safeId);
  const npmDir  = resolve(root, 'npm');
  const yarnDir = resolve(root, 'yarn');
  const pipDir  = resolve(root, 'pip');
  for (const dir of [npmDir, yarnDir, pipDir]) mkdirSync(dir, { recursive: true });
  return {
    npm_config_cache:  npmDir,
    YARN_CACHE_FOLDER: yarnDir,
    PIP_CACHE_DIR:     pipDir,
  };
}

export interface HostBackendOptions {
  /**
   * When a job has a matrix cell, create a per-cell `git worktree` so
   * cells can run in parallel without racing on shared workspace writes.
   * Falls back to the parent repo on non-git workspaces or symlink failures.
   */
  worktreeForMatrix?: boolean;
}

export class HostBackend implements Backend {
  readonly name = 'host' as const;
  constructor(private readonly opts: HostBackendOptions = { worktreeForMatrix: true }) {}

  async prepare(args: PrepareArgs): Promise<JobSession> {
    const safeId = args.jobId.replace(/[^A-Za-z0-9_.-]+/g, '_');
    const tempDir = mkdtempSync(resolve(tmpdir(), `runner-${safeId}-`));

    let workdir = args.hostCwd;
    let worktree: JobSession['worktree'];
    if (
      this.opts.worktreeForMatrix !== false &&
      args.job.matrixCell !== undefined &&
      isGitRepo(args.hostCwd)
    ) {
      // Hard-fail on worktree-create errors instead of silently falling back
      // to the shared workspace. The fallback caused multiple cells to
      // race-install into <repo>/node_modules/ — the very failure mode the
      // worktree was added to prevent. Better to surface the underlying
      // error so the user can fix it.
      const wt = await createWorktreeSerialized({ repoRoot: args.hostCwd, jobId: args.jobId });
      // `git worktree add` checks out the WHOLE repo at the worktree
      // path, even when hostCwd is a sub-directory of the repo. Map
      // the cell's workdir to the equivalent sub-directory inside the
      // worktree so examples in monorepos see their package.json /
      // lockfile, not the git root's.
      const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: args.hostCwd, encoding: 'utf-8',
      });
      if (top.status === 0) {
        const gitRoot = top.stdout.trim();
        const relCwd = relative(gitRoot, args.hostCwd);
        workdir = relCwd && !relCwd.startsWith('..') ? resolve(wt.path, relCwd) : wt.path;
      } else {
        workdir = wt.path;
      }
      worktree = wt;
    }

    // Per-cell scratch caches for matrix runs (matrix-only — single
    // jobs keep using the user's global cache for drop-in compat).
    // Race-prone managers (npm/yarn/pip) get isolated per-cell dirs;
    // content-addressed managers (pnpm/bun/cargo/Go) share a workflow-
    // wide dir for warm-cache reuse across cells. Eliminates the
    // `~/.npm/_cacache` tar-rename race on Windows + matrix.
    const sessionEnv: Record<string, string> = { ...args.job.env };
    if (args.job.matrixCell !== undefined) {
      Object.assign(sessionEnv, setupCellCaches(args.hostCwd, args.jobId));
    }

    return {
      jobId: args.jobId,
      hostCwd: args.hostCwd,
      workdir,
      env: sessionEnv,
      tempDir,
      worktree,
    };
  }

  async exec(session: JobSession, step: PlannedStep): Promise<StepResult> {
    const t0 = performance.now();

    if (step.uses && hasShim(step.uses)) {
      return runShim(step, session, this.name);
    }
    if (step.uses && isJsActionUses(step.uses)) {
      return runJsAction(step, session);
    }
    if (step.uses) {
      return {
        label: step.label,
        status: 'skipped',
        durationMs: 0,
        outputs: {},
        reason: `uses: ${step.uses} (no shim, no-op)`,
      };
    }
    if (!step.run) {
      return { label: step.label, status: 'skipped', durationMs: 0, outputs: {}, reason: 'no run/uses' };
    }

    const cwd = step.workingDirectory ? resolve(session.workdir, step.workingDirectory) : session.workdir;
    if (!existsSync(cwd)) {
      return { label: step.label, status: 'failure', durationMs: 0, outputs: {}, reason: `cwd missing: ${cwd}` };
    }

    const shell = pickShell(step.shell);

    // Per-step temp files for the GitHub Actions step-output protocol.
    // Steps write to these via `echo "k=v" >> $GITHUB_OUTPUT` etc.; we
    // parse them back after the step exits. Without this, any workflow
    // that uses `outputs.xxx`, `id: foo` then `${{ steps.foo.outputs.bar }}`,
    // or `echo ... >> $GITHUB_ENV` fails with "ambiguous redirect".
    const stepDir = mkdtempSync(resolve(session.tempDir, 'step-'));
    const outputFile = resolve(stepDir, 'output');
    const envFile = resolve(stepDir, 'env');
    const pathFile = resolve(stepDir, 'path');
    const summaryFile = resolve(stepDir, 'summary');
    writeFileSync(outputFile, '');
    writeFileSync(envFile, '');
    writeFileSync(pathFile, '');
    writeFileSync(summaryFile, '');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...session.env,
      ...step.env,
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      GITHUB_WORKSPACE: session.workdir,
      GITHUB_OUTPUT: outputFile,
      GITHUB_ENV: envFile,
      GITHUB_PATH: pathFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      RUNNER_OS: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
      RUNNER_TEMP: session.tempDir,
    };

    return new Promise<StepResult>((done) => {
      const proc = spawn(shell.cmd, shell.args(step.run!), { cwd, env, stdio: 'inherit' });
      proc.on('error', (err) => {
        done({
          label: step.label,
          status: 'failure',
          exitCode: -1,
          durationMs: performance.now() - t0,
          outputs: {},
          reason: err.message,
        });
      });
      proc.on('exit', (code) => {
        // Surface step outputs and propagate env/PATH mutations so subsequent
        // steps see them — same contract as the JS-action runtime.
        const outputs = readFileSafe(outputFile) ? parseGithubOutput(readFileSafe(outputFile)) : {};
        const envAdditions = readFileSafe(envFile) ? parseGithubOutput(readFileSafe(envFile)) : {};
        for (const [k, v] of Object.entries(envAdditions)) session.env[k] = v;
        const pathAdditions = readFileSafe(pathFile)
          .split(/\r?\n/)
          .filter(Boolean);
        if (pathAdditions.length > 0) {
          const sep = process.platform === 'win32' ? ';' : ':';
          session.env.PATH = `${pathAdditions.join(sep)}${sep}${session.env.PATH ?? process.env.PATH ?? ''}`;
        }
        done({
          label: step.label,
          status: code === 0 ? 'success' : 'failure',
          exitCode: code ?? -1,
          durationMs: performance.now() - t0,
          outputs,
        });
      });
    });
  }

  async teardown(session: JobSession): Promise<void> {
    // Leave tempDir for inspection on failure; OS cleans up tmp eventually.
    if (session.worktree) session.worktree.cleanup();
  }
}

/** readFileSync that returns '' if the file disappeared (rare cleanup races). */
function readFileSafe(path: string): string {
  try { return readFileSync(path, 'utf-8'); } catch { return ''; }
}

function pickShell(scriptShell: string | undefined): { cmd: string; args: (s: string) => string[] } {
  const explicit = scriptShell?.toLowerCase();
  if (explicit === 'pwsh' || explicit === 'powershell') {
    return { cmd: 'pwsh', args: (s) => ['-NoLogo', '-NoProfile', '-Command', s] };
  }
  if (explicit === 'cmd') {
    return { cmd: 'cmd', args: (s) => ['/d', '/s', '/c', s] };
  }
  if (process.platform !== 'win32') {
    return { cmd: 'bash', args: (s) => ['-eo', 'pipefail', '-c', s] };
  }
  for (const candidate of [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]) {
    if (existsSync(candidate)) return { cmd: candidate, args: (s) => ['-eo', 'pipefail', '-c', s] };
  }
  return { cmd: 'pwsh', args: (s) => ['-NoLogo', '-NoProfile', '-Command', s] };
}
