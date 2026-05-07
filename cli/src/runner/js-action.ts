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
import { actionSlug, actionsCacheRoot, materializeBundledAction } from './action-cache.js';
import type { JobSession, PlannedStep, StepResult } from './types.js';

// We don't pin the action to a specific node binary — the host's node runs
// the action's bundled JS. Any node version >=12 supported by upstream
// actions/setup-* implementations is fine; we just need to not reject it
// upfront. node24 was added because shivammathur/setup-php@v2 declares it,
// node25 to keep up with upstream churn.
const SUPPORTED_RUNTIMES = new Set([
  'node12', 'node16', 'node18', 'node20', 'node22', 'node24', 'node25',
]);

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
 *
 * v0.6.16: cache lives in a user-wide directory (~/.rehearse/actions-cache)
 * so the same `actions/checkout@v4` is fetched once per host, not once per
 * repo. See action-cache.ts.
 */
function ensureCheckedOut(uses: string, hostCwd: string): ResolvedAction | null {
  const parsed = parseUses(uses);
  if (!parsed) return null;
  const slug = actionSlug(parsed.owner, parsed.repo, parsed.ref);
  const cacheRoot = actionsCacheRoot(hostCwd);
  const cacheDir = resolve(cacheRoot, slug);
  const url = `https://github.com/${parsed.owner}/${parsed.repo}.git`;

  if (!existsSync(cacheDir)) {
    // P7 (v0.6.19): try the bundled tree first. If `@rehearse/cli`'s
    // npm tarball ships a pre-fetched (owner, repo, ref), copy from
    // there instead of doing a network round-trip. Cuts the cold-host
    // first-resolve from ~2-5s to <50ms for any bundled action. The
    // current bundle is small (1-2 actions); expand by adding fixtures
    // under cli/bundled-actions/<owner>__<repo>__<ref>/.
    if (materializeBundledAction(parsed.owner, parsed.repo, parsed.ref, cacheRoot)) {
      // Bundled action materialized into cacheDir — fall through to
      // the action.yml read below. No network needed.
    } else {
      mkdirSync(cacheRoot, { recursive: true });
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
  }

  const actionRoot = parsed.subPath ? resolve(cacheDir, parsed.subPath) : cacheDir;
  const actionFile = ['action.yml', 'action.yaml']
    .map((n) => resolve(actionRoot, n))
    .find(existsSync);
  if (!actionFile) return null;

  // Many ncc-bundled JS actions (browser-actions/setup-chrome,
  // tj-actions/changed-files, etc.) ship ONLY index.js + action.yml — no
  // package.json. When the action lives under a parent project whose
  // package.json declares `"type":"module"` (vitest, modern Node libs,
  // anything switched to ESM), Node walks up from the action's index.js,
  // finds the parent's `type:module`, treats the bundled CJS code as
  // ESM, and crashes with `__dirname is not defined in ES module scope`.
  //
  // Plant a tiny CJS-typed package.json in the action's root to shadow
  // the parent. Only write if the action doesn't already have one — we
  // respect actions that explicitly set their own type.
  const actionPkgJson = resolve(actionRoot, 'package.json');
  if (!existsSync(actionPkgJson)) {
    try {
      writeFileSync(
        actionPkgJson,
        JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
        'utf-8',
      );
    } catch {
      // Non-fatal: if write fails (read-only fs?), the action may still
      // work for parent projects that aren't `type:module`.
    }
  }

  try {
    const action = parseYaml(readFileSync(actionFile, 'utf-8')) as ActionYaml;
    return { path: actionRoot, action, ref: parsed.ref };
  } catch {
    return null;
  }
}

/**
 * Compute env-var name(s) for a GitHub Action input.
 *
 * Per @actions/core (the canonical contract):
 *   process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`]
 * Only SPACES are replaced. Dashes are PRESERVED.
 *
 * So `inherit-toolchain` → `INPUT_INHERIT-TOOLCHAIN` (dash stays).
 * Pre-v0.6.14 we used to replace dashes too, which broke any action
 * using `core.getInput('foo-bar')` against an input named `foo-bar`
 * (notably moonrepo/setup-rust's `inherit-toolchain` boolean which
 * threw via `core.getBooleanInput` because the env var was missing).
 *
 * For backward compat with code in the wild that may grep `INPUT_FOO_BAR`
 * directly (legacy bug, not spec-conformant), we also set the legacy
 * underscore variant. Two env vars per dashed input — same value, both
 * shapes. No-op when the name has no dashes.
 */
function inputEnvNames(key: string): string[] {
  const canonical = `INPUT_${key.replace(/ /g, '_').toUpperCase()}`;
  const legacy = `INPUT_${key.replace(/[\s-]+/g, '_').toUpperCase()}`;
  return canonical === legacy ? [canonical] : [canonical, legacy];
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
    const value = v === null || v === undefined ? '' : String(v);
    for (const name of inputEnvNames(k)) inputs[name] = value;
  }
  // Defaults from action.yml. Only set if the user's `with:` block
  // didn't already provide the value (compare against the canonical
  // name; if user set foo-bar via `with:`, INPUT_FOO-BAR is in inputs
  // and we skip).
  for (const [k, spec] of Object.entries(resolved.action.inputs ?? {})) {
    const names = inputEnvNames(k);
    if (!(names[0]! in inputs) && spec.default !== undefined) {
      const value = String(spec.default);
      for (const name of names) inputs[name] = value;
    }
  }

  // RUNNER_TOOL_CACHE: setup-* actions (setup-node, setup-chrome,
  // setup-go, etc.) install their tools here and reuse on subsequent
  // runs. GH-hosted runners set this to /opt/hostedtoolcache. We point
  // at <session.tempDir>'s parent so it persists across sessions but
  // not across whole-OS reboots — good enough for actions that just
  // want a writable cache path. Without it, setup-chrome and friends
  // throw "Expected RUNNER_TOOL_CACHE to be defined".
  const toolCacheDir = resolve(session.hostCwd, '.runner', 'tool-cache');
  mkdirSync(toolCacheDir, { recursive: true });

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
    RUNNER_TOOL_CACHE: toolCacheDir,
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
