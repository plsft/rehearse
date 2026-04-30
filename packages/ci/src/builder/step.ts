import type { ArtifactOptions, CacheConfig, Step } from '../types.js';

export interface RunStepConfig {
  name?: string;
  id?: string;
  shell?: string;
  env?: Record<string, string>;
  condition?: string;
  workingDirectory?: string;
  continueOnError?: boolean;
  timeoutMinutes?: number;
}

export interface ActionStepConfig extends RunStepConfig {
  with?: Record<string, string | number | boolean>;
}

export interface CheckoutOptions {
  ref?: string;
  fetchDepth?: number;
  submodules?: boolean | 'recursive';
  token?: string;
  lfs?: boolean;
  path?: string;
}

function dropUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export const step = {
  /** Inline shell script. */
  run(command: string, config: RunStepConfig = {}): Step {
    if (!command || !command.trim()) {
      throw new Error('step.run(): command is required');
    }
    return dropUndefined({
      ...config,
      run: command,
    } satisfies Step);
  },

  /** Reference a GitHub Action by `owner/repo@ref`. */
  action(uses: string, config: ActionStepConfig = {}): Step {
    if (!uses || !uses.trim()) {
      throw new Error('step.action(): uses is required');
    }
    return dropUndefined({
      ...config,
      uses,
    } satisfies Step);
  },

  /** `actions/checkout@v4` with typed options. */
  checkout(options: CheckoutOptions = {}): Step {
    const withParams: Record<string, string | number | boolean> = {};
    if (options.ref !== undefined) withParams.ref = options.ref;
    if (options.fetchDepth !== undefined) withParams['fetch-depth'] = options.fetchDepth;
    if (options.submodules !== undefined) withParams.submodules = options.submodules;
    if (options.token !== undefined) withParams.token = options.token;
    if (options.lfs !== undefined) withParams.lfs = options.lfs;
    if (options.path !== undefined) withParams.path = options.path;
    return dropUndefined({
      name: 'Checkout',
      uses: 'actions/checkout@v4',
      ...(Object.keys(withParams).length > 0 ? { with: withParams } : {}),
    } satisfies Step);
  },

  /** `actions/upload-artifact@v4`. */
  uploadArtifact(options: ArtifactOptions): Step {
    const withParams: Record<string, string | number | boolean> = {
      name: options.name,
      path: options.path,
    };
    if (options.retentionDays !== undefined) withParams['retention-days'] = options.retentionDays;
    if (options.ifNoFilesFound) withParams['if-no-files-found'] = options.ifNoFilesFound;
    if (options.overwrite !== undefined) withParams.overwrite = options.overwrite;
    return {
      name: `Upload ${options.name}`,
      uses: 'actions/upload-artifact@v4',
      with: withParams,
    };
  },

  /** `actions/download-artifact@v4`. */
  downloadArtifact(name: string, path?: string): Step {
    const withParams: Record<string, string | number | boolean> = { name };
    if (path) withParams.path = path;
    return {
      name: `Download ${name}`,
      uses: 'actions/download-artifact@v4',
      with: withParams,
    };
  },

  /** `actions/cache@v4` with key + restore keys. */
  cache(config: CacheConfig & { name?: string }): Step {
    const path = Array.isArray(config.path) ? config.path.join('\n') : config.path;
    const withParams: Record<string, string | number | boolean> = {
      path,
      key: config.key,
    };
    if (config.restoreKeys && config.restoreKeys.length > 0) {
      withParams['restore-keys'] = config.restoreKeys.join('\n');
    }
    return {
      name: config.name ?? 'Cache',
      uses: 'actions/cache@v4',
      with: withParams,
    };
  },
};
