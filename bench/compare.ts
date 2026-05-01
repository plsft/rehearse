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
import { spawn } from 'node:child_process';
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
    name: 'hono-bun',
    workflow: 'poc/playground/hono/.github/workflows/ci.yml',
    cwd: 'poc/playground/hono',
    job: 'bun',
    ourBackend: 'host',
    actSkip: true,
    actSkipReason: 'standard act images do not have bun preinstalled',
    description: 'real OSS workflow: honojs/hono bun job',
  },
];

interface Run {
  ms: number;
  ok: boolean;
  exit: number;
}

function spawnTimed(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<Run> {
  const t0 = performance.now();
  return new Promise((done) => {
    const proc = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'ignore',
    });
    proc.on('error', () => done({ ms: performance.now() - t0, ok: false, exit: -1 }));
    proc.on('exit', (code) => done({ ms: performance.now() - t0, ok: code === 0, exit: code ?? -1 }));
  });
}

async function runOurs(target: Target): Promise<Run> {
  const cli = resolve(REPO_ROOT, 'runner/dist/cli.js');
  const args = ['run', target.workflow, '--quiet', '--backend', target.ourBackend];
  if (target.job) args.push('--job', target.job);
  return spawnTimed('node', [cli, ...args], resolve(REPO_ROOT, target.cwd));
}

async function runAct(target: Target): Promise<Run | null> {
  if (target.actSkip) return null;
  const image = target.actImage ?? 'node:22-bookworm-slim';
  const args = ['-W', target.workflow, '--no-cache-server'];
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
  return spawnTimed('act', args, resolve(REPO_ROOT, target.cwd));
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

  // Sanity: runner CLI built?
  if (!existsSync(resolve(REPO_ROOT, 'runner/dist/cli.js'))) {
    console.error('runner/dist/cli.js missing — run `pnpm --filter @gitgate/runner build` first');
    process.exit(2);
  }

  const results: Result[] = [];
  for (const target of targets) {
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
        process.stdout.write(`${actCold ? fmtMs(actCold.ms) + (actCold.ok ? ' ✓' : ' ✗') : 'skipped'}\n`);
      }
    }

    process.stdout.write('  warm (us)  … ');
    const oursWarm = await runOurs(target);
    process.stdout.write(`${fmtMs(oursWarm.ms)} ${oursWarm.ok ? '✓' : '✗'}\n`);

    let actWarm: Run | null = null;
    if (!target.actSkip) {
      process.stdout.write('  warm (act) … ');
      actWarm = await runAct(target);
      process.stdout.write(`${actWarm ? fmtMs(actWarm.ms) + (actWarm.ok ? ' ✓' : ' ✗') : 'skipped'}\n`);
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
