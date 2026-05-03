import { estimate, type Pipeline } from '@rehearse/ci';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../../utils/config.js';
import { error, info, table } from '../../utils/output.js';

async function listPipelineFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listPipelineFiles(full)));
    else if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.js'))) out.push(full);
  }
  return out;
}

export interface EstimateFlags {
  durations?: string;
  runsPerMonth?: number;
}

export async function runEstimate(flags: EstimateFlags = {}): Promise<number> {
  const cwd = process.cwd();
  const cfg = await loadConfig(cwd);
  const pipelinesDir = path.resolve(cwd, cfg.pipelinesDir);
  const files = await listPipelineFiles(pipelinesDir).catch(() => []);
  if (files.length === 0) {
    error(`No pipelines found under ${cfg.pipelinesDir}`);
    return 1;
  }
  let durations: Record<string, number> | undefined;
  if (flags.durations) {
    try {
      durations = JSON.parse(flags.durations) as Record<string, number>;
    } catch {
      error(`Invalid --durations JSON: ${flags.durations}`);
      return 1;
    }
  }
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const [key, val] of Object.entries(mod)) {
      if (!isPipeline(val)) continue;
      const result = estimate({
        pipeline: val,
        durations,
        runsPerMonth: flags.runsPerMonth ?? 100,
      });
      info(`${path.relative(cwd, file)} :: ${key}`);
      console.log(
        table(
          result.perJob.map((j) => ({
            job: j.jobName,
            runner: j.runner,
            minutes: j.durationMinutes,
            'cost ($)': j.costUsd.toFixed(4),
          })),
        ),
      );
      console.log('');
      console.log(`Total per run:    $${result.totalCostUsd.toFixed(4)}`);
      console.log(`Total minutes:    ${result.totalMinutes}`);
      console.log(`Runs per month:   ${result.runsPerMonth}`);
      console.log(`Monthly cost:     $${result.monthlyCostUsd.toFixed(2)}`);
      if (result.comparison) {
        console.log('');
        console.log(`vs GitHub-hosted: $${result.comparison.githubCostUsd.toFixed(4)}/run`);
        console.log(
          `Savings:          $${result.comparison.savingsUsd.toFixed(4)} (${result.comparison.savingsPercent}%)`,
        );
      }
      console.log('');
    }
  }
  return 0;
}

function isPipeline(val: unknown): val is Pipeline {
  return (
    !!val &&
    typeof val === 'object' &&
    'name' in val &&
    'triggers' in val &&
    'jobs' in val
  );
}
