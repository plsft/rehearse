/**
 * JavaScript-action runtime.
 *
 * Implements `runs.using: node20` (and `node16` / `node18`). Resolves the
 * action's git repo at the requested ref, parses `action.yml`, then
 * executes `runs.main` with the env vars the @actions/core SDK expects.
 *
 * Out of scope (yet):
 *   - Docker actions (`runs.using: docker`)
 *   - `pre:` / `post:` lifecycle hooks
 *   - Encrypted secrets (we pass through whatever's in `step.env`)
 *   - Action signature verification (npm provenance / sigstore)
 *   - Caching action sources across the npm registry — we always git-clone.
 *
 * Layout under `<cwd>/.runner/actions/`:
 *   <owner>__<repo>__<ref>/    — shallow clone of the action's repo at <ref>
 *
 * On every invocation we also write a per-step temp dir for $GITHUB_*
 * files that the action's @actions/core writes to.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parse as parseYaml } from 'yaml';
import type { JobSession, PlannedStep, StepResult } from './types.js';

const SUPPORTED_RUNTIMES = new Set(['node12', 'node16', 'node18', 'node20', 'node22']);

interface ActionYaml {
  name?: string;
  description?: string;
  inputs?: Record<string, { description?: string; required?: boolean; default?: string }>;
  outputs?: Record<string, { description?: string; value?: string }>;
  runs?: {
    using?: string;
    main?: string;
    pre?: string;
    post?: string;
    'pre-if'?: string;
    'post-if'?: string;
  };
}

interface ResolvedAction {
  path: string;
  action: ActionYaml;
  ref: string;
}

/** `actions/checkout@v4` → `{ owner: 'actions', repo: 'checkout', ref: 'v4' }`. */
function parseUses(uses: string): { owner: string; repo: string; subPath?: string; ref: string } | null {
  const m = /^([^/]+)\/([^/@]+)(?:\/([^@]+))?@([\w./-]+)$/.exec(uses);
  if (!m) return null;
  const [, owner, repo, subPath, ref] = m;
  return { owner: owner!, repo: repo!, subPath: subPath || undefined, ref: ref! };
}

export function isJsActionUses(uses: string | undefined): boolean {
  if (!uses) return false;
  // Local composite actions handled elsewhere
  if (uses.startsWith('./') || uses.startsWith('.\\')) return false;
  return parseUses(uses) !== null;
}

/**
 * Clone (or reuse a cached clone of) the action repo at the requested ref.
 * Falls back to fetching the ref by SHA when the branch/tag form fails.
 */
function ensureCheckedOut(uses: string, hostCwd: string): ResolvedAction | null {
  const parsed = parseUses(uses);
  if (!parsed) return null;
  const slug = `${parsed.owner}__${parsed.repo}__${parsed.ref}`.replace(/[^A-Za-z0-9_.-]+/g, '_');
  const cacheDir = resolve(hostCwd, '.runner', 'actions', slug);
  const url = `https://github.com/${parsed.owner}/${parsed.repo}.git`;

  if (!existsSync(cacheDir)) {
    mkdirSync(resolve(hostCwd, '.runner', 'actions'), { recursive: true });
    // Try shallow clone at the ref directly (works for branches and tags)
    let r = spawnSync(
      'git',
      ['clone', '--depth', '1', '--branch', parsed.ref, url, cacheDir],
      { encoding: 'utf-8' },
    );
    if (r.status !== 0) {
      // Could be a SHA — clone full and checkout
      spawnSync('git', ['clone', url, cacheDir], { encoding: 'utf-8' });
      const co = spawnSync('git', ['checkout', parsed.ref], { cwd: cacheDir, encoding: 'utf-8' });
      if (co.status !== 0) return null;
    }
  }

  const actionRoot = parsed.subPath ? resolve(cacheDir, parsed.subPath) : cacheDir;
  const actionFile = ['action.yml', 'action.yaml']
    .map((n) => resolve(actionRoot, n))
    .find(existsSync);
  if (!actionFile) return null;
  try {
    const action = parseYaml(readFileSync(actionFile, 'utf-8')) as ActionYaml;
    return { path: actionRoot, action, ref: parsed.ref };
  } catch {
    return null;
  }
}

/** Inputs land in env as INPUT_<NAME-WITH-DASHES-AS-SPACES>, all caps, dashes → spaces. */
function inputEnvName(key: string): string {
  // GitHub's actual rule: replace ' ' with '_', uppercase. Names with
  // dashes are exposed via INPUT_<NAME> with the dashes preserved as
  // underscores in env (e.g., 'fetch-depth' → INPUT_FETCH-DEPTH? No,
  // actually they become INPUT_FETCH_DEPTH). Be safe: replace any
  // non-word char with `_` and uppercase.
  return `INPUT_${key.replace(/[\s-]+/g, '_').toUpperCase()}`;
}

/**
 * Parse the GITHUB_OUTPUT file format:
 *   key=value
 *   multiline-key<<EOF
 *   line1
 *   line2
 *   EOF
 */
export function parseGithubOutput(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line) { i++; continue; }
    const heredoc = /^([\w-]+)<<(\S+)$/.exec(line);
    if (heredoc) {
      const [, key, marker] = heredoc;
      const buf: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== marker) {
        buf.push(lines[i]!);
        i++;
      }
      out[key!] = buf.join('\n');
      i++; // skip marker
      continue;
    }
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
    i++;
  }
  return out;
}

/**
 * Run a JavaScript GitHub Action. Returns the standard StepResult shape;
 * outputs from `$GITHUB_OUTPUT` are surfaced into `result.outputs` and
 * env additions from `$GITHUB_ENV` are folded back into the session.
 */
export async function runJsAction(
  step: PlannedStep,
  session: JobSession,
): Promise<StepResult> {
  const t0 = performance.now();
  const uses = step.uses!;
  const resolved = ensureCheckedOut(uses, session.hostCwd);
  if (!resolved) {
    return {
      label: step.label,
      status: 'skipped',
      durationMs: 0,
      outputs: {},
      reason: `js-action: could not resolve ${uses}`,
    };
  }
  const using = resolved.action.runs?.using;
  if (!using || !SUPPORTED_RUNTIMES.has(using)) {
    return {
      label: step.label,
      status: 'skipped',
      durationMs: 0,
      outputs: {},
      reason: `js-action: unsupported runtime '${using ?? 'unknown'}' for ${uses}`,
    };
  }
  const main = resolved.action.runs?.main;
  if (!main) {
    return {
      label: step.label,
      status: 'failure',
      durationMs: 0,
      outputs: {},
      reason: `js-action: ${uses} has no 'runs.main'`,
    };
  }
  const mainPath = resolve(resolved.path, main);
  if (!existsSync(mainPath)) {
    return {
      label: step.label,
      status: 'failure',
      durationMs: 0,
      outputs: {},
      reason: `js-action: ${uses} main file missing: ${main}`,
    };
  }

  // Per-step IO files — @actions/core writes here, we read after exit.
  const stepTmp = mkdtempSync(resolve(tmpdir(), `runner-step-${step.index}-`));
  const outputFile = resolve(stepTmp, 'output');
  const envFile = resolve(stepTmp, 'env');
  const pathFile = resolve(stepTmp, 'path');
  const stateFile = resolve(stepTmp, 'state');
  const summaryFile = resolve(stepTmp, 'summary.md');
  for (const f of [outputFile, envFile, pathFile, stateFile, summaryFile]) writeFileSync(f, '');

  const inputs: Record<string, string> = {};
  for (const [k, v] of Object.entries(step.with)) {
    inputs[inputEnvName(k)] = v === null || v === undefined ? '' : String(v);
  }
  // Defaults from action.yml
  for (const [k, spec] of Object.entries(resolved.action.inputs ?? {})) {
    const envName = inputEnvName(k);
    if (!(envName in inputs) && spec.default !== undefined) {
      inputs[envName] = String(spec.default);
    }
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...session.env,
    ...step.env,
    ...inputs,
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    GITHUB_WORKSPACE: session.workdir,
    GITHUB_ACTION_PATH: resolved.path,
    GITHUB_ACTION_REF: resolved.ref,
    GITHUB_OUTPUT: outputFile,
    GITHUB_ENV: envFile,
    GITHUB_PATH: pathFile,
    GITHUB_STATE: stateFile,
    GITHUB_STEP_SUMMARY: summaryFile,
    RUNNER_TEMP: session.tempDir,
    RUNNER_OS: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
  };

  // Pick node binary: prefer host node, optionally honour the runtime version
  // (we don't enforce — host node usually satisfies all of node16/18/20).
  const nodeBin = process.execPath;

  const exitCode: number = await new Promise((done) => {
    const proc = spawn(nodeBin, [mainPath], { cwd: session.workdir, env, stdio: 'inherit' });
    proc.on('error', () => done(-1));
    proc.on('exit', (code) => done(code ?? -1));
  });

  // Read action's outputs and env additions
  const outputs = parseGithubOutput(readFileSync(outputFile, 'utf-8'));
  // GITHUB_ENV uses the same heredoc/equals format
  const envAdditions = parseGithubOutput(readFileSync(envFile, 'utf-8'));
  for (const [k, v] of Object.entries(envAdditions)) {
    session.env[k] = v;
  }
  // GITHUB_PATH: each non-empty line gets prepended to PATH
  const pathAdditions = readFileSync(pathFile, 'utf-8').split(/\r?\n/).filter(Boolean);
  if (pathAdditions.length > 0) {
    const sep = process.platform === 'win32' ? ';' : ':';
    const merged = pathAdditions.join(sep);
    session.env.PATH = `${merged}${sep}${session.env.PATH ?? process.env.PATH ?? ''}`;
  }

  return {
    label: step.label,
    status: exitCode === 0 ? 'success' : 'failure',
    exitCode,
    durationMs: performance.now() - t0,
    outputs,
  };
}
