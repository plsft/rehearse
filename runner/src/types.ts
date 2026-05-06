/**
 * Runner core types.
 *
 * The runner takes a parsed GitHub Actions workflow and executes it on the
 * developer's machine, choosing per-job between a host backend (fast,
 * direct subprocess) and a container backend (Docker, slower but parity-safe).
 */

import type { ParsedJob, ParsedStep } from '@rehearse/ci';

export type StepStatus = 'success' | 'failure' | 'skipped' | 'cancelled';
export type JobStatus = StepStatus;

export interface StepResult {
  label: string;
  status: StepStatus;
  exitCode?: number;
  durationMs: number;
  outputs: Record<string, string>;
  reason?: string;
}

export interface JobResult {
  jobId: string;
  jobName: string;
  matrixCell?: Record<string, unknown>;
  status: JobStatus;
  durationMs: number;
  steps: StepResult[];
  outputs: Record<string, string>;
  backend: BackendName;
  reason?: string;
}

export interface RunResult {
  workflow: string;
  status: JobStatus;
  durationMs: number;
  jobs: JobResult[];
}

export type BackendName = 'host' | 'container';

/** A job that has matrix-expanded into one concrete invocation. */
export interface PlannedJob {
  /** Stable id within a single run: `<jobKey>` or `<jobKey>:<cell-hash>` for matrix. */
  id: string;
  jobKey: string;
  jobName: string;
  raw: ParsedJob;
  matrixCell?: Record<string, unknown>;
  needs: string[];
  /** if: condition, evaluated against parent context once needs resolve. */
  ifCondition?: string;
  /** Pre-resolved per-job env (after matrix substitution). */
  env: Record<string, string>;
  /** Pre-resolved steps (matrix-substituted). */
  steps: PlannedStep[];
  backend: BackendName;
  runsOn: string;
  /**
   * Job is structurally unsupported (e.g. remote reusable workflow we
   * can't expand). Scheduler short-circuits to `status: 'skipped'` with
   * this reason instead of running the (empty) step list.
   */
  unsupportedReason?: string;
}

export interface PlannedStep {
  index: number;
  label: string;
  raw: ParsedStep;
  /** Pre-resolved env (matrix-substituted). */
  env: Record<string, string>;
  /** Pre-resolved `with:` (matrix-substituted). */
  with: Record<string, unknown>;
  /** Pre-resolved run script (matrix-substituted). */
  run?: string;
  uses?: string;
  shell?: string;
  workingDirectory?: string;
  ifCondition?: string;
  continueOnError: boolean;
}

export interface SessionWorktree {
  path: string;
  cleanup: () => void;
}

/**
 * One concrete execution context for a job. Backends create one of these in
 * `prepare()`, hand it to each `exec()` call, and tear it down in `teardown()`.
 */
export interface JobSession {
  jobId: string;
  /** Working directory on the host (the repo root). */
  hostCwd: string;
  /** Path inside the session view: same as hostCwd for host, /workspace for container. */
  workdir: string;
  env: Record<string, string>;
  /** For container backends: container + network names (for cleanup + service references). */
  containerName?: string;
  network?: string;
  serviceContainers?: string[];
  /** For host backends: a path to a per-job temp dir for outputs. */
  tempDir: string;
  /**
   * If set, a per-cell git-worktree was created for this session and
   * should be torn down when the job finishes. The worktree path is
   * `workdir`; `hostCwd` still points at the parent repo root.
   */
  worktree?: SessionWorktree;
}

export interface Backend {
  readonly name: BackendName;
  prepare(args: PrepareArgs): Promise<JobSession>;
  exec(session: JobSession, step: PlannedStep): Promise<StepResult>;
  teardown(session: JobSession): Promise<void>;
}

export interface PrepareArgs {
  jobId: string;
  hostCwd: string;
  job: PlannedJob;
}

/**
 * Subset of the GitHub Actions context object that we evaluate `${{ … }}`
 * expressions against. Conservatively typed.
 */
export interface ExpressionContext {
  matrix?: Record<string, unknown>;
  env: Record<string, string>;
  secrets: Record<string, string>;
  vars: Record<string, string>;
  github: Record<string, unknown>;
  needs: Record<string, NeedsContext>;
  steps: Record<string, StepContext>;
  job: { status: JobStatus };
  runner: { os: string; arch: string; temp: string };
  inputs: Record<string, unknown>;
}

export interface NeedsContext {
  result: JobStatus;
  outputs: Record<string, string>;
}

export interface StepContext {
  outputs: Record<string, string>;
  outcome: StepStatus;
  conclusion: StepStatus;
}

export interface RunOptions {
  workflowPath: string;
  /** Repo root; defaults to `dirname(dirname(dirname(workflowPath)))` if path matches `.github/workflows/*.yml`. */
  cwd?: string;
  /** Restrict to one job (matrix-expanded variants of that job still all run). */
  jobFilter?: string;
  /** Force a backend; default is auto (host unless services/container/runs-on incompatible). */
  backend?: BackendName | 'auto';
  /** Max parallel jobs. Default = min(cpus, 4). */
  maxParallel?: number;
  /** Logger granularity. */
  verbosity?: 'quiet' | 'normal' | 'verbose';
  /** When true, exit non-zero on first failure (no parallel job continuation). */
  failFast?: boolean;
  /** Cache directory; default `<cwd>/.runner/cache`. */
  cacheDir?: string;
  /** Artifact directory; default `<cwd>/.runner/artifacts`. */
  artifactDir?: string;
  /** Extra env applied to every job (e.g. from .runner/.env). */
  env?: Record<string, string>;
  /** Secrets resolved up front (loaded from .runner/.env or env vars). */
  secrets?: Record<string, string>;
}
