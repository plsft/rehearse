/** A complete CI pipeline definition. */
export interface Pipeline {
  name: string;
  triggers: Trigger[];
  jobs: Job[];
  permissions?: Permissions;
  concurrency?: Concurrency;
  defaults?: Defaults;
  env?: Record<string, string>;
  /** Rehearse-specific metadata embedded in the YAML header. */
  rehearse?: RehearseConfig;
}

export interface Job {
  name: string;
  runner: RunnerSpec;
  steps: Step[];
  needs?: string[];
  condition?: string;
  matrix?: MatrixConfig;
  timeoutMinutes?: number;
  permissions?: Permissions;
  outputs?: Record<string, string>;
  env?: Record<string, string>;
  services?: Record<string, ServiceContainer>;
  defaults?: Defaults;
  environment?: JobEnvironment;
  concurrency?: Concurrency;
  continueOnError?: boolean;
}

export interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  shell?: string;
  with?: Record<string, string | number | boolean>;
  env?: Record<string, string>;
  condition?: string;
  workingDirectory?: string;
  continueOnError?: boolean;
  timeoutMinutes?: number;
}

export type Trigger =
  | { event: 'push'; config?: PushTriggerConfig }
  | { event: 'pull_request'; config?: PullRequestTriggerConfig }
  | { event: 'workflow_dispatch'; config?: WorkflowDispatchConfig }
  | { event: 'schedule'; config: { cron: string } }
  | { event: 'release'; config?: { types?: string[] } }
  | { event: 'workflow_run'; config?: { workflows?: string[]; types?: string[] } };

export type TriggerEvent = Trigger['event'];
export type TriggerConfig = NonNullable<Trigger['config']>;

export interface PushTriggerConfig {
  branches?: string[];
  branchesIgnore?: string[];
  tags?: string[];
  tagsIgnore?: string[];
  paths?: string[];
  pathsIgnore?: string[];
}

export interface PullRequestTriggerConfig {
  branches?: string[];
  branchesIgnore?: string[];
  paths?: string[];
  pathsIgnore?: string[];
  types?: Array<
    | 'opened'
    | 'edited'
    | 'closed'
    | 'reopened'
    | 'synchronize'
    | 'ready_for_review'
    | 'labeled'
    | 'unlabeled'
  >;
}

export interface WorkflowDispatchConfig {
  inputs?: Record<string, WorkflowInput>;
}

export interface WorkflowInput {
  description: string;
  required?: boolean;
  default?: string | number | boolean;
  type?: 'string' | 'number' | 'boolean' | 'choice' | 'environment';
  options?: string[];
}

export type RunnerSpec =
  | { kind: 'github'; label: string }
  | { kind: 'self-hosted'; labels: string[] }
  | { kind: 'custom'; runsOn: string | string[] };

export interface MatrixConfig {
  include?: Array<Record<string, string | number | boolean>>;
  exclude?: Array<Record<string, string | number | boolean>>;
  variables?: Record<string, Array<string | number | boolean>>;
  failFast?: boolean;
  maxParallel?: number;
}

export interface ServiceContainer {
  image: string;
  ports?: string[];
  env?: Record<string, string>;
  options?: string;
  credentials?: { username: string; password: string };
}

export type Permissions =
  | 'read-all'
  | 'write-all'
  | {
      actions?: PermissionLevel;
      checks?: PermissionLevel;
      contents?: PermissionLevel;
      deployments?: PermissionLevel;
      idToken?: PermissionLevel;
      issues?: PermissionLevel;
      packages?: PermissionLevel;
      pages?: PermissionLevel;
      pullRequests?: PermissionLevel;
      repositoryProjects?: PermissionLevel;
      securityEvents?: PermissionLevel;
      statuses?: PermissionLevel;
    };

export type PermissionLevel = 'read' | 'write' | 'none';

export interface Concurrency {
  group: string;
  cancelInProgress?: boolean;
}

export interface Defaults {
  run?: { shell?: string; workingDirectory?: string };
}

export type JobEnvironment = string | { name: string; url?: string };

export interface ArtifactOptions {
  name: string;
  path: string;
  retentionDays?: number;
  ifNoFilesFound?: 'warn' | 'error' | 'ignore';
  overwrite?: boolean;
}

export interface CacheConfig {
  path: string | string[];
  key: string;
  restoreKeys?: string[];
}

export interface RehearseConfig {
  /** When set, Rehearse Platform applies this minimum confidence threshold. */
  confidenceMinimum?: number;
  /** Provenance is recorded for agent-authored runs by default. */
  provenance?: boolean;
}

/** Per-minute pricing for GitHub-hosted runner labels (USD, public price list). */
export const GITHUB_PRICING: Record<string, number> = {
  'ubuntu-latest': 0.008,
  'ubuntu-22.04': 0.008,
  'ubuntu-24.04': 0.008,
  'ubuntu-latest-4-cores': 0.016,
  'ubuntu-latest-8-cores': 0.032,
  'ubuntu-latest-16-cores': 0.064,
  'ubuntu-latest-32-cores': 0.128,
  'ubuntu-latest-64-cores': 0.256,
  'macos-latest': 0.08,
  'macos-13': 0.08,
  'macos-14': 0.16,
  'macos-15': 0.16,
  'windows-latest': 0.016,
  'windows-2022': 0.016,
};

export interface CostEstimate {
  totalCostUsd: number;
  totalMinutes: number;
  perJob: Array<{
    jobName: string;
    runner: string;
    durationMinutes: number;
    costUsd: number;
  }>;
  runsPerMonth: number;
  monthlyCostUsd: number;
}
