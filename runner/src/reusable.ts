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
import type { ParsedJob, ParsedWorkflow } from '@gitgate/ci';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

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
}

/** Recognise a job-level `uses:` that points at a reusable workflow. */
export function isReusableWorkflowUse(uses: string | undefined): boolean {
  if (!uses) return false;
  if (uses.startsWith('./') || uses.startsWith('.\\')) {
    return /\.ya?ml$/i.test(uses);
  }
  // Remote form: org/repo/.github/workflows/foo.yml@ref — flagged but
  // not handled in v1.
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
 * Expand a single reusable-workflow caller. Returns the inner jobs with
 * `${{ inputs.x }}` and `${{ secrets.x }}` substituted, ready to be
 * plugged into the caller's plan.
 */
export function expandReusable(
  callerKey: string,
  callerJob: ParsedJob & { uses?: string; with?: Record<string, unknown>; secrets?: Record<string, string> | 'inherit' },
  repoRoot: string,
  callerSecrets: Record<string, string> = {},
): ReusableExpansion | null {
  const uses = callerJob.uses;
  if (!uses) return null;
  if (!(uses.startsWith('./') || uses.startsWith('.\\'))) return null; // remote reusables not yet

  const wfPath = resolve(repoRoot, uses);
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
  for (const [innerKey, innerJob] of Object.entries(inner.jobs ?? {})) {
    const j = JSON.parse(JSON.stringify(innerJob)) as ParsedJob;
    walkAndSubstitute(j, inputs, secrets);
    substituted[`${callerKey}__${innerKey}`] = j;
  }

  return {
    callerKey,
    workflowPath: wfPath,
    inputs,
    secrets,
    jobs: substituted,
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
