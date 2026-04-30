import { step } from '../builder/step.js';
import type { Step } from '../types.js';

export const node = {
  setup(version: string = '20', registry?: string): Step {
    const withParams: Record<string, string | number | boolean> = { 'node-version': version };
    if (registry) withParams['registry-url'] = registry;
    return {
      name: `Setup Node.js ${version}`,
      uses: 'actions/setup-node@v4',
      with: withParams,
    };
  },
  install(frozen: boolean = true): Step {
    return step.run(frozen ? 'npm ci' : 'npm install', { name: 'Install dependencies' });
  },
  cache(): Step {
    return step.cache({
      name: 'Cache node_modules',
      path: '~/.npm',
      key: "${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}",
      restoreKeys: ['${{ runner.os }}-node-'],
    });
  },
  test(coverage: boolean = false): Step {
    return step.run(coverage ? 'npm test -- --coverage' : 'npm test', { name: 'Run tests' });
  },
  build(): Step {
    return step.run('npm run build', { name: 'Build' });
  },
  lint(): Step {
    return step.run('npm run lint', { name: 'Lint' });
  },
  typecheck(): Step {
    return step.run('npm run typecheck', { name: 'Typecheck' });
  },
};
