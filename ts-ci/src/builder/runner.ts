import type { RunnerSpec, UbicloudSize } from '../types.js';

export const Runner = {
  /**
   * @deprecated Emits `runs-on: ubicloud-<size>`, which only works on GitHub
   * orgs with Ubicloud configured. For portable workflows use
   * `Runner.github('ubuntu-latest')`. Retained for explicit Ubicloud users.
   */
  ubicloud(size: UbicloudSize = 'standard-4'): RunnerSpec {
    return { kind: 'ubicloud', size };
  },
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
    case 'ubicloud':
      return `ubicloud-${spec.size}`;
    case 'github':
      return spec.label;
    case 'self-hosted':
      return spec.labels;
    case 'custom':
      return spec.runsOn;
  }
}
