import { describe, expect, it, vi } from 'vitest';
import { runJobs } from '../src/runner/scheduler.js';
import type {
  Backend,
  ExpressionContext,
  JobResult,
  JobSession,
  PlannedJob,
  PlannedStep,
  StepResult,
} from '../src/runner/types.js';

function step(label: string, run: string): PlannedStep {
  return {
    index: 0,
    label,
    raw: { run },
    env: {},
    with: {},
    run,
    continueOnError: false,
  };
}

function job(id: string, opts: Partial<PlannedJob> = {}): PlannedJob {
  return {
    id,
    jobKey: id,
    jobName: id,
    raw: { 'runs-on': 'ubuntu-latest', steps: [] },
    needs: [],
    env: {},
    steps: [step('s1', 'echo hi')],
    backend: 'host',
    runsOn: 'ubuntu-latest',
    ...opts,
  };
}

function makeBackend(opts: { execImpl?: (job: PlannedJob, step: PlannedStep) => Promise<StepResult> } = {}): Backend & { calls: string[] } {
  const calls: string[] = [];
  const backend: Backend & { calls: string[] } = {
    name: 'host',
    calls,
    async prepare(args): Promise<JobSession> {
      calls.push(`prepare:${args.jobId}`);
      return { jobId: args.jobId, hostCwd: args.hostCwd, workdir: args.hostCwd, env: {}, tempDir: '/tmp' };
    },
    async exec(_, step): Promise<StepResult> {
      const j = (this as Backend & { calls: string[] }).calls;
      j.push(`exec:${step.label}`);
      if (opts.execImpl) {
        const fakeJob = { id: 'x', jobKey: 'x', jobName: 'x' } as PlannedJob;
        return opts.execImpl(fakeJob, step);
      }
      return { label: step.label, status: 'success', exitCode: 0, durationMs: 1, outputs: {} };
    },
    async teardown(s) { calls.push(`teardown:${s.jobId}`); },
  };
  return backend;
}

function ctxFor(): ExpressionContext {
  return {
    env: {}, secrets: {}, vars: {}, github: {}, needs: {}, steps: {},
    job: { status: 'success' },
    runner: { os: 'Linux', arch: 'X64', temp: '/tmp' },
    inputs: {},
  };
}

describe('scheduler', () => {
  it('runs a single job', async () => {
    const backend = makeBackend();
    const results = await runJobs([job('a')], {
      maxParallel: 1,
      backends: { host: backend, container: backend },
      hostCwd: '/repo',
      buildContext: () => ctxFor(),
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('success');
  });

  it('runs jobs in parallel up to maxParallel', async () => {
    const exec = vi.fn(async (_j, step: PlannedStep) => {
      await new Promise((r) => setTimeout(r, 50));
      return { label: step.label, status: 'success' as const, exitCode: 0, durationMs: 50, outputs: {} };
    });
    const backend = makeBackend({ execImpl: exec });
    const t0 = Date.now();
    await runJobs([job('a'), job('b'), job('c'), job('d')], {
      maxParallel: 4,
      backends: { host: backend, container: backend },
      hostCwd: '/repo',
      buildContext: () => ctxFor(),
    });
    const elapsed = Date.now() - t0;
    // Four 50ms jobs in parallel should take ~50ms wall clock, definitely under 150ms.
    expect(elapsed).toBeLessThan(150);
  });

  it('respects needs: ordering', async () => {
    const order: string[] = [];
    const backend: Backend = {
      name: 'host',
      async prepare(args) { return { jobId: args.jobId, hostCwd: args.hostCwd, workdir: args.hostCwd, env: {}, tempDir: '/tmp' }; },
      async exec(_, step) {
        order.push(step.label);
        await new Promise((r) => setTimeout(r, 5));
        return { label: step.label, status: 'success', exitCode: 0, durationMs: 5, outputs: {} };
      },
      async teardown() {},
    };
    await runJobs(
      [
        job('a', { steps: [step('a-step', 'echo')] }),
        job('b', { needs: ['a'], steps: [step('b-step', 'echo')] }),
        job('c', { needs: ['b'], steps: [step('c-step', 'echo')] }),
      ],
      {
        maxParallel: 4,
        backends: { host: backend, container: backend },
        hostCwd: '/repo',
        buildContext: () => ctxFor(),
      },
    );
    expect(order).toEqual(['a-step', 'b-step', 'c-step']);
  });

  it('skips dependents when a need fails', async () => {
    const backend: Backend = {
      name: 'host',
      async prepare(args) { return { jobId: args.jobId, hostCwd: args.hostCwd, workdir: args.hostCwd, env: {}, tempDir: '/tmp' }; },
      async exec(_, step) {
        const status = step.label === 'a-step' ? 'failure' as const : 'success' as const;
        return { label: step.label, status, exitCode: status === 'failure' ? 1 : 0, durationMs: 1, outputs: {} };
      },
      async teardown() {},
    };
    const results = await runJobs(
      [
        job('a', { steps: [step('a-step', 'echo')] }),
        job('b', { needs: ['a'], steps: [step('b-step', 'echo')] }),
      ],
      {
        maxParallel: 2,
        backends: { host: backend, container: backend },
        hostCwd: '/repo',
        buildContext: () => ctxFor(),
      },
    );
    expect(results.find((r) => r.jobId === 'a')!.status).toBe('failure');
    expect(results.find((r) => r.jobId === 'b')!.status).toBe('skipped');
  });
});
