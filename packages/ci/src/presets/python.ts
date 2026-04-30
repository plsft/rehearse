import { step } from '../builder/step.js';
import type { Step } from '../types.js';

type PyTool = 'pytest' | 'unittest';
type LintTool = 'ruff' | 'flake8' | 'pylint';

export const python = {
  setup(version: string = '3.12'): Step {
    return {
      name: `Setup Python ${version}`,
      uses: 'actions/setup-python@v5',
      with: { 'python-version': version },
    };
  },
  install(): Step {
    return step.run('pip install -r requirements.txt', { name: 'Install dependencies' });
  },
  cache(): Step {
    return step.cache({
      name: 'Cache pip',
      path: '~/.cache/pip',
      key: "${{ runner.os }}-pip-${{ hashFiles('**/requirements*.txt') }}",
      restoreKeys: ['${{ runner.os }}-pip-'],
    });
  },
  lint(tool: LintTool = 'ruff'): Step {
    const cmd = tool === 'ruff' ? 'ruff check .' : tool === 'flake8' ? 'flake8 .' : 'pylint **/*.py';
    return step.run(cmd, { name: `Lint (${tool})` });
  },
  test(tool: PyTool = 'pytest'): Step {
    const cmd = tool === 'pytest' ? 'pytest' : 'python -m unittest discover';
    return step.run(cmd, { name: 'Run tests' });
  },
};
