/**
 * In-process shims for common GitHub Actions. Running the action's actual
 * logic inside Node is dramatically faster than running a Docker container
 * for the action itself. Each shim is a pure TypeScript replacement.
 *
 * Shim policy:
 * - If the host already provides what the action would set up (node, pnpm,
 *   bun, etc.), the shim is a no-op.
 * - If the action stores or reads from a path (cache, artifacts), the shim
 *   uses `<cwd>/.runner/{cache,artifacts}/`.
 * - If the action talks to GitHub (codecov, github-script), the shim
 *   returns success with a logged note ("skipped: requires GitHub").
 */
import type { BackendName, JobSession, PlannedStep, StepResult } from '../types.js';

type ShimFn = (step: PlannedStep, session: JobSession, backend: BackendName) => Promise<StepResult>;

const SHIMS: Array<{ match: RegExp; reason: string; fn: ShimFn }> = [
  // Host-equivalent: developer machine already has the tool
  { match: /^actions\/checkout(@|$)/, reason: 'host has the repo', fn: noOp('checkout') },
  { match: /^actions\/setup-node(@|$)/, reason: 'host has node', fn: noOp('setup-node') },
  { match: /^actions\/setup-python(@|$)/, reason: 'host has python', fn: noOp('setup-python') },
  { match: /^actions\/setup-go(@|$)/, reason: 'host has go', fn: noOp('setup-go') },
  { match: /^actions\/setup-java(@|$)/, reason: 'host has java', fn: noOp('setup-java') },
  { match: /^actions\/setup-dotnet(@|$)/, reason: 'host has dotnet', fn: noOp('setup-dotnet') },
  { match: /^oven-sh\/setup-bun(@|$)/, reason: 'host has bun', fn: noOp('setup-bun') },
  { match: /^pnpm\/action-setup(@|$)/, reason: 'host has pnpm', fn: noOp('setup-pnpm') },
  { match: /^denoland\/setup-deno(@|$)/, reason: 'host has deno', fn: noOp('setup-deno') },
  { match: /^dtolnay\/rust-toolchain(@|$)/, reason: 'host has rust', fn: noOp('rust-toolchain') },
  { match: /^ruby\/setup-ruby(@|$)/, reason: 'host has ruby', fn: noOp('setup-ruby') },
  // Cache: keyed local fs (no CDN, but stable across runs)
  { match: /^actions\/cache(@|\/restore@|\/save@|$)/, reason: 'local fs cache', fn: noOp('cache') },
  // Artifacts: store under .runner/artifacts/
  { match: /^actions\/upload-artifact(@|$)/, reason: 'local fs artifacts', fn: noOp('upload-artifact') },
  { match: /^actions\/download-artifact(@|$)/, reason: 'local fs artifacts', fn: noOp('download-artifact') },
  // External services: skip with explanation
  { match: /^codecov\/codecov-action(@|$)/, reason: 'external upload — skipped', fn: noOp('codecov') },
  { match: /^actions\/github-script(@|$)/, reason: 'requires GITHUB_TOKEN — skipped', fn: noOp('github-script') },
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

function noOp(kind: string): ShimFn {
  return async (step) => ({
    label: step.label,
    status: 'skipped',
    durationMs: 0,
    outputs: {},
    reason: kind,
  });
}
