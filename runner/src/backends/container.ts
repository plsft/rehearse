/**
 * Container backend: pre-pulled image, long-lived job container with
 * bind-mounted repo, services on a private network.
 *
 * Each job session creates: 1 docker network, N service containers, 1 job
 * container. Steps run via `docker exec` against the job container.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Backend, JobSession, PrepareArgs, PlannedStep, StepResult } from '../types.js';
import { runShim, hasShim } from '../shims/index.js';

const DEFAULT_RUNNER_IMAGE = 'node:22-bookworm-slim';

export interface ContainerBackendOptions {
  /** Image used as the job container. Defaults to node:22-bookworm-slim. */
  runnerImage?: string;
}

export class ContainerBackend implements Backend {
  readonly name = 'container' as const;
  constructor(private readonly opts: ContainerBackendOptions = {}) {}

  async prepare(args: PrepareArgs): Promise<JobSession> {
    ensureDockerRunning();
    const safeId = args.jobId.replace(/[^A-Za-z0-9_.-]+/g, '_');
    const network = `runner-${safeId}`;
    const services = parseServices(args.job.raw);
    const allContainers: string[] = [];

    const runnerImage = pickRunnerImage(args.job.runsOn, this.opts.runnerImage);
    await pullIfMissing(runnerImage);
    for (const svc of services) await pullIfMissing(svc.image);

    runDocker(['network', 'create', network], { throwOnError: true });

    try {
      for (const svc of services) {
        const containerName = `runner-${safeId}-svc-${svc.name}`;
        const cli: string[] = [
          'run', '-d', '--rm',
          '--name', containerName,
          '--network', network,
          '--network-alias', svc.name,
        ];
        for (const [k, v] of Object.entries(svc.env)) cli.push('-e', `${k}=${v}`);
        for (const p of svc.ports) cli.push('-p', p);
        cli.push(...dockerOptionTokens(svc.options));
        cli.push(svc.image);
        const r = runDocker(cli, { throwOnError: true });
        allContainers.push(r.stdout.trim());
        await waitHealthy(containerName);
      }

      const jobContainerName = `runner-${safeId}-job`;
      const cli: string[] = [
        'run', '-d', '--rm',
        '--name', jobContainerName,
        '--network', network,
        '-w', '/workspace',
        '-v', `${args.hostCwd}:/workspace`,
        '-e', 'GITHUB_WORKSPACE=/workspace',
        '-e', 'CI=true',
        '-e', 'GITHUB_ACTIONS=true',
      ];
      for (const [k, v] of Object.entries(args.job.env)) cli.push('-e', `${k}=${v}`);
      cli.push(runnerImage, 'sleep', 'infinity');
      const r = runDocker(cli, { throwOnError: true });
      allContainers.push(r.stdout.trim());

      return {
        jobId: args.jobId,
        hostCwd: args.hostCwd,
        workdir: '/workspace',
        env: args.job.env,
        containerName: jobContainerName,
        network,
        serviceContainers: services.map((s) => `runner-${safeId}-svc-${s.name}`),
        tempDir: mkdtempSync(resolve(tmpdir(), `runner-${safeId}-`)),
      };
    } catch (err) {
      // Clean up partial state on prepare failure
      for (const c of allContainers) runDocker(['rm', '-f', c]);
      runDocker(['network', 'rm', network]);
      throw err;
    }
  }

  async exec(session: JobSession, step: PlannedStep): Promise<StepResult> {
    const t0 = performance.now();

    if (step.uses && hasShim(step.uses)) {
      return runShim(step, session, this.name);
    }
    if (step.uses) {
      return { label: step.label, status: 'skipped', durationMs: 0, outputs: {}, reason: `uses: ${step.uses} (no shim, no-op)` };
    }
    if (!step.run || !session.containerName) {
      return { label: step.label, status: 'skipped', durationMs: 0, outputs: {}, reason: 'no run' };
    }

    const cli: string[] = ['exec'];
    for (const [k, v] of Object.entries(session.env)) cli.push('-e', `${k}=${v}`);
    for (const [k, v] of Object.entries(step.env)) cli.push('-e', `${k}=${v}`);
    if (step.workingDirectory) cli.push('-w', `/workspace/${step.workingDirectory}`);
    cli.push(session.containerName, 'bash', '-eo', 'pipefail', '-c', step.run);

    return new Promise<StepResult>((done) => {
      const proc = spawn('docker', cli, { stdio: 'inherit' });
      proc.on('error', (err) => done({
        label: step.label,
        status: 'failure',
        exitCode: -1,
        durationMs: performance.now() - t0,
        outputs: {},
        reason: err.message,
      }));
      proc.on('exit', (code) => done({
        label: step.label,
        status: code === 0 ? 'success' : 'failure',
        exitCode: code ?? -1,
        durationMs: performance.now() - t0,
        outputs: {},
      }));
    });
  }

  async teardown(session: JobSession): Promise<void> {
    if (session.containerName) runDocker(['rm', '-f', session.containerName]);
    for (const svc of session.serviceContainers ?? []) runDocker(['rm', '-f', svc]);
    if (session.network) runDocker(['network', 'rm', session.network]);
  }
}

interface ServiceSpec { name: string; image: string; env: Record<string, string>; ports: string[]; options: string }

function parseServices(job: { services?: Record<string, unknown> }): ServiceSpec[] {
  const out: ServiceSpec[] = [];
  if (!job.services) return out;
  for (const [name, raw] of Object.entries(job.services)) {
    const s = raw as { image: string; env?: Record<string, string>; ports?: string[]; options?: string };
    out.push({ name, image: s.image, env: s.env ?? {}, ports: s.ports ?? [], options: typeof s.options === 'string' ? s.options : '' });
  }
  return out;
}

function dockerOptionTokens(options: string): string[] {
  if (!options) return [];
  const tokens: string[] = [];
  const re = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(options)) !== null) tokens.push(m[1] ?? m[2] ?? m[3] ?? '');
  return tokens;
}

function runDocker(args: string[], opts: { throwOnError?: boolean } = {}): { stdout: string; stderr: string; code: number } {
  const r = spawnSync('docker', args, { encoding: 'utf-8' });
  const out = { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? -1 };
  if (opts.throwOnError && out.code !== 0) {
    throw new Error(`docker ${args.join(' ')} failed: ${out.stderr.trim()}`);
  }
  return out;
}

function ensureDockerRunning(): void {
  const r = runDocker(['version', '--format', '{{.Server.Version}}']);
  if (r.code !== 0 || !r.stdout.trim()) {
    throw new Error('Docker daemon not reachable. Start Docker Desktop or systemd service.');
  }
}

function imageExistsLocally(image: string): boolean {
  return runDocker(['image', 'inspect', image]).code === 0;
}

async function pullIfMissing(image: string): Promise<void> {
  if (imageExistsLocally(image)) return;
  const code: number = await new Promise((d) => {
    const p = spawn('docker', ['pull', image], { stdio: 'inherit' });
    p.on('exit', (c) => d(c ?? -1));
    p.on('error', () => d(-1));
  });
  if (code !== 0) throw new Error(`docker pull failed for ${image}`);
}

async function waitHealthy(name: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = runDocker(['inspect', '--format', '{{.State.Health.Status}}', name]);
    const status = r.stdout.trim();
    if (status === 'healthy') return;
    if (status === '<no value>' || r.code !== 0) {
      await new Promise((res) => setTimeout(res, 1500));
      return;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`service ${name} did not become healthy in ${timeoutMs}ms`);
}

function pickRunnerImage(runsOn: string, override?: string): string {
  if (override) return override;
  // For now everything maps to a node-friendly Debian image. We can add
  // more granular mappings (windows-latest → mcr.microsoft.com/.../servercore)
  // later, but on a Linux/macOS Docker host that's not where the value is.
  void runsOn;
  return DEFAULT_RUNNER_IMAGE;
}
