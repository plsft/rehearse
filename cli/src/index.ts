#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCompile } from './commands/ci/compile.js';
import { runConvert } from './commands/ci/convert.js';
import { runEstimate } from './commands/ci/estimate.js';
import { runInit } from './commands/ci/init.js';
import { runValidate } from './commands/ci/validate.js';
import { runWatch } from './commands/ci/watch.js';

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const program = new Command();
program
  .name('gg')
  .description('TypeScript pipelines for GitHub Actions')
  .version(readPackageVersion());

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

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
