/**
 * Shims for `actions/upload-artifact@v4` and `actions/download-artifact@v4`.
 * Backed by `LocalArtifacts` under `<cwd>/.runner/artifacts/`.
 */
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { LocalArtifacts, parseArtifactPaths } from '../artifacts.js';
import type { JobSession, PlannedStep, StepResult } from '../types.js';

export async function uploadArtifactShim(step: PlannedStep, session: JobSession): Promise<StepResult> {
  const t0 = performance.now();
  const name = String(step.with.name ?? 'artifact');
  const paths = parseArtifactPaths(step.with.path);
  if (paths.length === 0) {
    return {
      label: step.label,
      status: 'failure',
      durationMs: 0,
      outputs: {},
      reason: `upload-artifact: missing 'path' input`,
    };
  }
  const root = resolve(session.hostCwd, '.runner', 'artifacts');
  const store = new LocalArtifacts(root);
  const result = store.upload(name, paths, session.workdir);
  return {
    label: step.label,
    status: 'success',
    durationMs: performance.now() - t0,
    outputs: {
      'artifact-id': name,
      'artifact-url': `file://${resolve(root, name)}`,
    },
    reason: `uploaded ${result.paths.length} path(s) → ${name}`,
  };
}

export async function downloadArtifactShim(step: PlannedStep, session: JobSession): Promise<StepResult> {
  const t0 = performance.now();
  const name = step.with.name ? String(step.with.name) : undefined;
  const targetPath = String(step.with.path ?? '.');
  const root = resolve(session.hostCwd, '.runner', 'artifacts');
  const store = new LocalArtifacts(root);
  const result = store.download(name, targetPath, session.workdir);
  return {
    label: step.label,
    status: 'success',
    durationMs: performance.now() - t0,
    outputs: { 'download-path': resolve(session.workdir, targetPath) },
    reason: name ? `restored ${result.count} file(s) from ${name}` : `restored ${result.count} file(s) (all artifacts)`,
  };
}
