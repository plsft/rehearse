/**
 * In-process shims for common GitHub Actions. Running the action's actual
 * logic inside Node is dramatically faster than spinning up Docker for it.
 *
 * Each shim either does the work directly (cache, setup-node) or returns
 * `success` with a documented reason (host already has tool / external
 * service / GitHub-API-only).
 */
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { BackendName, JobSession, PlannedStep, StepResult } from '../types.js';
import { downloadArtifactShim, uploadArtifactShim } from './artifact-shim.js';
import { cacheShim } from './cache-shim.js';
import { setupDotnetShim } from './setup-dotnet.js';
import { setupNodeShim } from './setup-node.js';

type ShimFn = (step: PlannedStep, session: JobSession, backend: BackendName) => Promise<StepResult>;

interface ShimEntry {
  match: RegExp;
  fn: ShimFn;
}

const SHIMS: ShimEntry[] = [
  // Host-equivalent: developer's machine already has the tool installed.
  // checkout is unconditional — we ARE running from inside the repo.
  { match: /^actions\/checkout(@|$)/, fn: hostNoOp('checkout — host has the repo') },
  // setup-node: smart shim with optional fnm install.
  { match: /^actions\/setup-node(@|$)/, fn: setupNodeShim },
  // setup-* family: all gated on the actual binary being on PATH. Pre-
  // v0.6.18 these were unconditional success-noops; on a host that
  // didn't have the tool installed (e.g. a Mac without bun, or a CI
  // runner without pnpm) the next step would fail with `<tool>: command
  // not found` and the user had no idea why. Round 4 OSS-validation
  // CI run caught this for setup-bun on GH-hosted ubuntu — typey
  // failed in 3s with no actionable diagnostic. Now we verify the
  // binary's reachable up front and fail loudly with a path-fix hint
  // if it isn't.
  { match: /^actions\/setup-python(@|$)/, fn: hostToolShim(['python3', 'python'], 'setup-python — using host python') },
  { match: /^actions\/setup-go(@|$)/, fn: hostToolShim(['go'], 'setup-go — using host go') },
  { match: /^actions\/setup-java(@|$)/, fn: hostToolShim(['java'], 'setup-java — using host java') },
  // setup-dotnet: real shim that runs Microsoft's dotnet-install.sh/.ps1
  // when the requested SDK isn't already on the persistent install dir.
  { match: /^actions\/setup-dotnet(@|$)/, fn: setupDotnetShim },
  { match: /^oven-sh\/setup-bun(@|$)/, fn: hostToolShim(['bun'], 'setup-bun — using host bun') },
  { match: /^pnpm\/action-setup(@|$)/, fn: hostToolShim(['pnpm'], 'setup-pnpm — using host pnpm') },
  { match: /^denoland\/setup-deno(@|$)/, fn: hostToolShim(['deno'], 'setup-deno — using host deno') },
  { match: /^dtolnay\/rust-toolchain(@|$)/, fn: hostToolShim(['rustc', 'cargo'], 'rust-toolchain — using host rustup') },
  { match: /^ruby\/setup-ruby(@|$)/, fn: hostToolShim(['ruby'], 'setup-ruby — using host ruby') },

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

/**
 * Verify a host tool is on PATH before letting the workflow assume the
 * setup-X action did its job. Returns success (with the same "using host"
 * reason as the old hostNoOp) when the tool is found; returns a clear
 * failure when it isn't.
 *
 * `candidates` is checked in order — we accept the first one found, which
 * lets us paper over POSIX naming differences (`python3` then `python`,
 * `rustc` then `cargo`).
 */
function hostToolShim(candidates: string[], reason: string): ShimFn {
  return async (step) => {
    for (const tool of candidates) {
      if (toolOnPath(tool)) {
        return {
          label: step.label,
          status: 'success',
          durationMs: 0,
          outputs: {},
          reason,
        };
      }
    }
    const list = candidates.join(' / ');
    return {
      label: step.label,
      status: 'failure',
      durationMs: 0,
      outputs: {},
      reason: `${list} not on PATH. The shim for ${step.uses} assumes the host already has the tool installed; install ${candidates[0]} on this host (or run with --backend container).`,
    };
  };
}

/** Cross-platform `which` — `where` on Windows, `command -v` on POSIX. */
function toolOnPath(tool: string): boolean {
  const cmd = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [tool] : ['-v', tool];
  const r = spawnSync(cmd, args, { encoding: 'utf-8', shell: process.platform !== 'win32' });
  return r.status === 0 && (r.stdout?.trim().length ?? 0) > 0;
}

void performance;
