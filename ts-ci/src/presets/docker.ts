import type { Step } from '../types.js';

export const docker = {
  setupBuildx(): Step {
    return {
      name: 'Set up Docker Buildx',
      uses: 'docker/setup-buildx-action@v3',
    };
  },
  login(registry: string, username: string, password: string): Step {
    return {
      name: `Log in to ${registry}`,
      uses: 'docker/login-action@v3',
      with: { registry, username, password },
    };
  },
  buildPush(
    tags: string | string[],
    options: { context?: string; file?: string; push?: boolean; platforms?: string } = {},
  ): Step {
    const tagStr = Array.isArray(tags) ? tags.join('\n') : tags;
    const withParams: Record<string, string | number | boolean> = {
      tags: tagStr,
      push: options.push ?? true,
    };
    if (options.context) withParams.context = options.context;
    if (options.file) withParams.file = options.file;
    if (options.platforms) withParams.platforms = options.platforms;
    return {
      name: 'Build and push',
      uses: 'docker/build-push-action@v6',
      with: withParams,
    };
  },
};
