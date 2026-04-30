#!/usr/bin/env node
import { Command } from 'commander';
import { runCompile } from './commands/ci/compile.js';
import { runConvert } from './commands/ci/convert.js';
import { runEstimate } from './commands/ci/estimate.js';
import { runInit } from './commands/ci/init.js';
import { runValidate } from './commands/ci/validate.js';
import { runWatch } from './commands/ci/watch.js';
import { runGateProvenance } from './commands/gate/provenance.js';
import { runGateScore } from './commands/gate/score.js';
import { runGateStatus } from './commands/gate/status.js';

const program = new Command();
program
  .name('gg')
  .description('GitGate — TypeScript pipelines and agent governance')
  .version('0.1.0');

const ci = program.command('ci').description('Compile and manage TypeScript pipelines');
ci.command('compile')
  .description('Compile .gitgate/pipelines/**/*.ts → .github/workflows/*.yml')
  .option('--out <dir>', 'Output directory')
  .option('--in <dir>', 'Pipelines directory')
  .action(async (opts: { out?: string; in?: string }) => {
    process.exit(await runCompile({ outDir: opts.out, pipelinesDir: opts.in }));
  });
ci.command('init')
  .description('Scaffold .gitgate/pipelines/ci.ts and gitgate.config.ts')
  .action(async () => process.exit(await runInit()));
ci.command('convert <yamlFile>')
  .description('Convert a GitHub Actions YAML file to TypeScript')
  .option('--out <dir>', 'Output directory')
  .action(async (yamlFile: string, opts: { out?: string }) =>
    process.exit(await runConvert(yamlFile, opts)),
  );
ci.command('validate')
  .description('Validate that all pipelines compile cleanly')
  .action(async () => process.exit(await runValidate()));
ci.command('watch')
  .description('Watch pipelines and recompile on change')
  .action(async () => process.exit(await runWatch()));
ci.command('estimate')
  .description('Estimate Ubicloud cost vs GitHub-hosted runners')
  .option('--durations <json>', 'JSON object: { jobName: minutes }')
  .option('--runs-per-month <n>', 'Pipeline runs per month', (v) => Number(v))
  .action(async (opts: { durations?: string; runsPerMonth?: number }) =>
    process.exit(await runEstimate(opts)),
  );

const gate = program.command('gate').description('Inspect agent governance for the current repo');
gate
  .command('status')
  .description('Show governance state for the current repo')
  .action(async () => process.exit(await runGateStatus()));
gate
  .command('score <pr>')
  .description('Show Merge Confidence breakdown for a PR')
  .action(async (pr: string) => process.exit(await runGateScore(pr)));
gate
  .command('provenance <pr>')
  .description('Show provenance events for a PR')
  .action(async (pr: string) => process.exit(await runGateProvenance(pr)));

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
