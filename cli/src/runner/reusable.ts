/**
 * Reusable workflow expansion (`uses:` at the JOB level, not the step
 * level — that distinction is the entire feature).
 *
 *   jobs:
 *     deploy:
 *       uses: ./.github/workflows/deploy.yml
 *       with:
 *         environment: production
 *       secrets:
 *         API_TOKEN: ${{ secrets.PROD_API_TOKEN }}
 *
 * The called workflow has its own `on: workflow_call` trigger plus
 * `inputs:` and `secrets:` declarations, then a normal `jobs:` block.
 * We expand it into the caller's plan, prefixing job ids so multiple
 * `uses:` of the same workflow don't collide.
 *
 * Out of scope (for v1):
 *   - Remote reusable workflows (`uses: org/repo/.github/workflows/foo.yml@ref`)
 *     — would need git fetch + a recursive parse. Plumbing exists for
 *     remote composites; revisit when there's a use case.
 *   - `outputs:` flowing back from the called workflow to the caller's
 *     `needs.<job>.outputs.*` — substitution happens but only for direct
 *     children, no transitive resolution yet.
 *   - Caller's `permissions:` / `concurrency:` propagation.
 */
import type { ParsedJob, ParsedWorkflow } from '@rehearse/ci';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { actionSlug, actionsCacheRoot } from './action-cache.js';

export interface ReusableExpansion {
  /** The original caller's job key (used to prefix expanded job ids). */
  callerKey: string;
  /** The path the workflow was loaded from (for diagnostics). */
  workflowPath: string;
  /** Inputs resolved from the caller's `with:` + the called workflow's defaults. */
  inputs: Record<string, string>;
  /** Secrets resolved from the caller's `secrets:` block. */
  secrets: Record<string, string>;
  /** The expanded jobs, keyed by `<callerKey>__<innerKey>`. */
  jobs: Record<string, ParsedJob>;
  /**
   * Reusable workflow `on.workflow_call.outputs` declarations, with inputs/
   * secrets already substituted. Each value is a `${{ jobs.X.outputs.Y }}`
   * expression that references inner-job outputs by their original key
   * (NOT the prefixed key — the expression evaluator resolves it later
   * against innerKeyMap). Empty if the reusable declares no outputs.
   */
  outputsSpec: Record<string, string>;
  /**
   * inner-job-key (as written in the reusable workflow) → composite
   * jobKey (`caller__inner`). Used by the scheduler to resolve
   * `${{ jobs.X.outputs.Y }}` expressions in outputsSpec back to the
   * actual scheduled jobs.
   */
  innerKeyMap: Record<string, string>;
}

/** Recognise a job-level `uses:` that points at a reusable workflow. */
export function isReusableWorkflowUse(uses: string | undefined): boolean {
  if (!uses) return false;
  if (uses.startsWith('./') || uses.startsWith('.\\')) {
    return /\.ya?ml$/i.test(uses);
  }
  // Remote form: org/repo/.github/workflows/foo.yml@ref
  return /\.github\/workflows\/[^/]+\.ya?ml@/.test(uses);
}

/** Read and parse a workflow file from disk. */
function loadWorkflow(path: string): ParsedWorkflow | null {
  if (!existsSync(path)) return null;
  try {
    return parseYaml(readFileSync(path, 'utf-8')) as ParsedWorkflow;
  } catch {
    return null;
  }
}

/**
 * Resolve an `org/repo/.github/workflows/foo.yml@ref` reference: shallow-
 * clone (or reuse a cached clone of) the repo at the requested ref into the
 * shared action cache, return the workflow path and the cloned repo's root
 * (the root is needed for nested `./` references inside the called workflow,
 * which resolve relative to ITS repo, not the original caller's).
 *
 * v0.6.16: was stubbed pre-this — `expandReusable` returned null for any
 * remote ref. Real workflows that share helpers across repos via reusables
 * (e.g. an org-wide `.github/workflows/release.yml`) needed this to run
 * locally at all.
 */
function loadRemoteWorkflow(
  uses: string,
  repoRoot: string,
): { wfPath: string; repoRoot: string } | null {
  // org/repo/.github/workflows/file.yml@ref (with optional sub-path before
  // .github, but in practice GH only supports the top-level layout).
  const m = /^([^/]+)\/([^/@]+)\/(\.github\/workflows\/[^/@]+\.ya?ml)@([\w./-]+)$/.exec(uses);
  if (!m) return null;
  const [, owner, repo, wfSubPath, ref] = m;
  const slug = actionSlug(owner!, repo!, ref!);
  const cacheDir = resolve(actionsCacheRoot(repoRoot), slug);
  const url = `https://github.com/${owner}/${repo}.git`;

  if (!existsSync(cacheDir)) {
    mkdirSync(actionsCacheRoot(repoRoot), { recursive: true });
    let r = spawnSync(
      'git',
      ['clone', '--depth', '1', '--branch', ref!, url, cacheDir],
      { encoding: 'utf-8' },
    );
    if (r.status !== 0) {
      // Fall back to full clone + checkout for SHA refs.
      spawnSync('git', ['clone', url, cacheDir], { encoding: 'utf-8' });
      const co = spawnSync('git', ['checkout', ref!], { cwd: cacheDir, encoding: 'utf-8' });
      if (co.status !== 0) return null;
    }
  }

  const wfPath = resolve(cacheDir, wfSubPath!);
  if (!existsSync(wfPath)) return null;
  return { wfPath, repoRoot: cacheDir };
}

/**
 * Maximum reusable-workflow nesting depth. Matches GitHub Actions' own
 * limit (https://docs.github.com/en/actions/using-workflows/reusing-workflows#nesting-reusable-workflows).
 * Without this limit, a workflow that recursively calls itself via reusable
 * `uses:` would infinite-loop the expander.
 */
const MAX_REUSABLE_DEPTH = 4;

/**
 * Expand a single reusable-workflow caller. Returns the inner jobs with
 * `${{ inputs.x }}` and `${{ secrets.x }}` substituted, ready to be
 * plugged into the caller's plan.
 *
 * Now recursive (was single-level pre-v0.6.15) — handles up to 4 levels
 * of nested reusable workflows per the GH Actions spec, with cycle
 * detection (set of visited absolute paths) to prevent infinite loops.
 *
 * `_depth` and `_visited` are internal recursion-state parameters;
 * external callers should leave them at their defaults.
 */
export function expandReusable(
  callerKey: string,
  callerJob: ParsedJob & { uses?: string; with?: Record<string, unknown>; secrets?: Record<string, string> | 'inherit' },
  repoRoot: string,
  callerSecrets: Record<string, string> = {},
  _depth = 0,
  _visited: Set<string> = new Set(),
): ReusableExpansion | null {
  const uses = callerJob.uses;
  if (!uses) return null;
  if (!isReusableWorkflowUse(uses)) return null;

  if (_depth >= MAX_REUSABLE_DEPTH) {
    throw new Error(
      `reusable workflow nesting depth exceeds maximum of ${MAX_REUSABLE_DEPTH}: ${uses} (caller chain too deep)`,
    );
  }

  // Resolve the workflow location and the *root for nested ./ refs* — local
  // refs nest within repoRoot; remote refs nest within the cloned repo.
  let wfPath: string;
  let nestedRoot: string;
  if (uses.startsWith('./') || uses.startsWith('.\\')) {
    wfPath = resolve(repoRoot, uses);
    nestedRoot = repoRoot;
  } else {
    const remote = loadRemoteWorkflow(uses, repoRoot);
    if (!remote) return null;
    wfPath = remote.wfPath;
    nestedRoot = remote.repoRoot;
  }
  if (_visited.has(wfPath)) {
    throw new Error(
      `cycle detected in reusable workflows: ${wfPath} is already in the call chain`,
    );
  }
  _visited.add(wfPath);
  const inner = loadWorkflow(wfPath);
  if (!inner) return null;

  // Resolve inputs: caller's `with:` overrides defaults from `on: workflow_call: inputs:`
  const declaredInputs = (inner.on && typeof inner.on === 'object' && !Array.isArray(inner.on)
    ? ((inner.on as Record<string, unknown>).workflow_call as { inputs?: Record<string, { default?: unknown }> } | undefined)?.inputs
    : undefined) ?? {};
  const inputs: Record<string, string> = {};
  for (const [k, spec] of Object.entries(declaredInputs)) {
    if (spec.default !== undefined) inputs[k] = String(spec.default);
  }
  for (const [k, v] of Object.entries(callerJob.with ?? {})) {
    inputs[k] = v === null || v === undefined ? '' : String(v);
  }

  // Resolve secrets: 'inherit' passes the entire caller's secrets bag through;
  // an explicit map names individual secrets to forward.
  let secrets: Record<string, string> = {};
  if (callerJob.secrets === 'inherit') {
    secrets = { ...callerSecrets };
  } else if (callerJob.secrets && typeof callerJob.secrets === 'object') {
    for (const [k, v] of Object.entries(callerJob.secrets)) {
      // Caller writes secrets:{ X: ${{ secrets.PROD_X }} } — the value
      // comes pre-substituted by the planner's expression evaluator,
      // so we treat it as a literal here.
      secrets[k] = String(v);
    }
  }

  // Substitute `${{ inputs.x }}` and `${{ secrets.x }}` in inner job's
  // run/with/env/condition/runs-on. Match the caller's planner-level
  // substitution for matrix.* — same shape.
  const substituted: Record<string, ParsedJob> = {};
  const innerKeyMap: Record<string, string> = {};
  for (const [innerKey, innerJob] of Object.entries(inner.jobs ?? {})) {
    const j = JSON.parse(JSON.stringify(innerJob)) as ParsedJob & { uses?: string };
    walkAndSubstitute(j, inputs, secrets);

    // Recursive expansion: if the inner job ITSELF is a reusable-workflow
    // caller, expand it depth-first. The composite key prefix accumulates
    // so deeply-nested jobs get unique ids ("caller__inner__deepInner").
    // _depth + _visited threading guards against infinite loops.
    if (isReusableWorkflowUse(j.uses)) {
      const compositeKey = `${callerKey}__${innerKey}`;
      // Nested ./ refs resolve relative to the *cloned* repo if the parent
      // is remote, else relative to the original repoRoot. Remote refs
      // (org/repo/.github/workflows/x.yml@ref) clone independently regardless.
      const nested = expandReusable(
        compositeKey,
        j as never,
        nestedRoot,
        secrets,
        _depth + 1,
        _visited,
      );
      if (nested) {
        for (const [k, v] of Object.entries(nested.jobs)) substituted[k] = v;
        innerKeyMap[innerKey] = `${callerKey}__${innerKey}`;
        continue;
      }
      // Nested expansion failed: surface the inner job as-is so the planner
      // can flag it (e.g., remote reusable that we can't resolve).
    }

    const composite = `${callerKey}__${innerKey}`;
    substituted[composite] = j;
    innerKeyMap[innerKey] = composite;
  }

  // Pull `on.workflow_call.outputs:` declarations and substitute inputs/
  // secrets in their `value:` expressions (the inner-job reference part —
  // `${{ jobs.X.outputs.Y }}` — is left intact for the scheduler to resolve
  // once those jobs finish).
  const declaredOutputs = (inner.on && typeof inner.on === 'object' && !Array.isArray(inner.on)
    ? ((inner.on as Record<string, unknown>).workflow_call as { outputs?: Record<string, { value?: string }> } | undefined)?.outputs
    : undefined) ?? {};
  const outputsSpec: Record<string, string> = {};
  for (const [outName, spec] of Object.entries(declaredOutputs)) {
    if (typeof spec.value === 'string') {
      outputsSpec[outName] = substituteString(spec.value, inputs, secrets);
    }
  }

  return {
    callerKey,
    workflowPath: wfPath,
    inputs,
    secrets,
    jobs: substituted,
    outputsSpec,
    innerKeyMap,
  };
}

function walkAndSubstitute(
  obj: unknown,
  inputs: Record<string, string>,
  secrets: Record<string, string>,
): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'string') return; // strings get replaced by parent assignment
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') {
        obj[i] = substituteString(obj[i] as string, inputs, secrets);
      } else {
        walkAndSubstitute(obj[i], inputs, secrets);
      }
    }
    return;
  }
  if (typeof obj === 'object') {
    const rec = obj as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      if (typeof rec[k] === 'string') {
        rec[k] = substituteString(rec[k] as string, inputs, secrets);
      } else {
        walkAndSubstitute(rec[k], inputs, secrets);
      }
    }
  }
}

function substituteString(
  s: string,
  inputs: Record<string, string>,
  secrets: Record<string, string>,
): string {
  return s.replace(/\$\{\{\s*(inputs|secrets)\.([\w.-]+)\s*\}\}/g, (_, ns, name) => {
    const bag = ns === 'inputs' ? inputs : secrets;
    return bag[name] ?? '';
  });
}
