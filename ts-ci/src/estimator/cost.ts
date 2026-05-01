import { resolveRunner } from '../builder/runner.js';
import {
  GITHUB_PRICING,
  UBICLOUD_PRICING,
  type CostEstimate,
  type Pipeline,
  type RunnerSpec,
  type UbicloudSize,
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

const UBICLOUD_TO_GITHUB_TIER: Record<UbicloudSize, string> = {
  'standard-2': 'ubuntu-latest',
  'standard-4': 'ubuntu-latest-4-cores',
  'standard-8': 'ubuntu-latest-8-cores',
  'standard-16': 'ubuntu-latest-16-cores',
  'standard-30': 'ubuntu-latest-32-cores',
  'standard-60': 'ubuntu-latest-64-cores',
  'premium-2': 'ubuntu-latest-4-cores',
  'premium-4': 'ubuntu-latest-8-cores',
  'premium-8': 'ubuntu-latest-16-cores',
  'gpu-standard-1': 'ubuntu-latest-16-cores',
  'arm-2': 'ubuntu-latest',
  'arm-4': 'ubuntu-latest-4-cores',
  'arm-8': 'ubuntu-latest-8-cores',
};

function pricePerMinute(spec: RunnerSpec): { ubicloud?: number; github?: number; label: string } {
  switch (spec.kind) {
    case 'ubicloud':
      return {
        ubicloud: UBICLOUD_PRICING[spec.size],
        github: GITHUB_PRICING[UBICLOUD_TO_GITHUB_TIER[spec.size]] ?? 0.008,
        label: `ubicloud-${spec.size}`,
      };
    case 'github': {
      const p = GITHUB_PRICING[spec.label] ?? 0;
      return { github: p, label: spec.label };
    }
    case 'self-hosted':
      return { label: spec.labels.join(',') };
    case 'custom':
      return { label: Array.isArray(spec.runsOn) ? spec.runsOn.join(',') : spec.runsOn };
  }
}

export function estimate(options: EstimateOptions): CostEstimate {
  const { pipeline } = options;
  const runsPerMonth = options.runsPerMonth ?? 100;
  const defaultDuration = options.defaultDurationMinutes ?? 5;

  let total = 0;
  let totalMinutes = 0;
  let githubTotal = 0;
  const perJob: CostEstimate['perJob'] = [];

  for (const job of pipeline.jobs) {
    const duration = options.durations?.[job.name] ?? defaultDuration;
    const pricing = pricePerMinute(job.runner);
    const ubiCost = (pricing.ubicloud ?? pricing.github ?? 0) * duration;
    perJob.push({
      jobName: job.name,
      runner: typeof resolveRunner(job.runner) === 'string'
        ? (resolveRunner(job.runner) as string)
        : (resolveRunner(job.runner) as string[]).join(','),
      durationMinutes: duration,
      costUsd: round(ubiCost),
    });
    total += ubiCost;
    totalMinutes += duration;
    githubTotal += (pricing.github ?? 0) * duration;
  }

  const totalCostUsd = round(total);
  const monthlyCostUsd = round(totalCostUsd * runsPerMonth);

  let comparison: CostEstimate['comparison'];
  if (githubTotal > 0 && githubTotal > total) {
    const savingsUsd = round(githubTotal - total);
    const savingsPercent = round(((githubTotal - total) / githubTotal) * 100, 1);
    comparison = {
      githubCostUsd: round(githubTotal),
      savingsUsd,
      savingsPercent,
    };
  }

  return {
    totalCostUsd,
    totalMinutes,
    perJob,
    comparison,
    runsPerMonth,
    monthlyCostUsd,
  };
}

function round(n: number, places = 4): number {
  const m = 10 ** places;
  return Math.round(n * m) / m;
}
