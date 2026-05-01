/**
 * POC #3 — Container backend with `services:` support.
 *
 * Validates that we can run a real GitHub Actions job that requires a service
 * container (postgres) on a developer laptop, end-to-end, and beat GitHub's
 * wall clock.
 *
 * Architecture per job:
 *   1. Pull or reuse the runner image (default: node:22-bookworm-slim).
 *   2. Create a private Docker network for the job.
 *   3. Start each `services:` container on that network with health-checks.
 *   4. Wait for services to report healthy.
 *   5. Create one long-lived job container, bind-mount the repo.
 *   6. Run each step via `docker exec` inside the warmed container.
 *   7. On exit (success or fail), tear down the job container, services, network.
 *
 * Reuses @gitgate/ci's `parseWorkflow` for parsing.
 *
 * Usage:
 *   pnpm tsx poc/3-container.ts poc/fixtures/service-postgres.yml
 */
import { parseWorkflow, type ParsedJob, type ParsedStep } from '@gitgate/ci';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

const RUNNER_IMAGE_DEFAULT = 'node:22-bookworm-slim';

interface StepOutcome {
  label: string;
  durationMs: number;
  status: 'ok' | 'fail' | 'skip';
  reason?: string;
  exitCode?: number;
}

interface PhaseTiming {
  pullImages: number;
  network: number;
  servicesStart: number;
  servicesHealthy: number;
  jobContainerCreate: number;
  steps: number;
  cleanup: number;
}

const COLORS: Record<string, string> = {
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
  gray: '\x1b[90m', bold: '\x1b[1m', dim: '\x1b[2m',
};

function color(c: keyof typeof COLORS, s: string): string {
  return process.stdout.isTTY ? `${COLORS[c]}${s}\x1b[0m` : s;
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function exec(cmd: string, args: string[]): { stdout: string; stderr: string; code: number } {
  const r = spawnSync(cmd, args, { encoding: 'utf-8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? -1 };
}

function execStream(
  cmd: string,
  args: string[],
  opts: { quiet?: boolean } = {},
): Promise<number> {
  return new Promise((done) => {
    const proc = spawn(cmd, args, {
      stdio: opts.quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
    });
    proc.on('exit', (code) => done(code ?? -1));
    proc.on('error', () => done(-1));
  });
}

function ensureDockerRunning(): void {
  const r = exec('docker', ['version', '--format', '{{.Server.Version}}']);
  if (r.code !== 0 || !r.stdout.trim()) {
    console.error(color('red', '✗ Docker daemon not reachable.'));
    console.error('  Start Docker Desktop (Windows/macOS) or `sudo systemctl start docker` (Linux).');
    process.exit(2);
  }
  console.log(color('gray', `docker server: ${r.stdout.trim()}`));
}

function imageExistsLocally(image: string): boolean {
  const r = exec('docker', ['image', 'inspect', image]);
  return r.code === 0;
}

async function pullIfMissing(image: string): Promise<number> {
  if (imageExistsLocally(image)) return 0;
  console.log(color('cyan', `· pulling ${image} (this is one-time)`));
  const t0 = performance.now();
  const code = await execStream('docker', ['pull', image]);
  if (code !== 0) throw new Error(`docker pull failed for ${image}`);
  return performance.now() - t0;
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

interface ServiceSpec {
  name: string;
  image: string;
  env: Record<string, string>;
  ports: string[];
  options: string;
}

function parseServices(job: ParsedJob): ServiceSpec[] {
  const out: ServiceSpec[] = [];
  if (!job.services) return out;
  for (const [name, raw] of Object.entries(job.services)) {
    const s = raw as {
      image: string;
      env?: Record<string, string>;
      ports?: string[];
      options?: string;
    };
    out.push({
      name,
      image: s.image,
      env: s.env ?? {},
      ports: s.ports ?? [],
      options: typeof s.options === 'string' ? s.options : '',
    });
  }
  return out;
}

function dockerOptionTokens(options: string): string[] {
  // Split on whitespace but preserve quoted segments. GitHub's `options:` is a
  // single string of CLI flags; we just pass them through.
  if (!options) return [];
  const tokens: string[] = [];
  const re = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(options)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return tokens;
}

async function startService(
  svc: ServiceSpec,
  network: string,
  jobId: string,
): Promise<{ containerId: string; durationMs: number }> {
  const t0 = performance.now();
  const containerName = `runner-${jobId}-svc-${svc.name}`;
  const args = [
    'run', '-d', '--rm',
    '--name', containerName,
    '--network', network,
    '--network-alias', svc.name,
  ];
  for (const [k, v] of Object.entries(svc.env)) args.push('-e', `${k}=${v}`);
  for (const p of svc.ports) args.push('-p', p);
  args.push(...dockerOptionTokens(svc.options));
  args.push(svc.image);
  const r = exec('docker', args);
  if (r.code !== 0) throw new Error(`failed to start service ${svc.name}: ${r.stderr.trim()}`);
  return { containerId: r.stdout.trim(), durationMs: performance.now() - t0 };
}

async function waitHealthy(containerName: string, timeoutMs = 60_000): Promise<number> {
  const t0 = performance.now();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = exec('docker', ['inspect', '--format', '{{.State.Health.Status}}', containerName]);
    const status = r.stdout.trim();
    if (status === 'healthy') return performance.now() - t0;
    if (status === '<no value>' || r.code !== 0) {
      // No healthcheck defined — fall back to short wait.
      await new Promise((r) => setTimeout(r, 1500));
      return performance.now() - t0;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`service ${containerName} did not become healthy in ${timeoutMs}ms`);
}

async function createJobContainer(args: {
  jobId: string;
  image: string;
  network: string;
  cwd: string;
  jobEnv: Record<string, string>;
}): Promise<{ containerId: string; durationMs: number }> {
  const t0 = performance.now();
  const containerName = `runner-${args.jobId}-job`;
  const cwdLinux = args.cwd.replace(/^([A-Za-z]):\\/, (_, d: string) => `/${d.toLowerCase()}/`).replace(/\\/g, '/');
  const cli = [
    'run', '-d', '--rm',
    '--name', containerName,
    '--network', args.network,
    '-w', '/workspace',
    '-v', `${args.cwd}:/workspace`,
    '-e', `GITHUB_WORKSPACE=/workspace`,
    '-e', `CI=true`,
    '-e', `GITHUB_ACTIONS=true`,
  ];
  for (const [k, v] of Object.entries(args.jobEnv)) cli.push('-e', `${k}=${v}`);
  cli.push(args.image, 'sleep', 'infinity');
  const r = exec('docker', cli);
  if (r.code !== 0) throw new Error(`failed to create job container: ${r.stderr.trim()}`);
  void cwdLinux; // not currently used; bind-mount uses native windows path
  return { containerId: r.stdout.trim(), durationMs: performance.now() - t0 };
}

async function execStepInContainer(
  containerName: string,
  step: ParsedStep,
  idx: number,
  jobEnv: Record<string, string>,
): Promise<StepOutcome> {
  const label = step.name ?? step.uses ?? step.run?.split('\n')[0]?.slice(0, 60) ?? `step ${idx + 1}`;
  const t0 = performance.now();

  if (step.uses) {
    // Same skip table as host runner — these are no-ops.
    return { label, durationMs: 0, status: 'skip', reason: `uses: ${step.uses} (host-equiv)` };
  }
  if (!step.run) return { label, durationMs: 0, status: 'skip', reason: 'no run' };

  const envArgs: string[] = [];
  for (const [k, v] of Object.entries(jobEnv)) envArgs.push('-e', `${k}=${v}`);
  for (const [k, v] of Object.entries(step.env ?? {})) envArgs.push('-e', `${k}=${v}`);

  const cli = [
    'exec',
    ...envArgs,
    containerName,
    'bash', '-eo', 'pipefail', '-c', step.run,
  ];

  const code = await execStream('docker', cli);
  return {
    label,
    durationMs: performance.now() - t0,
    status: code === 0 ? 'ok' : 'fail',
    exitCode: code,
  };
}

async function teardown(network: string, containers: string[]): Promise<number> {
  const t0 = performance.now();
  if (containers.length > 0) {
    exec('docker', ['rm', '-f', ...containers]);
  }
  if (network) exec('docker', ['network', 'rm', network]);
  return performance.now() - t0;
}

function pickRunnerImage(runsOn: string | string[]): string {
  const label = (Array.isArray(runsOn) ? runsOn[0] : runsOn) ?? '';
  if (label.startsWith('ubuntu') || label === 'ubuntu-latest') return RUNNER_IMAGE_DEFAULT;
  // Fallback — use ubuntu-equivalent regardless of GH label.
  return RUNNER_IMAGE_DEFAULT;
}

async function runJobContainer(
  jobKey: string,
  job: ParsedJob,
  cwd: string,
): Promise<{ outcomes: StepOutcome[]; timing: PhaseTiming; jobMs: number }> {
  const jobId = `${Date.now().toString(36)}-${shortId()}`;
  const network = `runner-${jobId}`;
  const services = parseServices(job);
  const runnerImage = pickRunnerImage(job['runs-on']);
  const allContainers: string[] = [];

  console.log(color('cyan', `▶ job: ${jobKey}  (${runnerImage})`));
  console.log(color('gray', `  network: ${network}, services: ${services.length}`));

  const timing: PhaseTiming = {
    pullImages: 0, network: 0, servicesStart: 0, servicesHealthy: 0,
    jobContainerCreate: 0, steps: 0, cleanup: 0,
  };

  // Pull images
  const pullStart = performance.now();
  await pullIfMissing(runnerImage);
  for (const svc of services) await pullIfMissing(svc.image);
  timing.pullImages = performance.now() - pullStart;

  // Network
  const netStart = performance.now();
  const nr = exec('docker', ['network', 'create', network]);
  if (nr.code !== 0) throw new Error(`network create failed: ${nr.stderr}`);
  timing.network = performance.now() - netStart;

  const jobStart = performance.now();
  const outcomes: StepOutcome[] = [];

  try {
    // Start services
    const svcStart = performance.now();
    for (const svc of services) {
      const r = await startService(svc, network, jobId);
      allContainers.push(r.containerId);
      console.log(color('gray', `  ✓ service ${svc.name} (${svc.image}) started ${fmtMs(r.durationMs)}`));
    }
    timing.servicesStart = performance.now() - svcStart;

    // Wait healthy
    const hStart = performance.now();
    for (const svc of services) {
      const dur = await waitHealthy(`runner-${jobId}-svc-${svc.name}`);
      console.log(color('gray', `  ✓ service ${svc.name} healthy ${fmtMs(dur)}`));
    }
    timing.servicesHealthy = performance.now() - hStart;

    // Create job container
    const jc = await createJobContainer({
      jobId, image: runnerImage, network, cwd, jobEnv: job.env ?? {},
    });
    allContainers.push(jc.containerId);
    timing.jobContainerCreate = jc.durationMs;
    console.log(color('gray', `  ✓ job container ready ${fmtMs(jc.durationMs)}`));

    // Run steps
    const stepsStart = performance.now();
    let failed = false;
    for (let i = 0; i < job.steps.length; i++) {
      const step = job.steps[i]!;
      if (failed && step['continue-on-error'] !== true) {
        outcomes.push({ label: step.name ?? `step ${i + 1}`, durationMs: 0, status: 'skip', reason: 'previous failure' });
        continue;
      }
      const out = await execStepInContainer(`runner-${jobId}-job`, step, i, job.env ?? {});
      outcomes.push(out);
      const mark = out.status === 'ok' ? color('green', '✓') : out.status === 'fail' ? color('red', '✗') : color('gray', '⊘');
      const tail = out.status === 'skip' ? color('gray', `(${out.reason})`) : color('gray', fmtMs(out.durationMs));
      console.log(`  ${mark} ${out.label.padEnd(50)} ${tail}`);
      if (out.status === 'fail') failed = true;
    }
    timing.steps = performance.now() - stepsStart;
  } finally {
    timing.cleanup = await teardown(network, allContainers);
  }

  return { outcomes, timing, jobMs: performance.now() - jobStart };
}

function printPhaseTable(timing: PhaseTiming, totalMs: number): void {
  const rows: [string, number][] = [
    ['pull images', timing.pullImages],
    ['network create', timing.network],
    ['services start', timing.servicesStart],
    ['services healthy', timing.servicesHealthy],
    ['job container', timing.jobContainerCreate],
    ['steps', timing.steps],
    ['cleanup', timing.cleanup],
  ];
  console.log('\n' + color('bold', 'Phase breakdown'));
  console.log(color('gray', '─'.repeat(50)));
  for (const [k, v] of rows) {
    console.log(`  ${k.padEnd(24)} ${fmtMs(v).padStart(10)}`);
  }
  console.log(color('gray', '─'.repeat(50)));
  console.log(`  ${'total'.padEnd(24)} ${fmtMs(totalMs).padStart(10)}`);
}

async function main(): Promise<void> {
  const wfArg = process.argv[2];
  if (!wfArg) {
    console.error('usage: tsx poc/3-container.ts <workflow.yml>');
    process.exit(2);
  }
  const wfPath = resolve(process.cwd(), wfArg);
  if (!existsSync(wfPath)) {
    console.error(`not found: ${wfPath}`);
    process.exit(2);
  }
  const yaml = readFileSync(wfPath, 'utf-8');
  const wf = parseWorkflow(yaml);

  console.log(color('bold', `runner (container) · ${wf.name ?? wfArg}`));
  console.log(color('gray', `workflow: ${wfPath}`));
  ensureDockerRunning();

  const overall = performance.now();
  const cwd = process.cwd();
  for (const [k, j] of Object.entries(wf.jobs)) {
    const { outcomes, timing, jobMs } = await runJobContainer(k, j, cwd);
    printPhaseTable(timing, jobMs);
    const failed = outcomes.some((o) => o.status === 'fail');
    if (failed) {
      console.log(color('red', '\nFAIL'));
      process.exit(1);
    }
  }
  console.log(color('green', `\nPASS  total ${fmtMs(performance.now() - overall)}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
