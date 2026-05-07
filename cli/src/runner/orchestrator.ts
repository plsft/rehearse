/**
 * Top-level orchestration. Glues the parser, planner, scheduler, and
 * backends together, plus a console reporter.
 */
import { parseWorkflow } from '@rehearse/ci';
import { existsSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import pc from 'picocolors';

/**
 * Read the CLI's own version from package.json. Same trick as cli/index.ts:
 * the file is two dirs up from `dist/runner/` at runtime. Fail open to '0.0.0'
 * if anything's wrong (printing an unknown version is better than crashing).
 */
function readPkgVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/runner/orchestrator.js → ../../package.json
    const pkgPath = resolve(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
import { ContainerBackend } from './backends/container.js';
import { HostBackend } from './backends/host.js';
import { plan } from './planner.js';
import { runJobs } from './scheduler.js';
import type { Backend, BackendName, ExpressionContext, JobResult, JobStatus, PlannedJob, RunOptions, RunResult } from './types.js';
import { declaredInputs, resolveInputs } from './workflow-inputs.js';

function inferRepoRoot(workflowPath: string): string {
  const dir = dirname(workflowPath);
  const norm = dir.replace(/\\/g, '/');
  if (norm.endsWith('/.github/workflows')) return dirname(dirname(dir));
  return dir;
}

function fmtMs(ms: number): string { return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`; }

function statusMark(s: JobStatus): string {
  if (s === 'success') return pc.green('✓');
  if (s === 'failure') return pc.red('✗');
  if (s === 'cancelled') return pc.yellow('●');
  return pc.gray('⊘');
}

const LABEL_COL = 42;
function padLabel(label: string): string {
  if (label.length > LABEL_COL - 1) return label.slice(0, LABEL_COL - 2) + '…';
  return label.padEnd(LABEL_COL);
}

export async function run(options: RunOptions): Promise<RunResult> {
  const wfPath = resolve(process.cwd(), options.workflowPath);
  if (!existsSync(wfPath)) throw new Error(`workflow not found: ${wfPath}`);
  const cwd = options.cwd ? resolve(process.cwd(), options.cwd) : inferRepoRoot(wfPath);
  if (!existsSync(cwd)) throw new Error(`cwd not found: ${cwd}`);

  const wf = parseWorkflow(readFileSync(wfPath, 'utf-8'));

  // Resolve declared workflow_dispatch inputs (CLI > opts > default >
  // interactive prompt > error). Pre-v0.6.16 we ignored these, which
  // meant `${{ inputs.X }}` collapsed to '' silently — workflows that
  // happened to use defaults worked, ones that required runtime inputs
  // failed in obscure ways downstream.
  const declared = declaredInputs(wf);
  let resolvedInputs: Record<string, string> = {};
  if (Object.keys(declared).length > 0) {
    resolvedInputs = await resolveInputs({
      declared,
      provided: options.inputs ?? {},
      // TTY check on stdin AND stderr (we prompt to stderr to keep stdout
      // clean for --bench JSON). If either is piped, no prompt — fail
      // with a clear error so CI doesn't hang.
      interactive: process.stdin.isTTY === true && process.stderr.isTTY === true,
    });
  }

  const opts: RunOptions = { ...options, cwd, inputs: resolvedInputs };
  const planned = plan(wf, opts);
  if (planned.length === 0) throw new Error('no jobs match');

  const backends: Record<BackendName, Backend> = {
    host: new HostBackend({ verbose: options.verbose }),
    container: new ContainerBackend(),
  };
  // Local default: use all cpus. Pre-v0.6.9 we capped at 4 — that was a
  // historical safety belt from the era of the npm cache races (fixed in
  // v0.5.4+ via per-cell scratch caches). On a developer machine the user
  // generally WANTS to use all their cores; it's their machine. The Pro
  // VM still caps at min(cpus, 4) because oversubscribing a 2-vCPU VM
  // doesn't help, and that cap is enforced by the daemon when it invokes
  // `rh run` server-side.
  const maxParallel = options.maxParallel ?? cpus().length;

  const verbose = options.verbosity !== 'quiet';
  const isTty = process.stdout.isTTY === true;

  if (verbose) {
    // Banner — tool identity + workflow context. Two-line gray "comment"
    // header matches the simulated terminal demo on rehearse.sh; users
    // explicitly asked to see version + cpu utilisation up front.
    const totalCpus = cpus().length;
    const usedCpus = Math.min(maxParallel, totalCpus);
    const sep = pc.gray('·');
    console.log(
      `${pc.gray('#')} ${pc.bold('rehearse')} ${pc.dim('v' + readPkgVersion())} ${sep} ` +
      `${pc.dim('rehearse.sh')} ${sep} ` +
      `${pc.dim(`${usedCpus} of ${totalCpus} cpus`)}`,
    );
    console.log(`${pc.gray('#')} ${pc.bold(wf.name ?? 'workflow')}`);
    console.log(pc.gray(`workflow: ${wfPath}`));
    console.log(pc.gray(`jobs:     ${planned.length}  (parallel ≤ ${maxParallel})`));
  }

  // Live-overwrite state: when a step-start writes a "running…" pre-line
  // without a trailing \n, we remember which job owns the current line so
  // the matching step-end can erase + replace it. Any other write that
  // breaks the ownership (a different job's event, job-start, summary)
  // calls flushInflight() to push the cursor down to a clean line first.
  let inflightJobId: string | null = null;
  // Animated spinner for in-flight steps. We repaint the line every ~100ms
  // with the next frame + elapsed time so the user can see the step is
  // progressing even while output is captured (v0.6.3+ behavior). TTY only.
  const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerTimer: NodeJS.Timeout | null = null;
  let spinnerFrame = 0;
  let spinnerLabel = '';
  let spinnerStartedAt = 0;
  let spinnerStepCounter = '';
  const stopSpinner = () => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  };
  const startSpinner = (label: string, stepCounter: string) => {
    stopSpinner();
    spinnerLabel = label;
    spinnerStepCounter = stepCounter;
    spinnerStartedAt = Date.now();
    spinnerFrame = 0;
    spinnerTimer = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
      const elapsed = Date.now() - spinnerStartedAt;
      const elapsedStr = elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`;
      process.stdout.write(
        `\r\x1B[K  ${spinnerStepCounter}${pc.yellow(SPINNER_FRAMES[spinnerFrame]!)} ${padLabel(spinnerLabel)} ${pc.gray(elapsedStr)}`,
      );
    }, 100).unref();
  };
  const flushInflight = () => {
    if (inflightJobId === null) return;
    stopSpinner();
    process.stdout.write('\n');
    inflightJobId = null;
  };

  const t0 = performance.now();
  const jobs = await runJobs(planned, {
    maxParallel,
    backends,
    hostCwd: cwd,
    failFast: options.failFast ?? false,
    buildContext: (job, needs) => baseContext(job, needs, opts),
    onEvent: (e) => {
      if (!verbose) return;
      switch (e.kind) {
        case 'job-start': {
          flushInflight();
          const cell = e.job.matrixCell
            ? ' ' + pc.gray(`[${Object.entries(e.job.matrixCell).map(([k, v]) => `${k}=${v}`).join(',')}]`)
            : '';
          console.log(`\n${pc.cyan('▶')} ${pc.bold(`job: ${e.job.jobName}`)} ${pc.gray(`(${e.job.backend} · ${e.job.runsOn})`)}${cell}`);
          break;
        }
        case 'step-start': {
          if (!isTty) break;        // non-TTY: skip the pre-line — final line says it all
          flushInflight();           // clear any other job's running… line first
          // Step counter `[2/4]` so the user sees position within the job.
          // Total comes from the planned steps; index is per-step.
          const total = e.job.steps.length;
          const stepCounter = total > 1
            ? pc.gray(`[${e.step.index + 1}/${total}] `)
            : '';
          process.stdout.write(`  ${stepCounter}${pc.yellow(SPINNER_FRAMES[0]!)} ${padLabel(e.step.label)} ${pc.gray('0ms')}`);
          inflightJobId = e.job.id;
          startSpinner(e.step.label, stepCounter);
          break;
        }
        case 'step-end': {
          // Stop the animation BEFORE writing the final line so it can't
          // re-paint over our terminal output mid-write.
          stopSpinner();
          // If our own step-start is still on the cursor line, erase it.
          // Otherwise push to a fresh line.
          if (isTty && inflightJobId === e.job.id) {
            process.stdout.write('\r\x1B[K');
            inflightJobId = null;
          } else {
            flushInflight();
          }
          // Step counter `[N/M]` for jobs with >1 step. Visible on both
          // the in-flight spinner line AND the final ✓/✗/⊘ line so the
          // user sees position regardless of TTY mode.
          const total = e.job.steps.length;
          const stepCounter = total > 1
            ? pc.gray(`[${e.step.index + 1}/${total}] `)
            : '';
          // Three render modes, matching the simulated demo on rehearse.sh:
          //   - skipped:                       ⊘ <label>  <reason>
          //   - host-shortcut (no-op success): ⊘ <label>  <reason>
          //   - real work:                     ✓ / ✗ / ● <label>  <duration>
          const isHostShortcut = e.result.status === 'success'
            && e.result.durationMs < 5
            && !!e.result.reason;
          if (e.result.status === 'skipped' || isHostShortcut) {
            console.log(`  ${stepCounter}${pc.gray('⊘')} ${padLabel(e.step.label)} ${pc.gray(e.result.reason ?? 'skipped')}`);
          } else {
            console.log(`  ${stepCounter}${statusMark(e.result.status)} ${padLabel(e.step.label)} ${pc.gray(fmtMs(e.result.durationMs))}`);
          }
          // Dump captured stdout/stderr ONLY on failure (success runs stay
          // clean). The host backend buffers output by default; --verbose
          // restores live streaming and skips the buffer (output undefined).
          if (e.result.status === 'failure' && e.result.output) {
            const indented = e.result.output
              .replace(/\r?\n$/, '')
              .split(/\r?\n/)
              .map((line) => '    ' + pc.gray('│') + ' ' + line)
              .join('\n');
            console.log(indented);
            if (e.result.reason) {
              console.log('    ' + pc.gray('│') + ' ' + pc.red(e.result.reason));
            }
          }
          break;
        }
        case 'job-end':
          // For jobs that finished without emitting any steps (e.g. a
          // remote reusable we can't expand), show the reason inline so
          // the user sees WHY there was no work — the summary rollup
          // only prints in matrix / multi-job runs.
          if (e.result.status === 'skipped' && e.result.steps.length === 0 && e.result.reason) {
            console.log(`  ${pc.gray('⊘')} ${pc.gray(e.result.reason)}`);
          }
          break;
      }
    },
  });

  // Make sure the cursor is on a clean line before the summary.
  flushInflight();

  const overallStatus: JobStatus =
    jobs.some((j) => j.status === 'failure') ? 'failure'
      : jobs.every((j) => j.status === 'skipped') ? 'skipped'
      : 'success';

  const totalMs = performance.now() - t0;
  if (verbose) printSummary(wf.name ?? wfPath, jobs, overallStatus, totalMs, maxParallel);

  return { workflow: wfPath, status: overallStatus, durationMs: totalMs, jobs };
}

function baseContext(job: PlannedJob, needs: Record<string, JobResult>, opts: RunOptions): ExpressionContext {
  return {
    matrix: job.matrixCell,
    env: opts.env ?? {},
    secrets: opts.secrets ?? {},
    vars: {},
    github: {
      actor: process.env.USER ?? process.env.USERNAME ?? 'local',
      repository: 'local/local',
      ref: 'refs/heads/local',
      ref_name: 'local',
      sha: '0000000000000000000000000000000000000000',
      event_name: 'workflow_dispatch',
      workspace: opts.cwd ?? process.cwd(),
    },
    needs: Object.fromEntries(
      Object.entries(needs).map(([k, v]) => [k, { result: v.status, outputs: v.outputs }]),
    ),
    steps: {},
    job: { status: 'success' },
    runner: {
      os: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
      arch: process.arch === 'x64' ? 'X64' : process.arch.toUpperCase(),
      temp: '/tmp',
    },
    inputs: opts.inputs ?? {},
  };
}

function printSummary(wfName: string, jobs: JobResult[], overall: JobStatus, totalMs: number, maxParallel: number): void {
  const ran = jobs.filter((j) => j.status !== 'skipped' && j.status !== 'cancelled').length;
  const skipped = jobs.filter((j) => j.status === 'skipped').length;
  const hasMatrix = jobs.some((j) => j.matrixCell);

  console.log(pc.gray('─'.repeat(72)));
  const tag = overall === 'success' ? pc.green('PASS') : overall === 'failure' ? pc.red('FAIL') : pc.yellow(overall.toUpperCase());
  const parallelHint = ran > 1 && maxParallel > 1 ? ` ${pc.gray('·')} ${pc.gray(`${ran} jobs in parallel`)}` : ran === 1 ? ` ${pc.gray('·')} ${pc.gray('1 job')}` : ` ${pc.gray('·')} ${pc.gray(`${ran} jobs`)}`;
  const skipHint = skipped > 0 ? pc.gray(` · ${skipped} skipped`) : '';
  console.log(`${pc.bold(wfName)}  ${tag}  ${pc.cyan(fmtMs(totalMs))}${parallelHint}${skipHint}`);

  // Per-job rollup only when it adds information: matrix cells, or >3 jobs.
  // For the simple 1–2 job case the in-flight step lines are already
  // self-evident.
  if (hasMatrix || jobs.length > 3) {
    for (const j of jobs) {
      const cell = j.matrixCell
        ? pc.gray(` [${Object.entries(j.matrixCell).map(([k, v]) => `${k}=${v}`).join(',')}]`)
        : '';
      console.log(`  ${statusMark(j.status)} ${pc.cyan(j.jobName.padEnd(20))} ${fmtMs(j.durationMs).padStart(8)}${cell}${j.reason ? pc.gray(`  ${j.reason}`) : ''}`);
    }
  }
}
