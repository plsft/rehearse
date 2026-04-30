import type { Step } from '../types.js';

export interface ExpandedMatrixOptions {
  command: string;
  nodeVersions?: string[];
  pythonVersions?: string[];
}

/**
 * Sequentially run `command` across multiple language versions inside a single
 * job. Unlike a matrix strategy (which dispatches parallel jobs), this keeps
 * everything in one runner — useful when you want shared caches or to avoid
 * the multi-job runtime overhead.
 */
export function expandedMatrix(options: ExpandedMatrixOptions): Step[] {
  const steps: Step[] = [];
  if (!options.command || !options.command.trim()) {
    throw new Error('expandedMatrix(): command is required');
  }
  const nodeVersions = options.nodeVersions ?? [];
  const pythonVersions = options.pythonVersions ?? [];
  if (nodeVersions.length === 0 && pythonVersions.length === 0) {
    throw new Error('expandedMatrix(): provide at least one of nodeVersions or pythonVersions');
  }
  for (const v of nodeVersions) {
    steps.push({
      name: `Setup Node.js ${v}`,
      uses: 'actions/setup-node@v4',
      with: { 'node-version': v },
    });
    steps.push({
      name: `Run on Node ${v}`,
      run: options.command,
      shell: 'bash',
    });
  }
  for (const v of pythonVersions) {
    steps.push({
      name: `Setup Python ${v}`,
      uses: 'actions/setup-python@v5',
      with: { 'python-version': v },
    });
    steps.push({
      name: `Run on Python ${v}`,
      run: options.command,
      shell: 'bash',
    });
  }
  return steps;
}
