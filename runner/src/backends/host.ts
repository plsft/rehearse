/**
 * Host backend: spawn step scripts directly on the developer's machine.
 *
 * Selection criteria (handled by the planner): job has no services, no
 * `container:` block, runs-on label matches the host OS family or is generic.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Backend, JobSession, PrepareArgs, PlannedStep, StepResult } from '../types.js';
import { isJsActionUses, runJsAction } from '../js-action.js';
import { runShim, hasShim } from '../shims/index.js';
import { createWorktree, isGitRepo } from '../worktree.js';

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
      try {
        const wt = createWorktree({ repoRoot: args.hostCwd, jobId: args.jobId });
        workdir = wt.path;
        worktree = wt;
      } catch (err) {
        // Worktree creation can fail (e.g., shallow clone, weird state).
        // Falling back to shared workspace + sequential execution is safe.
        console.error(`[runner] worktree setup failed, falling back to shared workspace: ${(err as Error).message}`);
      }
    }

    return {
      jobId: args.jobId,
      hostCwd: args.hostCwd,
      workdir,
      env: args.job.env,
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
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...session.env,
      ...step.env,
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      GITHUB_WORKSPACE: session.workdir,
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
        done({
          label: step.label,
          status: code === 0 ? 'success' : 'failure',
          exitCode: code ?? -1,
          durationMs: performance.now() - t0,
          outputs: {},
        });
      });
    });
  }

  async teardown(session: JobSession): Promise<void> {
    // Leave tempDir for inspection on failure; OS cleans up tmp eventually.
    if (session.worktree) session.worktree.cleanup();
  }
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
