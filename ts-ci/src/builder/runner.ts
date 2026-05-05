import type { RunnerSpec } from '../types.js';

export const Runner = {
  github(label: string = 'ubuntu-latest'): RunnerSpec {
    if (!label.trim()) throw new Error('Runner.github(): label is required');
    return { kind: 'github', label };
  },
  selfHosted(...labels: string[]): RunnerSpec {
    const fullLabels = labels.length > 0 ? labels : ['self-hosted'];
    return { kind: 'self-hosted', labels: fullLabels.includes('self-hosted') ? fullLabels : ['self-hosted', ...fullLabels] };
  },
  custom(runsOn: string | string[]): RunnerSpec {
    return { kind: 'custom', runsOn };
  },
};

/**
 * Convert a RunnerSpec to the `runs-on:` value GitHub Actions accepts
 * (a string label or an array of labels).
 */
export function resolveRunner(spec: RunnerSpec): string | string[] {
  switch (spec.kind) {
    case 'github':
      return spec.label;
    case 'self-hosted':
      return spec.labels;
    case 'custom':
      return spec.runsOn;
  }
}
