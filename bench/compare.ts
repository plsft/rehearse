/**
 * Benchmark harness: runner (us) vs act (incumbent) on the same workflow.
 *
 * Each target is run twice — once cold (so image pulls / dep installs are
 * counted) and once warm (steady-state). Both tools target the same job and
 * the same image where applicable.
 *
 * Usage:
 *   pnpm tsx bench/compare.ts                 # all targets
 *   pnpm tsx bench/compare.ts --skip-cold     # warm runs only (faster)
 *   pnpm tsx bench/compare.ts --only our-ci   # one target
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

interface Target {
  name: string;
  workflow: string;     // path relative to repoRoot
  cwd: string;          // path relative to repoRoot
  job?: string;
  ourBackend: 'host' | 'container';
  /** Image to use when running via act (-P ubuntu-latest=<image>). */
  actImage?: string;
  /** Skip act entirely (e.g. needs bun in the image, which standard images don't have). */
  actSkip?: boolean;
  actSkipReason?: string;
  description: string;
}

const REPO_ROOT = resolve(process.cwd());

const TARGETS: Target[] = [
  {
    name: 'our-ci',
    workflow: '.github/workflows/ci.yml',
    cwd: '.',
    ourBackend: 'host',
    actImage: 'node:22-bookworm-slim',
    description: 'our own typecheck + test workflow',
  },
  {
    name: 'service-postgres',
    workflow: 'poc/fixtures/service-postgres.yml',
    cwd: '.',
    ourBackend: 'container',
    actImage: 'node:22-bookworm-slim',
    description: 'workflow with postgres:16-alpine service',
  },
  {
    name: 'node-matrix',
    workflow: 'poc/fixtures/node-matrix.yml',
    cwd: '.',
    ourBackend: 'host',
    actImage: 'node:22-bookworm-slim',
    description: 'matrix [18.x, 20.x, 22.x] of CPU-bound node steps (act can run this)',
  },
  {
    name: 'hono-bun',
    workflow: 'poc/playground/hono/.github/workflows/ci.yml',
    cwd: 'poc/playground/hono',
    job: 'bun',
    ourBackend: 'host',
    actSkip: true,
    actSkipReason: 'standard act images do not have bun preinstalled',
    description: 'real OSS workflow: honojs/hono bun job',
  },
  {
    name: 'hono-node-matrix',
    workflow: 'poc/playground/hono/.github/workflows/ci.yml',
    cwd: 'poc/playground/hono',
    job: 'node',
    ourBackend: 'host',
    actSkip: true,
    actSkipReason: 'requires bun + multi-version node in image',
    description: 'matrix over node [18.18.2, 20.x, 22.x] (3 cells, parallel for us)',
  },
];

interface Run {
  ms: number;
  ok: boolean;
  exit: number;
  timedOut?: boolean;
}

function spawnTimed(
  cmd: string,
  args: string[],
  cwd: string,
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<Run> {
  const t0 = performance.now();
  return new Promise((done) => {
    const proc = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: 'ignore',
    });
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        try { proc.kill('SIGKILL'); } catch { /* */ }
      }, opts.timeoutMs);
    }
    proc.on('error', () => {
      if (timer) clearTimeout(timer);
      done({ ms: performance.now() - t0, ok: false, exit: -1, timedOut });
    });
    proc.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      done({ ms: performance.now() - t0, ok: code === 0 && !timedOut, exit: code ?? -1, timedOut });
    });
  });
}

const OURS_TIMEOUT_MS = 5 * 60 * 1000;
const ACT_TIMEOUT_MS = 6 * 60 * 1000;

async function runOurs(target: Target): Promise<Run> {
  const cli = resolve(REPO_ROOT, 'runner/dist/cli.js');
  const wf = resolve(REPO_ROOT, target.workflow);
  const targetCwd = resolve(REPO_ROOT, target.cwd);
  const args = ['run', wf, '--cwd', targetCwd, '--quiet', '--backend', target.ourBackend];
  if (target.job) args.push('--job', target.job);
  return spawnTimed('node', [cli, ...args], targetCwd, { timeoutMs: OURS_TIMEOUT_MS });
}

function commandExists(cmd: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, [cmd], { stdio: 'ignore' }).status === 0;
}

function dockerRunning(): boolean {
  if (!commandExists('docker')) return false;
  return spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' }).status === 0;
}

const HAS_ACT = commandExists('act');
const HAS_DOCKER = dockerRunning();

async function runAct(target: Target): Promise<Run | null> {
  if (target.actSkip) return null;
  if (!HAS_ACT) return null; // act not on PATH — silently skip the comparison
  if (!HAS_DOCKER) return null; // act needs docker; without it, skip
  const image = target.actImage ?? 'node:22-bookworm-slim';
  const wf = resolve(REPO_ROOT, target.workflow);
  const args = ['-W', wf, '--no-cache-server'];
  if (target.job) args.push('-j', target.job);
  // Map common runner labels to a host-friendly image. Without this, act
  // refuses to run unfamiliar labels (e.g. ubicloud-standard-4).
  for (const label of [
    'ubuntu-latest', 'ubuntu-22.04', 'ubuntu-24.04',
    'ubicloud-standard-2', 'ubicloud-standard-4', 'ubicloud-standard-8',
  ]) {
    args.push('-P', `${label}=${image}`);
  }
  args.push('--quiet');
  return spawnTimed('act', args, resolve(REPO_ROOT, target.cwd), { timeoutMs: ACT_TIMEOUT_MS });
}

interface Result {
  target: Target;
  ours: { cold?: Run; warm: Run };
  act: { cold?: Run; warm: Run } | null;
}

function fmtMs(ms: number): string { return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`; }
function fmtSpeedup(ours: number, them: number): string {
  if (!ours || !them) return '—';
  const x = them / ours;
  return x >= 1 ? `${x.toFixed(2)}× faster` : `${(1 / x).toFixed(2)}× slower`;
}

function parseArgs(argv: string[]): { skipCold: boolean; only: string[] } {
  const out = { skipCold: false, only: [] as string[] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--skip-cold') out.skipCold = true;
    if (a === '--only') out.only.push(argv[++i] ?? '');
  }
  return out;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const targets = cli.only.length > 0 ? TARGETS.filter((t) => cli.only.includes(t.name)) : TARGETS;
  if (targets.length === 0) {
    console.error('no targets matched');
    process.exit(2);
  }

  console.log(`\nenvironment: ${process.platform} ${process.arch}, node ${process.version}`);
  console.log(`  act installed:  ${HAS_ACT ? '✓' : '✗ (act-vs-us comparisons will be skipped)'}`);
  console.log(`  docker running: ${HAS_DOCKER ? '✓' : '✗ (container-backend + service targets will be skipped)'}`);
  // Auto-skip targets that need docker when it isn't there.
  const filtered = targets.filter((t) => {
    if (t.ourBackend === 'container' && !HAS_DOCKER) {
      console.log(`  ⊘ ${t.name} — needs docker, skipped`);
      return false;
    }
    return true;
  });

  // Sanity: runner CLI built?
  if (!existsSync(resolve(REPO_ROOT, 'runner/dist/cli.js'))) {
    console.error('runner/dist/cli.js missing — run `pnpm --filter @rehearse/runner build` first');
    process.exit(2);
  }
  // Clean up any stragglers from prior runs so port bindings / volume mounts
  // don't collide. Best-effort.
  await spawnTimed('docker', ['ps', '-aq', '--filter', 'name=act-'], REPO_ROOT, { timeoutMs: 5000 });
  await spawnTimed('bash', ['-c', 'docker rm -f $(docker ps -aq --filter "name=act-") 2>/dev/null; docker rm -f $(docker ps -aq --filter "name=runner-") 2>/dev/null; true'], REPO_ROOT, { timeoutMs: 30_000 });

  const results: Result[] = [];
  for (const target of filtered) {
    process.stdout.write(`\n▶ ${target.name} — ${target.description}\n`);

    let oursCold: Run | undefined;
    let actCold: Run | null | undefined;
    if (!cli.skipCold) {
      process.stdout.write('  cold (us)  … ');
      oursCold = await runOurs(target);
      process.stdout.write(`${fmtMs(oursCold.ms)} ${oursCold.ok ? '✓' : '✗'}\n`);

      if (!target.actSkip) {
        process.stdout.write('  cold (act) … ');
        actCold = await runAct(target);
        process.stdout.write(`${actCold ? fmtMs(actCold.ms) + (actCold.timedOut ? ' ⏱ timeout' : actCold.ok ? ' ✓' : ' ✗') : (HAS_ACT && HAS_DOCKER ? 'skipped' : 'skipped (no act/docker)')}\n`);
      }
    }

    process.stdout.write('  warm (us)  … ');
    const oursWarm = await runOurs(target);
    process.stdout.write(`${fmtMs(oursWarm.ms)} ${oursWarm.ok ? '✓' : '✗'}\n`);

    let actWarm: Run | null = null;
    if (!target.actSkip) {
      process.stdout.write('  warm (act) … ');
      actWarm = await runAct(target);
      process.stdout.write(`${actWarm ? fmtMs(actWarm.ms) + (actWarm.timedOut ? ' ⏱ timeout' : actWarm.ok ? ' ✓' : ' ✗') : (HAS_ACT && HAS_DOCKER ? 'skipped' : 'skipped (no act/docker)')}\n`);
    } else {
      process.stdout.write(`  warm (act) … skipped (${target.actSkipReason})\n`);
    }

    results.push({
      target,
      ours: { ...(oursCold ? { cold: oursCold } : {}), warm: oursWarm },
      act: target.actSkip
        ? null
        : { ...(actCold ? { cold: actCold } : {}), warm: actWarm! },
    });
  }

  // Final table
  console.log('\n\n' + '═'.repeat(96));
  console.log('Benchmark — runner vs act');
  console.log('═'.repeat(96));
  console.log(`${pad('Target', 20)} ${pad('Ours warm', 12)} ${pad('act warm', 12)} ${pad('Ours cold', 12)} ${pad('act cold', 12)} ${pad('Speedup (warm)', 18)}`);
  console.log('─'.repeat(96));
  for (const r of results) {
    const oc = r.ours.cold;
    const ac = r.act?.cold ?? null;
    const ow = r.ours.warm;
    const aw = r.act?.warm ?? null;
    console.log(
      pad(r.target.name, 20) + ' ' +
      pad(fmtMs(ow.ms), 12) + ' ' +
      pad(aw ? fmtMs(aw.ms) : '—', 12) + ' ' +
      pad(oc ? fmtMs(oc.ms) : '—', 12) + ' ' +
      pad(ac ? fmtMs(ac.ms) : '—', 12) + ' ' +
      pad(aw ? fmtSpeedup(ow.ms, aw.ms) : '—', 18),
    );
  }
  console.log('═'.repeat(96));

  // Markdown for paste-into-RESULTS.md
  console.log('\n## Markdown table\n');
  console.log('| Target | Ours warm | act warm | Ours cold | act cold | Warm speedup |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const r of results) {
    const ow = r.ours.warm; const oc = r.ours.cold;
    const aw = r.act?.warm ?? null; const ac = r.act?.cold ?? null;
    console.log(
      `| ${r.target.name} | ${fmtMs(ow.ms)} | ${aw ? fmtMs(aw.ms) : '—'} | ${oc ? fmtMs(oc.ms) : '—'} | ${ac ? fmtMs(ac.ms) : '—'} | ${aw ? fmtSpeedup(ow.ms, aw.ms) : '—'} |`,
    );
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

main().catch((err) => { console.error(err); process.exit(1); });
