#!/usr/bin/env node
/**
 * `rh` — the unified Rehearse CLI.
 *
 * Top-level commands (the runner):
 *   rh run <workflow.yml>          execute a GitHub Actions workflow locally
 *   rh watch <workflow.yml>        re-run on every save (debounced)
 *   rh install-hook                write .git/hooks/pre-push
 *   rh compat <workflow.yml>       static audit of workflow compatibility
 *
 * Subcommand (the TypeScript pipeline SDK ergonomics):
 *   rh ci init                     scaffold .rehearse/pipelines/ci.ts
 *   rh ci compile                  TS → standard GitHub Actions YAML
 *   rh ci convert <yaml>           YAML → TypeScript (migration starter)
 *   rh ci validate                 type-check pipelines
 *   rh ci watch                    recompile on save
 *   rh ci estimate                 estimate GH-hosted CI cost
 *
 * Both `--remote` (offload to a Rehearse Pro VM) and the local-runner
 * paths share this single binary; pass --remote on `rh run` to flip
 * between them.
 */
// Register tsx's TS+ESM loader globally so .ts pipelines and configs work
// regardless of the consuming project's package.json `type` field. Side-effect
// import — must run before any user-code import.
import { register } from 'tsx/esm/api';
register();

import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { runCompile } from './commands/ci/compile.js';
import { runConvert } from './commands/ci/convert.js';
import { runEstimate } from './commands/ci/estimate.js';
import { runInit } from './commands/ci/init.js';
import { runValidate } from './commands/ci/validate.js';
import { runWatch as runCiWatch } from './commands/ci/watch.js';
import { compat, printReport } from './runner/compat.js';
import { run } from './runner/orchestrator.js';
import { detectGitContext, redactToken } from './runner/remote.js';
import { watchWorkflow } from './runner/watch.js';
import type { BackendName } from './runner/types.js';

/**
 * --matrix flag collector. Accepts either repeated flags or comma-separated
 * pairs:
 *   --matrix os=ubuntu-latest --matrix node-version=20
 *   --matrix os=ubuntu-latest,node-version=20
 * Both produce the same `{ os: 'ubuntu-latest', 'node-version': '20' }`.
 */
function collectMatrix(value: string, prev: Record<string, string> = {}): Record<string, string> {
  for (const pair of value.split(',')) {
    if (!pair.trim()) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      throw new Error(`invalid --matrix value: "${pair}" (expected key=value)`);
    }
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (!k) throw new Error(`invalid --matrix value: "${pair}" (empty key)`);
    prev[k] = v;
  }
  return prev;
}

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
  .name('rh')
  .description('Local-first GitHub Actions runner + TypeScript-pipeline CLI')
  .version(readPackageVersion());

// ============================================================
// rh run <workflow>  — the runner
// ============================================================
program
  .command('run <workflow>')
  .description('Run a GitHub Actions workflow on this machine, or remotely with --remote')
  .option('-j, --job <name>', 'restrict to a single job (matrix variants of that job all run)')
  .option('-m, --matrix <key=value>', 'filter to specific matrix cell(s); repeatable or comma-separated (e.g. --matrix os=ubuntu-latest)', collectMatrix, {})
  .option('-b, --backend <type>', 'host | container | auto', 'auto')
  .option('-p, --max-parallel <n>', 'max concurrent jobs', (v) => Number(v))
  .option('-c, --cwd <dir>', 'working directory (default: inferred from workflow path)')
  .option('--fail-fast', 'cancel sibling jobs on first failure')
  .option('--quiet', 'minimal output (machine-readable result only)')
  .option('--verbose', "stream every step's stdout in real time (default: capture and dump on failure)")
  .option('--bench', 'output a single JSON line for benchmarking')
  .option('--env-file <file>', 'load env vars from file (KEY=VALUE per line)')
  .option('--remote', 'execute on a Rehearse Pro VM (requires REHEARSE_TOKEN)')
  .option('--api-url <url>', 'override Pro API URL', 'https://api.rehearse.sh')
  .option('--repo-url <url>', 'override the git remote URL shipped to the VM (auto-detected from `git remote get-url origin`)')
  .option('--repo-ref <ref>', 'override the git ref shipped to the VM (auto-detected from `git rev-parse HEAD`)')
  .option('--repo-subdir <path>', 'override the in-repo subdirectory the VM cd-s into after clone (auto-detected from cwd)')
  .action(async (workflow, opts) => {
    const env = opts.envFile ? loadEnvFile(opts.envFile) : {};

    if (opts.remote) {
      const code = await runRemote({
        workflowPath: workflow,
        apiUrl: opts.apiUrl,
        token: process.env.REHEARSE_TOKEN ?? '',
        cwd: opts.cwd ?? process.cwd(),
        repoUrlOverride: opts.repoUrl,
        repoRefOverride: opts.repoRef,
        repoSubdirOverride: opts.repoSubdir,
        env,
      });
      process.exit(code);
    }

    const result = await run({
      workflowPath: workflow,
      cwd: opts.cwd,
      jobFilter: opts.job,
      matrixFilter: opts.matrix && Object.keys(opts.matrix).length > 0 ? opts.matrix : undefined,
      backend: opts.backend === 'auto' ? 'auto' : (opts.backend as BackendName),
      maxParallel: opts.maxParallel,
      failFast: opts.failFast,
      verbosity: opts.quiet || opts.bench ? 'quiet' : 'normal',
      verbose: opts.verbose === true,
      env,
      secrets: env,
    });
    if (opts.bench) {
      process.stdout.write(JSON.stringify({
        status: result.status,
        durationMs: result.durationMs,
        jobs: result.jobs.map((j) => ({ id: j.jobId, status: j.status, ms: j.durationMs })),
      }) + '\n');
    }
    process.exit(result.status === 'failure' ? 1 : 0);
  });

/**
 * --remote: ship the workflow YAML to api.rehearse.sh/v1/runs/stream and
 * stream stdout/stderr back as it happens. The Pro API forwards to the
 * team's dedicated VM with persistent caches.
 *
 * Repo context (origin URL + current SHA) is auto-detected from cwd so that
 * `actions/checkout` on the VM clones the right repo at the right ref.
 * Override with --repo-url / --repo-ref. Pass GH_TOKEN or GITHUB_TOKEN in
 * the environment to clone private repos (embedded in the URL the VM
 * receives; never logged).
 */
async function runRemote(args: {
  workflowPath: string;
  apiUrl: string;
  token: string;
  cwd: string;
  repoUrlOverride?: string;
  repoRefOverride?: string;
  repoSubdirOverride?: string;
  /**
   * Env vars (typically loaded from --env-file). Shipped to the VM where
   * they become BOTH process env AND `${{ secrets.* }}` for workflow
   * expansion. This is what makes `rh run --remote` usable for deploys
   * (AWS_ACCESS_KEY_ID, AZURE_CREDENTIALS, GH_TOKEN, etc.).
   */
  env?: Record<string, string>;
}): Promise<number> {
  if (!args.token) {
    process.stderr.write(pc.red('REHEARSE_TOKEN env var is required for --remote\n'));
    process.stderr.write('Get one at https://pro.rehearse.sh/dashboard/keys\n');
    return 2;
  }
  let workflow: string;
  try {
    workflow = readFileSync(resolve(args.workflowPath), 'utf-8');
  } catch (err) {
    process.stderr.write(pc.red(`could not read workflow: ${(err as Error).message}\n`));
    return 2;
  }

  const git = detectGitContext(args.cwd);
  const repoUrl = args.repoUrlOverride ?? git.repoUrl;
  const repoRef = args.repoRefOverride ?? git.repoRef;
  const repoSubdir = args.repoSubdirOverride ?? git.repoSubdir;

  if (!repoUrl) {
    process.stderr.write(
      pc.yellow(
        '[remote] no git remote detected — VM will run the workflow without source ' +
          'checkout. If your workflow uses actions/checkout, pass --repo-url / --repo-ref ' +
          'or run from a clone with `origin` set.\n',
      ),
    );
  } else {
    const safeUrl = redactToken(repoUrl);
    const subdirHint = repoSubdir ? ` subdir=${repoSubdir}` : '';
    process.stderr.write(
      pc.dim(`[remote] repo=${safeUrl}${repoRef ? ` ref=${repoRef}` : ''}${subdirHint}\n`),
    );
  }

  process.stderr.write(pc.dim(`[remote] POST ${args.apiUrl}/v1/runs/stream\n`));
  const start = Date.now();
  const res = await fetch(`${args.apiUrl}/v1/runs/stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workflow,
      workflow_path: args.workflowPath,
      repo_url: repoUrl ?? undefined,
      repo_ref: repoRef ?? undefined,
      repo_subdir: repoSubdir ?? undefined,
      env: args.env && Object.keys(args.env).length > 0 ? args.env : undefined,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    process.stderr.write(pc.red(`remote API ${res.status}: ${text}\n`));
    return 2;
  }
  const runId = res.headers.get('X-Run-Id') ?? '';

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let finalExit = -1;
  let finalDuration = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      let obj: { t?: string; d?: string; exit?: number; duration_ms?: number };
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.t === 'out' && obj.d !== undefined) process.stdout.write(obj.d + '\n');
      else if (obj.t === 'err' && obj.d !== undefined) process.stderr.write(obj.d + '\n');
      else if (obj.t === 'done') {
        finalExit = typeof obj.exit === 'number' ? obj.exit : -1;
        finalDuration = typeof obj.duration_ms === 'number' ? obj.duration_ms : 0;
      }
    }
  }

  const wallSeconds = ((Date.now() - start) / 1000).toFixed(1);
  const status = finalExit === 0 ? 'success' : 'failure';
  const color = finalExit === 0 ? pc.green : pc.red;
  process.stderr.write(
    color(`[remote] ${status} · exit=${finalExit} · vm=${finalDuration}ms · wall=${wallSeconds}s\n`),
  );
  if (runId) process.stderr.write(pc.dim(`[remote] run id: ${runId}\n`));
  return finalExit === 0 ? 0 : 1;
}

// ============================================================
// rh watch <workflow>  — re-run on file changes
// ============================================================
program
  .command('watch <workflow>')
  .description('Re-run the workflow on file changes (inner-loop dev tool)')
  .option('-j, --job <name>', 'restrict to a single job')
  .option('-m, --matrix <key=value>', 'filter to specific matrix cell(s); repeatable or comma-separated', collectMatrix, {})
  .option('-b, --backend <type>', 'host | container | auto', 'auto')
  .option('-p, --max-parallel <n>', 'max concurrent jobs', (v) => Number(v))
  .option('-c, --cwd <dir>', 'working directory')
  .option('--env-file <file>', 'load env vars from file')
  .action(async (workflow, opts) => {
    const env = opts.envFile ? loadEnvFile(opts.envFile) : {};
    await watchWorkflow({
      workflowPath: workflow,
      cwd: opts.cwd,
      jobFilter: opts.job,
      matrixFilter: opts.matrix && Object.keys(opts.matrix).length > 0 ? opts.matrix : undefined,
      backend: opts.backend === 'auto' ? 'auto' : (opts.backend as BackendName),
      maxParallel: opts.maxParallel,
      verbosity: 'normal',
      env,
      secrets: env,
    });
  });

// ============================================================
// rh compat <workflow>  — static audit
// ============================================================
program
  .command('compat <workflow>')
  .description('Audit a workflow YAML for runner compatibility')
  .option('--json', 'machine-readable JSON output')
  .action(async (workflow: string, opts: { json?: boolean }) => {
    try {
      const result = compat(workflow);
      printReport(result, { json: opts.json });
      process.exit(0);
    } catch (err) {
      console.error(pc.red('✗ ' + ((err as Error).message ?? String(err))));
      process.exit(2);
    }
  });

// ============================================================
// rh install-hook  — pre-push git hook
// ============================================================
program
  .command('install-hook')
  .description('Install a pre-push git hook that runs the workflow before letting you push')
  .option('-w, --workflow <path>', '.github/workflows/<name>.yml to run', '.github/workflows/ci.yml')
  .option('-j, --job <name>', 'restrict to one job (recommended for speed)')
  .action(async (opts) => {
    const repoRoot = process.cwd();
    const hooksDir = resolve(repoRoot, '.git', 'hooks');
    if (!existsSync(hooksDir)) {
      console.error(pc.red('✗ .git/hooks not found — run from inside a git repo.'));
      process.exit(2);
    }
    const hookPath = resolve(hooksDir, 'pre-push');
    const body = `#!/usr/bin/env bash
# Auto-generated by 'rh install-hook'. Edit or delete to disable.
exec npx -p @rehearse/cli rh run ${JSON.stringify(opts.workflow)}${opts.job ? ` --job ${JSON.stringify(opts.job)}` : ''} --fail-fast
`;
    writeFileSync(hookPath, body, 'utf-8');
    if (process.platform !== 'win32') {
      try {
        const { chmodSync } = await import('node:fs');
        chmodSync(hookPath, 0o755);
      } catch { /* non-fatal */ }
    }
    console.log(pc.green('✓ pre-push hook installed at ') + pc.cyan(hookPath));
  });

// ============================================================
// rh ci ...  — TypeScript pipeline SDK ergonomics
// ============================================================
const ci = program.command('ci').description('Compile and manage TypeScript pipelines');
ci.command('compile')
  .description('Compile .rehearse/pipelines/**/*.ts → .github/workflows/*.yml')
  .option('--out <dir>', 'Output directory')
  .option('--in <dir>', 'Pipelines directory')
  .action(async (opts: { out?: string; in?: string }) => {
    process.exit(await runCompile({ outDir: opts.out, pipelinesDir: opts.in }));
  });
ci.command('init')
  .description('Scaffold .rehearse/pipelines/ci.ts and rehearse.config.ts')
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
  .action(async () => process.exit(await runCiWatch()));
ci.command('estimate')
  .description('Estimate GitHub-hosted CI cost per run and per month')
  .option('--durations <json>', 'JSON object: { jobName: minutes }')
  .option('--runs-per-month <n>', 'Pipeline runs per month', (v) => Number(v))
  .action(async (opts: { durations?: string; runsPerMonth?: number }) =>
    process.exit(await runEstimate(opts)),
  );

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  const body = readFileSync(path, 'utf-8');
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(pc.red('✗ ' + ((err as Error).message ?? String(err))));
  process.exit(1);
});

// Ensure mkdirSync is reachable for any consumer that imports its types.
void mkdirSync;
