/**
 * flowrunna POC — run a GitHub Actions workflow locally, on the host.
 *
 * Single-file proof to validate the speed claim before scoping the platform.
 * Reuses @gitgate/ci's `parseWorkflow` for YAML → typed AST.
 *
 * What it does today:
 * - Reads .github/workflows/<name>.yml
 * - Picks one job (first, or by name)
 * - Walks each step in order, timing each:
 *   - `run:`      → spawn the script in bash (Unix) or pwsh (Windows)
 *   - `uses:`     → handle a handful of common actions as no-ops; skip the rest
 * - Honors step-level `if:` (a tiny subset: literal true/false, success(), always())
 * - Honors `working-directory:` and per-step `env:`
 * - Stops the job on first non-zero exit (unless `continue-on-error: true`)
 * - Prints a per-step + total wall-clock report
 *
 * What it does NOT do (yet):
 * - Containers (everything runs on the host)
 * - Matrix / services / composite actions / reusable workflows
 * - GitHub-issued tokens, OIDC, real cache, real artifact storage
 * - Full ${{ ... }} expression evaluation
 *
 * Usage:
 *   pnpm tsx poc/run-workflow.ts .github/workflows/ci.yml typecheck
 *   pnpm tsx poc/run-workflow.ts <path> [job-name]
 */
import { parseWorkflow, type ParsedJob, type ParsedStep } from '@gitgate/ci';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

interface StepOutcome {
  label: string;
  durationMs: number;
  status: 'ok' | 'fail' | 'skip';
  reason?: string;
  exitCode?: number;
}

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function color(c: keyof typeof COLORS, s: string): string {
  return process.stdout.isTTY ? `${COLORS[c]}${s}${COLORS.reset}` : s;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Stub-evaluate a tiny subset of GitHub Actions `if:` expressions. */
function shouldRun(step: ParsedStep, prevFailed: boolean): boolean {
  const cond = step.if;
  if (!cond) return !prevFailed;
  const t = cond.trim();
  if (t === 'true' || t === 'always()') return true;
  if (t === 'false') return false;
  if (t === 'success()') return !prevFailed;
  if (t === 'failure()') return prevFailed;
  // Unknown expression: be conservative — run it, log a warning
  console.error(color('yellow', `  ! unrecognized if: ${cond} — running anyway`));
  return !prevFailed;
}

function pickShell(scriptShell: string | undefined): { cmd: string; args: (script: string) => string[] } {
  const explicit = scriptShell?.toLowerCase();
  if (explicit === 'pwsh' || explicit === 'powershell') {
    return { cmd: 'pwsh', args: (s) => ['-NoLogo', '-NoProfile', '-Command', s] };
  }
  if (explicit === 'cmd') {
    return { cmd: 'cmd', args: (s) => ['/d', '/s', '/c', s] };
  }
  // Default: bash on Unix; bash if available on Windows (Git Bash, WSL); else pwsh.
  if (process.platform !== 'win32') {
    return { cmd: 'bash', args: (s) => ['-eo', 'pipefail', '-c', s] };
  }
  // Windows
  for (const candidate of [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]) {
    if (existsSync(candidate)) return { cmd: candidate, args: (s) => ['-eo', 'pipefail', '-c', s] };
  }
  return { cmd: 'pwsh', args: (s) => ['-NoLogo', '-NoProfile', '-Command', s] };
}

const KNOWN_USES_NOOP: Record<string, string> = {
  'actions/checkout': 'already in checkout',
  'actions/setup-node': 'using host node',
  'actions/setup-python': 'using host python',
  'actions/setup-go': 'using host go',
  'actions/setup-java': 'using host java',
  'oven-sh/setup-bun': 'using host bun',
  'pnpm/action-setup': 'using host pnpm',
  'dtolnay/rust-toolchain': 'using host rustup',
  'actions/cache': 'cache no-op (local fs)',
  'actions/upload-artifact': 'artifact no-op',
  'actions/download-artifact': 'artifact no-op',
};

function matchKnownUses(uses: string): string | null {
  const at = uses.indexOf('@');
  const name = at >= 0 ? uses.slice(0, at) : uses;
  return KNOWN_USES_NOOP[name] ?? null;
}

function stepLabel(step: ParsedStep, idx: number): string {
  if (step.name) return step.name;
  if (step.uses) return step.uses;
  if (step.run) {
    const firstLine = step.run.split('\n')[0]!.trim();
    return firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;
  }
  return `step ${idx + 1}`;
}

async function runStep(
  step: ParsedStep,
  idx: number,
  cwd: string,
  jobEnv: Record<string, string>,
): Promise<StepOutcome> {
  const label = stepLabel(step, idx);
  const start = performance.now();

  if (step.uses) {
    const reason = matchKnownUses(step.uses);
    if (reason) {
      return { label, durationMs: performance.now() - start, status: 'skip', reason };
    }
    return {
      label,
      durationMs: performance.now() - start,
      status: 'skip',
      reason: `uses: ${step.uses} (not implemented)`,
    };
  }

  if (!step.run) {
    return { label, durationMs: performance.now() - start, status: 'skip', reason: 'no run/uses' };
  }

  const wd = step['working-directory'] ? resolve(cwd, step['working-directory']) : cwd;
  const shell = pickShell(step.shell);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...jobEnv,
    ...(step.env ?? {}),
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    RUNNER_OS: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
    GITHUB_WORKSPACE: cwd,
  };

  return new Promise((done) => {
    const proc = spawn(shell.cmd, shell.args(step.run!), { cwd: wd, env, stdio: 'inherit' });
    proc.on('error', (err) => {
      done({
        label,
        durationMs: performance.now() - start,
        status: 'fail',
        reason: err.message,
        exitCode: -1,
      });
    });
    proc.on('exit', (code) => {
      const status: StepOutcome['status'] = code === 0 ? 'ok' : 'fail';
      done({ label, durationMs: performance.now() - start, status, exitCode: code ?? -1 });
    });
  });
}

async function runJob(
  jobKey: string,
  job: ParsedJob,
  cwd: string,
): Promise<{ outcomes: StepOutcome[]; jobMs: number }> {
  console.log(
    `\n${color('cyan', '▶')} ${color('bold', `job: ${jobKey}`)}  ${color('gray', `(${Array.isArray(job['runs-on']) ? job['runs-on'].join(',') : job['runs-on']})`)}`,
  );
  const jobEnv = job.env ?? {};
  const start = performance.now();
  const outcomes: StepOutcome[] = [];
  let failed = false;
  for (let i = 0; i < job.steps.length; i++) {
    const step = job.steps[i]!;
    if (!shouldRun(step, failed)) {
      outcomes.push({ label: stepLabel(step, i), durationMs: 0, status: 'skip', reason: `if: ${step.if}` });
      continue;
    }
    const outcome = await runStep(step, i, cwd, jobEnv);
    outcomes.push(outcome);
    const mark =
      outcome.status === 'ok'
        ? color('green', '✓')
        : outcome.status === 'fail'
          ? color('red', '✗')
          : color('gray', '⊘');
    const tail =
      outcome.status === 'skip'
        ? color('gray', `(${outcome.reason})`)
        : color('gray', `${fmtMs(outcome.durationMs)}`);
    console.log(`  ${mark} ${outcome.label.padEnd(50)} ${tail}`);
    if (outcome.status === 'fail' && step['continue-on-error'] !== true) {
      failed = true;
      console.error(color('red', `  ✗ step failed (exit ${outcome.exitCode}); skipping rest of job`));
    }
  }
  return { outcomes, jobMs: performance.now() - start };
}

function printSummary(
  workflowName: string,
  results: { jobKey: string; outcomes: StepOutcome[]; jobMs: number }[],
  totalMs: number,
): void {
  const stepsRun = results.flatMap((r) => r.outcomes).filter((o) => o.status !== 'skip').length;
  const stepsSkip = results.flatMap((r) => r.outcomes).filter((o) => o.status === 'skip').length;
  const failed = results.flatMap((r) => r.outcomes).some((o) => o.status === 'fail');

  console.log('\n' + color('gray', '─'.repeat(74)));
  console.log(
    `${color('bold', workflowName)}  ${color(failed ? 'red' : 'green', failed ? 'FAIL' : 'PASS')}  ${color('cyan', fmtMs(totalMs))}  ${color('gray', `(${stepsRun} ran, ${stepsSkip} skipped)`)}`,
  );
  for (const r of results) {
    console.log(`  ${color('cyan', r.jobKey.padEnd(20))} ${fmtMs(r.jobMs)}`);
  }
  console.log(color('gray', '─'.repeat(74)));
  console.log(
    color(
      'gray',
      'GitHub Actions baseline for the same workflow includes ~30–60s of VM\nprovisioning before the first step runs. Push to compare end-to-end.',
    ),
  );
}

async function main(): Promise<void> {
  const [, , workflowArg, jobArg] = process.argv;
  if (!workflowArg) {
    console.error('usage: tsx poc/run-workflow.ts <path-to-workflow.yml> [job-name]');
    process.exit(2);
  }
  const workflowPath = resolve(process.cwd(), workflowArg);
  if (!existsSync(workflowPath)) {
    console.error(`workflow not found: ${workflowPath}`);
    process.exit(2);
  }
  const yaml = readFileSync(workflowPath, 'utf-8');
  const wf = parseWorkflow(yaml);
  const jobs = Object.entries(wf.jobs);
  if (jobs.length === 0) {
    console.error('workflow has no jobs');
    process.exit(2);
  }
  const target = jobArg
    ? jobs.filter(([k]) => k === jobArg)
    : jobs;
  if (target.length === 0) {
    console.error(`no job named "${jobArg}". available: ${jobs.map(([k]) => k).join(', ')}`);
    process.exit(2);
  }

  const wfName = wf.name ?? workflowArg;
  console.log(color('bold', `flowrunna · ${wfName}`));
  console.log(color('gray', `${workflowPath}`));
  console.log(color('gray', `host: ${process.platform} ${process.arch}, node ${process.version}`));

  const overall = performance.now();
  const results: { jobKey: string; outcomes: StepOutcome[]; jobMs: number }[] = [];
  for (const [k, j] of target) {
    const { outcomes, jobMs } = await runJob(k, j, process.cwd());
    results.push({ jobKey: k, outcomes, jobMs });
    if (outcomes.some((o) => o.status === 'fail')) break;
  }
  const total = performance.now() - overall;
  printSummary(wfName, results, total);
  process.exit(results.flatMap((r) => r.outcomes).some((o) => o.status === 'fail') ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
