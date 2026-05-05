import { resolveRunner } from '../builder/runner.js';
import {
  GITHUB_PRICING,
  type CostEstimate,
  type Pipeline,
  type RunnerSpec,
} from '../types.js';

export interface EstimateOptions {
  pipeline: Pipeline;
  /** Map of job name → expected duration in minutes. Missing jobs default to 5. */
  durations?: Record<string, number>;
  /** Number of pipeline runs per month. Default 100. */
  runsPerMonth?: number;
  /** Default duration for jobs not present in `durations`. Default 5. */
  defaultDurationMinutes?: number;
}

function pricePerMinute(spec: RunnerSpec): { github: number; label: string } {
  switch (spec.kind) {
    case 'github': {
      const p = GITHUB_PRICING[spec.label] ?? 0;
      return { github: p, label: spec.label };
    }
    case 'self-hosted':
      return { github: 0, label: spec.labels.join(',') };
    case 'custom':
      return { github: 0, label: Array.isArray(spec.runsOn) ? spec.runsOn.join(',') : spec.runsOn };
  }
}

export function estimate(options: EstimateOptions): CostEstimate {
  const { pipeline } = options;
  const runsPerMonth = options.runsPerMonth ?? 100;
  const defaultDuration = options.defaultDurationMinutes ?? 5;

  let total = 0;
  let totalMinutes = 0;
  const perJob: CostEstimate['perJob'] = [];

  for (const job of pipeline.jobs) {
    const duration = options.durations?.[job.name] ?? defaultDuration;
    const pricing = pricePerMinute(job.runner);
    const cost = pricing.github * duration;
    perJob.push({
      jobName: job.name,
      runner: typeof resolveRunner(job.runner) === 'string'
        ? (resolveRunner(job.runner) as string)
        : (resolveRunner(job.runner) as string[]).join(','),
      durationMinutes: duration,
      costUsd: round(cost),
    });
    total += cost;
    totalMinutes += duration;
  }

  const totalCostUsd = round(total);
  const monthlyCostUsd = round(totalCostUsd * runsPerMonth);

  return {
    totalCostUsd,
    totalMinutes,
    perJob,
    runsPerMonth,
    monthlyCostUsd,
  };
}

function round(n: number, places = 4): number {
  const m = 10 ** places;
  return Math.round(n * m) / m;
}
