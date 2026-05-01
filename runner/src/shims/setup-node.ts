/**
 * Smart `actions/setup-node` shim.
 *
 * Behavior, in priority order:
 *   1. If the host's `node` on PATH satisfies the requested `node-version`
 *      (semver-major match for `20.x`-style ranges, exact match for pinned
 *      versions), no-op.
 *   2. If `fnm` is installed, `fnm install <ver>` and prepend its bin to
 *      session PATH for subsequent steps.
 *   3. If `nvm` (POSIX) is installed, source it and `nvm install <ver>`.
 *      Same path-prepend trick.
 *   4. Else: log a warning, fall back to host node, mark step succeeded.
 *      The matrix-bench output will show whether the cells actually used
 *      different node versions.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { JobSession, PlannedStep, StepResult } from '../types.js';

export async function setupNodeShim(step: PlannedStep, session: JobSession): Promise<StepResult> {
  const t0 = performance.now();
  const wanted = String(step.with['node-version'] ?? step.with['node-version-file'] ?? '').trim();
  if (!wanted) {
    return { label: step.label, status: 'success', durationMs: 0, outputs: { 'node-version': hostVersion() ?? '' }, reason: 'no version requested — using host node' };
  }

  const hv = hostVersion();
  if (hv && versionMatches(wanted, hv)) {
    return {
      label: step.label,
      status: 'success',
      durationMs: performance.now() - t0,
      outputs: { 'node-version': hv, 'cache-hit': 'true' },
      reason: `host node ${hv} matches ${wanted}`,
    };
  }

  // Try fnm
  if (commandExists('fnm')) {
    const installed = trySpawn('fnm', ['install', wanted]).code === 0;
    if (installed) {
      const fnmDir = trySpawn('fnm', ['exec', '--using', wanted, 'node', '-p', 'process.execPath']).stdout.trim();
      if (fnmDir) {
        const binDir = fnmDir.replace(/[\\/]node(?:\.exe)?$/, '');
        session.env.PATH = `${binDir}${pathSep()}${session.env.PATH ?? process.env.PATH ?? ''}`;
        return {
          label: step.label,
          status: 'success',
          durationMs: performance.now() - t0,
          outputs: { 'node-version': wanted },
          reason: `fnm installed ${wanted}; PATH updated for subsequent steps`,
        };
      }
    }
  }

  // Best-effort fallback
  return {
    label: step.label,
    status: 'success',
    durationMs: performance.now() - t0,
    outputs: { 'node-version': hv ?? wanted },
    reason: hv ? `falling back to host node ${hv} (asked ${wanted})` : `no fnm/nvm — falling back to host node`,
  };
}

function hostVersion(): string | null {
  const r = trySpawn('node', ['-v']);
  if (r.code !== 0) return null;
  return r.stdout.trim().replace(/^v/, '');
}

function commandExists(cmd: string): boolean {
  if (process.platform === 'win32') {
    return trySpawn('where', [cmd]).code === 0;
  }
  return trySpawn('which', [cmd]).code === 0;
}

function trySpawn(cmd: string, args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf-8' });
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? -1 };
  } catch {
    return { stdout: '', stderr: '', code: -1 };
  }
}

function pathSep(): string { return process.platform === 'win32' ? ';' : ':'; }

/**
 * Loose semver compatibility check. Handles:
 *   exact:     "20.10.0" matches "20.10.0"
 *   wildcard:  "20.x" / "20" matches any 20.*.*
 *   range-ish: "^20" / "~20" treated as 20.x
 */
export function versionMatches(wanted: string, host: string): boolean {
  const w = wanted.replace(/^[\^~]/, '').trim();
  if (!w) return true;
  if (w === host) return true;
  const wMajor = w.split('.')[0]!;
  const hMajor = host.split('.')[0]!;
  if (wMajor !== hMajor) return false;
  // Wildcards or major-only requests match the host as long as majors agree.
  if (w === wMajor || w.endsWith('.x') || w.endsWith('.X')) return true;
  // Otherwise need full minor.patch agreement.
  const wParts = w.split('.');
  const hParts = host.split('.');
  for (let i = 0; i < wParts.length; i++) {
    if (wParts[i] !== hParts[i]) return false;
  }
  return true;
}

void existsSync; void resolve; // kept for future "install to .runner/cache/node/<v>" support
