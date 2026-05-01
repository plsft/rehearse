/**
 * Top-level orchestration. Glues the parser, planner, scheduler, and
 * backends together, plus a console reporter.
 */
import { parseWorkflow } from '@gitgate/ci';
import { existsSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import pc from 'picocolors';
import { ContainerBackend } from './backends/container.js';
import { HostBackend } from './backends/host.js';
import { plan } from './planner.js';
import { runJobs } from './scheduler.js';
import type { Backend, BackendName, ExpressionContext, JobResult, JobStatus, PlannedJob, RunOptions, RunResult } from './types.js';

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

export async function run(options: RunOptions): Promise<RunResult> {
  const wfPath = resolve(process.cwd(), options.workflowPath);
  if (!existsSync(wfPath)) throw new Error(`workflow not found: ${wfPath}`);
  const cwd = options.cwd ? resolve(process.cwd(), options.cwd) : inferRepoRoot(wfPath);
  if (!existsSync(cwd)) throw new Error(`cwd not found: ${cwd}`);

  const wf = parseWorkflow(readFileSync(wfPath, 'utf-8'));
  const opts: RunOptions = { ...options, cwd };
  const planned = plan(wf, opts);
  if (planned.length === 0) throw new Error('no jobs match');

  const backends: Record<BackendName, Backend> = {
    host: new HostBackend(),
    container: new ContainerBackend(),
  };
  const maxParallel = options.maxParallel ?? Math.min(cpus().length, 4);

  const verbose = options.verbosity !== 'quiet';
  if (verbose) {
    console.log(pc.bold(`runner · ${wf.name ?? wfPath}`));
    console.log(pc.gray(`workflow: ${wfPath}`));
    console.log(pc.gray(`cwd:      ${cwd}`));
    console.log(pc.gray(`jobs:     ${planned.length}  (parallel ≤ ${maxParallel})`));
  }

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
        case 'job-start':
          console.log(`\n${pc.cyan('▶')} ${pc.bold(`job: ${e.job.jobName}`)} ${pc.gray(`(${e.job.backend} · ${e.job.runsOn})`)}`);
          break;
        case 'step-end':
          if (e.result.status === 'skipped') {
            console.log(`  ${pc.gray('⊘')} ${e.step.label.padEnd(50)} ${pc.gray(`(${e.result.reason})`)}`);
          } else {
            console.log(`  ${statusMark(e.result.status)} ${e.step.label.padEnd(50)} ${pc.gray(fmtMs(e.result.durationMs))}`);
          }
          break;
        case 'job-end':
          // summary printed below
          break;
      }
    },
  });

  const overallStatus: JobStatus =
    jobs.some((j) => j.status === 'failure') ? 'failure'
      : jobs.every((j) => j.status === 'skipped') ? 'skipped'
      : 'success';

  const totalMs = performance.now() - t0;
  if (verbose) printSummary(wf.name ?? wfPath, jobs, overallStatus, totalMs);

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
    inputs: {},
  };
}

function printSummary(wfName: string, jobs: JobResult[], overall: JobStatus, totalMs: number): void {
  const ran = jobs.filter((j) => j.status !== 'skipped' && j.status !== 'cancelled').length;
  const skipped = jobs.filter((j) => j.status === 'skipped').length;
  console.log('\n' + pc.gray('─'.repeat(74)));
  const tag = overall === 'success' ? pc.green('PASS') : overall === 'failure' ? pc.red('FAIL') : pc.yellow(overall.toUpperCase());
  console.log(`${pc.bold(wfName)}  ${tag}  ${pc.cyan(fmtMs(totalMs))}  ${pc.gray(`(${ran} ran, ${skipped} skipped)`)}`);
  for (const j of jobs) {
    const cell = j.matrixCell ? pc.gray(` [${Object.entries(j.matrixCell).map(([k, v]) => `${k}=${v}`).join(',')}]`) : '';
    console.log(`  ${statusMark(j.status)} ${pc.cyan(j.jobName.padEnd(20))} ${fmtMs(j.durationMs).padStart(8)}${cell}${j.reason ? pc.gray(`  ${j.reason}`) : ''}`);
  }
  console.log(pc.gray('─'.repeat(74)));
}
