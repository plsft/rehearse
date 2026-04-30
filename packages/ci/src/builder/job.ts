import type {
  Concurrency,
  Defaults,
  Job,
  JobEnvironment,
  MatrixConfig,
  Permissions,
  RunnerSpec,
  ServiceContainer,
  Step,
} from '../types.js';

export interface JobConfig {
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
  environment?: JobEnvironment | string;
  concurrency?: Concurrency;
  continueOnError?: boolean;
}

/**
 * Define a job in a pipeline. The `name` is the human-readable label and is
 * also used to derive the YAML job key (lowercased, hyphenated).
 *
 * @example
 * job('build', {
 *   runner: Runner.ubicloud('standard-4'),
 *   steps: [step.checkout(), node.setup('20'), node.test()],
 * });
 */
export function job(name: string, config: JobConfig): Job {
  if (!name || !name.trim()) {
    throw new Error('job(): name is required');
  }
  if (!config.runner) {
    throw new Error(`job("${name}"): runner is required`);
  }
  if (!config.steps || config.steps.length === 0) {
    throw new Error(`job("${name}"): at least one step is required`);
  }
  const environment =
    typeof config.environment === 'string' ? { name: config.environment } : config.environment;
  return {
    name,
    runner: config.runner,
    steps: config.steps,
    needs: config.needs,
    condition: config.condition,
    matrix: config.matrix,
    timeoutMinutes: config.timeoutMinutes,
    permissions: config.permissions,
    outputs: config.outputs,
    env: config.env,
    services: config.services,
    defaults: config.defaults,
    environment,
    concurrency: config.concurrency,
    continueOnError: config.continueOnError,
  };
}
