import type { Concurrency, Defaults, GitGateConfig, Job, Permissions, Pipeline, Trigger } from '../types.js';

export interface PipelineConfig {
  triggers: Trigger[];
  jobs: Job[];
  permissions?: Permissions;
  concurrency?: Concurrency;
  defaults?: Defaults;
  env?: Record<string, string>;
  gitgate?: GitGateConfig;
}

/**
 * Define a CI pipeline. Returns a typed Pipeline object — call `compile()` to
 * produce GitHub Actions YAML.
 *
 * @example
 * const ci = pipeline('CI', {
 *   triggers: [triggers.pullRequest()],
 *   jobs: [job('build', { runner: Runner.ubicloud('standard-4'), steps: [...] })],
 * });
 */
export function pipeline(name: string, config: PipelineConfig): Pipeline {
  if (!name || !name.trim()) {
    throw new Error('pipeline(): name is required');
  }
  if (!config.triggers || config.triggers.length === 0) {
    throw new Error(`pipeline("${name}"): at least one trigger is required`);
  }
  if (!config.jobs || config.jobs.length === 0) {
    throw new Error(`pipeline("${name}"): at least one job is required`);
  }
  return {
    name,
    triggers: config.triggers,
    jobs: config.jobs,
    permissions: config.permissions,
    concurrency: config.concurrency,
    defaults: config.defaults,
    env: config.env,
    gitgate: config.gitgate,
  };
}
