#!/usr/bin/env node
/**
 * `runner` CLI — local-first GitHub Actions runner.
 */
import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { compat, printReport } from './compat.js';
import { run } from './orchestrator.js';
import { watchWorkflow } from './watch.js';
import type { BackendName } from './types.js';

// Read the version from our own package.json at runtime so `runner --version`
// always matches what's installed (vs hardcoding a string that drifts).
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
  .name('runner')
  .description('Local-first runner for GitHub Actions workflows')
  .version(readPackageVersion());

program
  .command('run <workflow>', { isDefault: true })
  .description('Run a GitHub Actions workflow on this machine, or remotely with --remote')
  .option('-j, --job <name>', 'restrict to a single job (matrix variants of that job all run)')
  .option('-b, --backend <type>', 'host | container | auto', 'auto')
  .option('-p, --max-parallel <n>', 'max concurrent jobs', (v) => Number(v))
  .option('-c, --cwd <dir>', 'working directory (default: inferred from workflow path)')
  .option('--fail-fast', 'cancel sibling jobs on first failure')
  .option('--quiet', 'minimal output (machine-readable result only)')
  .option('--bench', 'output a single JSON line for benchmarking')
  .option('--env-file <file>', 'load env vars from file (KEY=VALUE per line)')
  .option('--remote', 'execute on a Rehearse Pro hosted sprite (requires REHEARSE_TOKEN)')
  .option('--api-url <url>', 'override Pro API URL', 'https://api.rehearse.sh')
  .action(async (workflow, opts) => {
    const env = opts.envFile ? loadEnvFile(opts.envFile) : {};

    if (opts.remote) {
      const code = await runRemote({
        workflowPath: workflow,
        apiUrl: opts.apiUrl,
        token: process.env.REHEARSE_TOKEN ?? '',
      });
      process.exit(code);
    }

    const result = await run({
      workflowPath: workflow,
      cwd: opts.cwd,
      jobFilter: opts.job,
      backend: opts.backend === 'auto' ? 'auto' : (opts.backend as BackendName),
      maxParallel: opts.maxParallel,
      failFast: opts.failFast,
      verbosity: opts.quiet || opts.bench ? 'quiet' : 'normal',
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
 * --remote: ship the workflow YAML to api.rehearse.sh/v1/runs and stream the
 * result back. The Pro API forwards the workflow to the team's dedicated
 * Sprite microVM, executes it there with caches preserved between runs, and
 * returns the same kind of output you'd get locally.
 */
async function runRemote(args: {
  workflowPath: string;
  apiUrl: string;
  token: string;
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

  process.stderr.write(pc.dim(`[remote] POST ${args.apiUrl}/v1/runs\n`));
  const start = Date.now();
  const res = await fetch(`${args.apiUrl}/v1/runs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ workflow, workflow_path: args.workflowPath }),
  });
  const text = await res.text();
  if (!res.ok) {
    process.stderr.write(pc.red(`remote API ${res.status}: ${text}\n`));
    return 2;
  }
  const body = JSON.parse(text) as {
    run_id: string;
    status: 'success' | 'failure';
    exit_code: number;
    duration_ms: number;
    log: string;
  };
  process.stdout.write(body.log);
  if (!body.log.endsWith('\n')) process.stdout.write('\n');
  const wallSeconds = ((Date.now() - start) / 1000).toFixed(1);
  const color = body.status === 'success' ? pc.green : pc.red;
  process.stderr.write(
    color(`[remote] ${body.status} · exit=${body.exit_code} · sprite=${body.duration_ms}ms · wall=${wallSeconds}s\n`),
  );
  process.stderr.write(pc.dim(`[remote] run id: ${body.run_id}\n`));
  return body.status === 'success' ? 0 : 1;
}

program
  .command('watch <workflow>')
  .description('Re-run the workflow on file changes (inner-loop dev tool)')
  .option('-j, --job <name>', 'restrict to a single job')
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
      backend: opts.backend === 'auto' ? 'auto' : (opts.backend as BackendName),
      maxParallel: opts.maxParallel,
      verbosity: 'normal',
      env,
      secrets: env,
    });
  });

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
# Auto-generated by 'runner install-hook'. Edit or delete to disable.
exec npx runner run ${JSON.stringify(opts.workflow)}${opts.job ? ` --job ${JSON.stringify(opts.job)}` : ''} --fail-fast
`;
    writeFileSync(hookPath, body, 'utf-8');
    try {
      mkdirSync(hooksDir, { recursive: true });
      // Best-effort chmod on Unix
      if (process.platform !== 'win32') {
        const { chmodSync } = await import('node:fs');
        chmodSync(hookPath, 0o755);
      }
    } catch { /* non-fatal */ }
    console.log(pc.green('✓ pre-push hook installed at ') + pc.cyan(hookPath));
  });

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
