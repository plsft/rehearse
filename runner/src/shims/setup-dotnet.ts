/**
 * Real `actions/setup-dotnet` shim.
 *
 * Mirrors what GitHub's official action does on a fresh runner:
 *   1. Read `with: dotnet-version` (can be a single version, or multi-line list).
 *   2. For each requested channel, run Microsoft's `dotnet-install.sh` (or
 *      `dotnet-install.ps1` on Windows) — same script the official action uses.
 *   3. Install to `~/.dotnet` (default install dir). Both
 *      `<install-dir>` and `<install-dir>/tools` go on PATH.
 *   4. Set `DOTNET_ROOT` so `dotnet` resolves SDKs/runtimes correctly.
 *
 * Cache strategy: the SDK lives on the persistent rootfs (sprite) or the
 * developer's home dir (local). First-run install is ~30-60s per channel
 * (network-bound); subsequent runs detect the version is already present
 * and skip the network entirely.
 *
 * Why this matters: the previous shim was a no-op that assumed the host
 * already had dotnet on PATH. That breaks on Sprites (no dotnet shipped)
 * and on any developer laptop that doesn't have the requested SDK version.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { JobSession, PlannedStep, StepResult } from '../types.js';

const INSTALLER_URL_SH = 'https://dot.net/v1/dotnet-install.sh';
const INSTALLER_URL_PS1 = 'https://dot.net/v1/dotnet-install.ps1';

export async function setupDotnetShim(step: PlannedStep, session: JobSession): Promise<StepResult> {
  const t0 = performance.now();
  const raw = step.with['dotnet-version'];
  const versions = parseVersions(raw);
  const installDir = resolve(homedir(), '.dotnet');

  // Host-already-has-it short-circuit
  if (versions.length === 0) {
    const hv = hostDotnetVersion();
    return {
      label: step.label,
      status: 'success',
      durationMs: performance.now() - t0,
      outputs: { 'dotnet-version': hv ?? '' },
      reason: hv ? `no version requested — using host dotnet ${hv}` : 'no version requested — host has no dotnet',
    };
  }

  const installLog: string[] = [];
  for (const channel of versions) {
    if (sdkAlreadyInstalled(installDir, channel)) {
      installLog.push(`${channel}: cached`);
      continue;
    }
    const r = runInstaller(installDir, channel);
    if (r.code !== 0) {
      return {
        label: step.label,
        status: 'failure',
        exitCode: r.code,
        durationMs: performance.now() - t0,
        outputs: {},
        reason: `dotnet-install failed for ${channel}: ${r.stderr.split('\n').slice(-3).join(' / ')}`,
      };
    }
    installLog.push(`${channel}: installed`);
  }

  // Make the installed SDKs visible to subsequent steps.
  const sep = process.platform === 'win32' ? ';' : ':';
  const toolsDir = resolve(installDir, 'tools');
  session.env.DOTNET_ROOT = installDir;
  session.env.PATH = `${installDir}${sep}${toolsDir}${sep}${session.env.PATH ?? process.env.PATH ?? ''}`;
  // Many CI workflows set these to suppress chatty/noisy first-run UX —
  // forward them by default so customer logs stay clean.
  session.env.DOTNET_CLI_TELEMETRY_OPTOUT = session.env.DOTNET_CLI_TELEMETRY_OPTOUT ?? '1';
  session.env.DOTNET_NOLOGO = session.env.DOTNET_NOLOGO ?? 'true';
  session.env.DOTNET_SKIP_FIRST_TIME_EXPERIENCE = session.env.DOTNET_SKIP_FIRST_TIME_EXPERIENCE ?? '1';
  // Many minimal Linux base images (Sprites included) ship without libicu.
  // .NET hard-requires ICU for globalization unless we set this flag, in
  // which case `dotnet` runs in invariant culture mode — fine for >99% of
  // CI builds (compile + test). Customer can override by setting the var
  // explicitly in their workflow `env:` if they actually need globalization.
  session.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT =
    session.env.DOTNET_SYSTEM_GLOBALIZATION_INVARIANT ?? '1';

  return {
    label: step.label,
    status: 'success',
    durationMs: performance.now() - t0,
    outputs: { 'dotnet-version': versions.join(','), 'cache-hit': installLog.every((l) => l.endsWith('cached')) ? 'true' : 'false' },
    reason: `dotnet ${installLog.join(', ')} → ${installDir}`,
  };
}

/** Parse `with: dotnet-version` — accepts string, array, or multi-line YAML. */
function parseVersions(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  return String(raw)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Detect whether the requested SDK channel is already on disk. Microsoft's
 * installer drops SDKs into `<install-dir>/sdk/<full-version>/`. Probe for
 * any directory that starts with the channel's major.minor.
 */
function sdkAlreadyInstalled(installDir: string, channel: string): boolean {
  const sdkDir = resolve(installDir, 'sdk');
  if (!existsSync(sdkDir)) return false;
  const prefix = channel.replace(/\.x$/i, '').replace(/^[\^~]/, '');
  // Check via the dotnet CLI if it's already on PATH inside the install dir.
  const dotnetBin = resolve(installDir, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
  if (!existsSync(dotnetBin)) return false;
  const r = spawnSync(dotnetBin, ['--list-sdks'], { encoding: 'utf-8' });
  if (r.status !== 0) return false;
  return r.stdout.split('\n').some((line) => line.startsWith(prefix));
}

/** Run dotnet-install.sh / .ps1 with the given channel. */
function runInstaller(installDir: string, channel: string): { code: number; stdout: string; stderr: string } {
  // Channel: strip trailing `.x`. `8.0.x` → `8.0`, `9.0` → `9.0`, `LTS` → `LTS`.
  const ch = channel.replace(/\.x$/i, '');
  if (process.platform === 'win32') {
    // PowerShell installer
    const cmd = `iwr -useb ${INSTALLER_URL_PS1} | iex; & ([scriptblock]::Create((New-Object Net.WebClient).DownloadString('${INSTALLER_URL_PS1}'))) -Channel ${ch} -InstallDir ${quoteWin(installDir)} -NoPath`;
    const r = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', cmd], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }
  // POSIX: curl into bash with explicit args
  const cmd = `curl -sSL ${INSTALLER_URL_SH} | bash -s -- --channel ${ch} --install-dir ${shellQuote(installDir)} --no-path`;
  const r = spawnSync('bash', ['-eo', 'pipefail', '-c', cmd], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function hostDotnetVersion(): string | null {
  const r = spawnSync('dotnet', ['--version'], { encoding: 'utf-8' });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

function shellQuote(s: string): string { return `'${s.replace(/'/g, `'\\''`)}'`; }
function quoteWin(s: string): string { return `"${s.replace(/"/g, '\\"')}"`; }
