import { step } from '../builder/step.js';
import type { Step } from '../types.js';

export const bun = {
  setup(version?: string): Step {
    return {
      name: `Setup Bun${version ? ` ${version}` : ''}`,
      uses: 'oven-sh/setup-bun@v2',
      ...(version ? { with: { 'bun-version': version } } : {}),
    };
  },
  install(frozen: boolean = true): Step {
    return step.run(frozen ? 'bun install --frozen-lockfile' : 'bun install', {
      name: 'Install dependencies',
    });
  },
  test(coverage: boolean = false): Step {
    return step.run(coverage ? 'bun test --coverage' : 'bun test', { name: 'Run tests' });
  },
  build(): Step {
    return step.run('bun run build', { name: 'Build' });
  },
  lint(): Step {
    return step.run('bun run lint', { name: 'Lint' });
  },
};
