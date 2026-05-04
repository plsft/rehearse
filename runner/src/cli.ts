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
import { detectGitContext, redactToken } from './remote.js';
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
  .option('--repo-url <url>', 'override the git remote URL shipped to the sprite (auto-detected from `git remote get-url origin`)')
  .option('--repo-ref <ref>', 'override the git ref shipped to the sprite (auto-detected from `git rev-parse HEAD`)')
  .option('--repo-subdir <path>', 'override the in-repo subdirectory the sprite cd-s into after clone (auto-detected from cwd)')
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
 * --remote: ship the workflow YAML to api.rehearse.sh/v1/runs/stream and
 * stream stdout/stderr back as it happens. The Pro API forwards to the
 * team's dedicated Sprite microVM with persistent caches.
 *
 * Repo context (origin URL + current SHA) is auto-detected from cwd so that
 * `actions/checkout` on the sprite clones the right repo at the right ref.
 * Override with --repo-url / --repo-ref. Pass GH_TOKEN or GITHUB_TOKEN in
 * the environment to clone private repos (embedded in the URL the sprite
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
        '[remote] no git remote detected — sprite will run the workflow without source ' +
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
    color(`[remote] ${status} · exit=${finalExit} · sprite=${finalDuration}ms · wall=${wallSeconds}s\n`),
  );
  if (runId) process.stderr.write(pc.dim(`[remote] run id: ${runId}\n`));
  return finalExit === 0 ? 0 : 1;
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
exec npx @rehearse/runner run ${JSON.stringify(opts.workflow)}${opts.job ? ` --job ${JSON.stringify(opts.job)}` : ''} --fail-fast
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
