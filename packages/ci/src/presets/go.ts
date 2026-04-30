import { step } from '../builder/step.js';
import type { Step } from '../types.js';

export const go = {
  setup(version: string = '1.23'): Step {
    return {
      name: `Setup Go ${version}`,
      uses: 'actions/setup-go@v5',
      with: { 'go-version': version },
    };
  },
  cache(): Step {
    return step.cache({
      name: 'Cache Go modules',
      path: ['~/go/pkg/mod', '~/.cache/go-build'],
      key: "${{ runner.os }}-go-${{ hashFiles('**/go.sum') }}",
      restoreKeys: ['${{ runner.os }}-go-'],
    });
  },
  test(): Step {
    return step.run('go test ./...', { name: 'go test' });
  },
  build(): Step {
    return step.run('go build ./...', { name: 'go build' });
  },
};
