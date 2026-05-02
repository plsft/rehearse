/**
 * In-process shims for common GitHub Actions. Running the action's actual
 * logic inside Node is dramatically faster than spinning up Docker for it.
 *
 * Each shim either does the work directly (cache, setup-node) or returns
 * `success` with a documented reason (host already has tool / external
 * service / GitHub-API-only).
 */
import { performance } from 'node:perf_hooks';
import type { BackendName, JobSession, PlannedStep, StepResult } from '../types.js';
import { downloadArtifactShim, uploadArtifactShim } from './artifact-shim.js';
import { cacheShim } from './cache-shim.js';
import { setupNodeShim } from './setup-node.js';

type ShimFn = (step: PlannedStep, session: JobSession, backend: BackendName) => Promise<StepResult>;

interface ShimEntry {
  match: RegExp;
  fn: ShimFn;
}

const SHIMS: ShimEntry[] = [
  // Host-equivalent: developer's machine already has the tool installed.
  { match: /^actions\/checkout(@|$)/, fn: hostNoOp('checkout — host has the repo') },
  // setup-node: smart shim with optional fnm install.
  { match: /^actions\/setup-node(@|$)/, fn: setupNodeShim },
  { match: /^actions\/setup-python(@|$)/, fn: hostNoOp('setup-python — using host python') },
  { match: /^actions\/setup-go(@|$)/, fn: hostNoOp('setup-go — using host go') },
  { match: /^actions\/setup-java(@|$)/, fn: hostNoOp('setup-java — using host java') },
  { match: /^actions\/setup-dotnet(@|$)/, fn: hostNoOp('setup-dotnet — using host dotnet') },
  { match: /^oven-sh\/setup-bun(@|$)/, fn: hostNoOp('setup-bun — using host bun') },
  { match: /^pnpm\/action-setup(@|$)/, fn: hostNoOp('setup-pnpm — using host pnpm') },
  { match: /^denoland\/setup-deno(@|$)/, fn: hostNoOp('setup-deno — using host deno') },
  { match: /^dtolnay\/rust-toolchain(@|$)/, fn: hostNoOp('rust-toolchain — using host rustup') },
  { match: /^ruby\/setup-ruby(@|$)/, fn: hostNoOp('setup-ruby — using host ruby') },

  // Cache (real implementation in cacheShim).
  { match: /^actions\/cache\/save(@|$)/, fn: (s, sess) => cacheShim(s, sess, 'save') },
  { match: /^actions\/cache\/restore(@|$)/, fn: (s, sess) => cacheShim(s, sess, 'restore') },
  { match: /^actions\/cache(@|$)/, fn: (s, sess) => cacheShim(s, sess, 'restore-and-save') },

  // Artifacts — backed by LocalArtifacts under .runner/artifacts/.
  { match: /^actions\/upload-artifact(@|$)/, fn: uploadArtifactShim },
  { match: /^actions\/download-artifact(@|$)/, fn: downloadArtifactShim },

  // External services: skip with explanation.
  { match: /^codecov\/codecov-action(@|$)/, fn: hostNoOp('codecov — external upload, skipped locally') },
  { match: /^actions\/github-script(@|$)/, fn: hostNoOp('github-script — requires GITHUB_TOKEN, skipped') },
];

export function hasShim(uses: string): boolean {
  return SHIMS.some((s) => s.match.test(uses));
}

export async function runShim(
  step: PlannedStep,
  session: JobSession,
  backend: BackendName,
): Promise<StepResult> {
  const uses = step.uses ?? '';
  const found = SHIMS.find((s) => s.match.test(uses));
  if (!found) {
    return { label: step.label, status: 'skipped', durationMs: 0, outputs: {}, reason: `no shim for ${uses}` };
  }
  return found.fn(step, session, backend);
}

function hostNoOp(reason: string): ShimFn {
  return async (step) => ({
    label: step.label,
    status: 'success',
    durationMs: 0,
    outputs: {},
    reason,
  });
}

void performance;
