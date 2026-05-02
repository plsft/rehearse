/**
 * Job scheduler. Topologically schedules planned jobs, respecting `needs:`
 * and `if:` conditions, with bounded parallelism.
 *
 * Notes:
 * - Matrix-expanded variants share a `jobKey`. Other jobs that depend on the
 *   matrix parent (`needs: [parent]`) wait for ALL variants to finish; that
 *   matches GitHub's semantics.
 * - When a needed job fails, dependents are skipped unless their `if:`
 *   evaluates truthy with `failure()` or `always()`.
 */
import { performance } from 'node:perf_hooks';
import type { Backend, BackendName, JobResult, JobStatus, PlannedJob, PlannedStep, StepResult } from './types.js';
import { evalCondition } from './expression.js';
import { substituteEnv, substituteString, substituteWith } from './planner.js';

export interface SchedulerOptions {
  maxParallel: number;
  backends: Record<BackendName, Backend>;
  hostCwd: string;
  /** Logger callback per event. */
  onEvent?: (event: SchedulerEvent) => void;
  /** Optional: stop scheduling new jobs after the first failure. */
  failFast?: boolean;
  /** Pre-resolved expression context for conditional evaluation. */
  buildContext: (job: PlannedJob, needs: Record<string, JobResult>) => import('./types.js').ExpressionContext;
}

export type SchedulerEvent =
  | { kind: 'job-start'; job: PlannedJob }
  | { kind: 'job-end'; job: PlannedJob; result: JobResult }
  | { kind: 'step-start'; job: PlannedJob; step: PlannedStep }
  | { kind: 'step-end'; job: PlannedJob; step: PlannedStep; result: StepResult };

export async function runJobs(jobs: PlannedJob[], opts: SchedulerOptions): Promise<JobResult[]> {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  // Map jobKey → list of plan ids (matrix expansion produces N ids for one key)
  const variantsByKey = new Map<string, string[]>();
  for (const j of jobs) {
    const arr = variantsByKey.get(j.jobKey) ?? [];
    arr.push(j.id);
    variantsByKey.set(j.jobKey, arr);
  }

  const completed = new Map<string, JobResult>();
  const inflight = new Map<string, Promise<JobResult>>();
  const remaining = new Set<string>(byId.keys());
  let aborted = false;

  function isReady(id: string): boolean {
    const job = byId.get(id)!;
    for (const need of job.needs) {
      const variants = variantsByKey.get(need);
      if (!variants) return true; // unknown dep — don't block
      for (const v of variants) {
        if (!completed.has(v)) return false;
      }
    }
    return true;
  }

  function aggregateNeed(jobKey: string): JobResult | undefined {
    const variants = variantsByKey.get(jobKey);
    if (!variants) return undefined;
    let worst: JobStatus = 'success';
    const out: Record<string, string> = {};
    for (const id of variants) {
      const r = completed.get(id);
      if (!r) continue;
      if (r.status === 'failure') worst = 'failure';
      else if (worst !== 'failure' && r.status === 'cancelled') worst = 'cancelled';
      else if (worst === 'success' && r.status === 'skipped') worst = 'skipped';
      Object.assign(out, r.outputs);
    }
    return {
      jobId: jobKey,
      jobName: jobKey,
      status: worst,
      durationMs: 0,
      steps: [],
      outputs: out,
      backend: variants[0] ? completed.get(variants[0])?.backend ?? 'host' : 'host',
    };
  }

  async function execute(id: string): Promise<JobResult> {
    const job = byId.get(id)!;
    const needs: Record<string, JobResult> = {};
    for (const n of job.needs) {
      const agg = aggregateNeed(n);
      if (agg) needs[n] = agg;
    }
    const ctx = opts.buildContext(job, needs);

    // Skip if any need failed AND there's no override condition that says otherwise.
    const upstreamFailed = Object.values(needs).some((n) => n.status === 'failure' || n.status === 'cancelled');
    if (job.ifCondition) {
      ctx.job.status = upstreamFailed ? 'failure' : 'success';
      const should = evalCondition(job.ifCondition, ctx);
      if (!should) {
        return { jobId: job.id, jobName: job.jobName, matrixCell: job.matrixCell, status: 'skipped', durationMs: 0, steps: [], outputs: {}, backend: job.backend, reason: `if: ${job.ifCondition}` };
      }
    } else if (upstreamFailed) {
      return { jobId: job.id, jobName: job.jobName, matrixCell: job.matrixCell, status: 'skipped', durationMs: 0, steps: [], outputs: {}, backend: job.backend, reason: 'upstream failed' };
    }

    opts.onEvent?.({ kind: 'job-start', job });

    const backend = opts.backends[job.backend];
    const t0 = performance.now();
    let session;
    try {
      session = await backend.prepare({ jobId: job.id, hostCwd: opts.hostCwd, job });
    } catch (err) {
      const r: JobResult = {
        jobId: job.id, jobName: job.jobName, matrixCell: job.matrixCell,
        status: 'failure', durationMs: performance.now() - t0, steps: [], outputs: {}, backend: job.backend,
        reason: (err as Error).message,
      };
      opts.onEvent?.({ kind: 'job-end', job, result: r });
      return r;
    }

    const stepResults: StepResult[] = [];
    const stepCtx: Record<string, { outputs: Record<string, string>; outcome: 'success'|'failure'|'skipped'|'cancelled'; conclusion: 'success'|'failure'|'skipped'|'cancelled' }> = {};
    let jobStatus: JobStatus = 'success';
    const aggregateOutputs: Record<string, string> = {};

    for (const step of job.steps) {
      // Step-level if:
      ctx.job.status = jobStatus;
      ctx.steps = stepCtx;
      let shouldRun = true;
      if (step.ifCondition) {
        shouldRun = evalCondition(step.ifCondition, ctx);
      } else if (jobStatus === 'failure') {
        shouldRun = false;
      }

      if (!shouldRun) {
        const r: StepResult = { label: step.label, status: 'skipped', durationMs: 0, outputs: {}, reason: step.ifCondition ?? 'previous failure' };
        stepResults.push(r);
        if (step.raw.id) stepCtx[step.raw.id] = { outputs: {}, outcome: 'skipped', conclusion: 'skipped' };
        opts.onEvent?.({ kind: 'step-end', job, step, result: r });
        continue;
      }

      opts.onEvent?.({ kind: 'step-start', job, step });
      // Re-resolve `${{ ... }}` against the LIVE ctx (which now includes
      // outputs from prior steps in this job). Plan-time substitution
      // happened against an empty stepCtx — references like
      // `${{ steps.foo.outputs.bar }}` would have collapsed to '' at plan
      // time. Reading from step.raw here keeps later refs honest.
      const liveStep: PlannedStep = {
        ...step,
        run: step.raw.run !== undefined ? substituteString(step.raw.run, ctx) : step.run,
        env: { ...substituteEnv(step.raw.env as Record<string, string> | undefined, ctx), ...step.env },
        with: { ...substituteWith(step.raw.with, ctx), ...step.with },
      };
      const r = await backend.exec(session, liveStep);
      stepResults.push(r);
      if (step.raw.id) stepCtx[step.raw.id] = { outputs: r.outputs, outcome: r.status, conclusion: step.continueOnError && r.status === 'failure' ? 'success' : r.status };
      Object.assign(aggregateOutputs, r.outputs);
      opts.onEvent?.({ kind: 'step-end', job, step, result: r });
      if (r.status === 'failure' && !step.continueOnError) {
        jobStatus = 'failure';
      }
    }

    await backend.teardown(session);

    const result: JobResult = {
      jobId: job.id, jobName: job.jobName, matrixCell: job.matrixCell,
      status: jobStatus, durationMs: performance.now() - t0,
      steps: stepResults, outputs: aggregateOutputs, backend: job.backend,
    };
    opts.onEvent?.({ kind: 'job-end', job, result });
    return result;
  }

  // Matrix cells of the same jobKey USED to share the host workspace, so we
  // serialised them. With the host backend's per-cell git-worktree isolation
  // each cell now runs in its own checkout — they're free to run in parallel.
  // The container backend always isolates anyway (one container per job).
  // We retain the serialisation for cells that elected to NOT use a worktree
  // (non-git workspaces, symlink failures on Windows without admin) since
  // those still race on shared writes.

  while (remaining.size > 0 || inflight.size > 0) {
    const ready = [...remaining].filter(isReady);
    while (ready.length > 0 && inflight.size < opts.maxParallel) {
      if (aborted) break;
      const id = ready.shift()!;
      remaining.delete(id);
      const p = execute(id).then((r) => {
        completed.set(id, r);
        inflight.delete(id);
        if (r.status === 'failure' && opts.failFast) aborted = true;
        return r;
      });
      inflight.set(id, p);
    }
    if (inflight.size === 0) break;
    await Promise.race(inflight.values());
  }

  // Any remaining (because of failFast abort) go in as cancelled
  for (const id of remaining) {
    const job = byId.get(id)!;
    completed.set(id, { jobId: id, jobName: job.jobName, matrixCell: job.matrixCell, status: 'cancelled', durationMs: 0, steps: [], outputs: {}, backend: job.backend, reason: 'fail-fast' });
  }

  return jobs.map((j) => completed.get(j.id)!);
}
