/**
 * Composite action expansion.
 *
 * `uses: ./.github/actions/<name>` — local composite. Reads
 * `<repo>/.github/actions/<name>/action.yml`, builds a per-input expression
 * context, and rewrites the parent step into the composite's inner steps
 * (each with `${{ inputs.x }}` resolved).
 *
 * Out of scope (yet):
 *   - Remote composites (`org/repo/path@ref`) — needs git fetch
 *   - JavaScript actions (`runs.using: node20|node16`) — would need to load
 *     and execute the action's main.js via @actions/core polyfills
 *   - Docker actions (`runs.using: docker`) — feasible via container backend
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { evalExpr } from './expression.js';
import type { ExpressionContext, PlannedStep } from './types.js';

export interface CompositeAction {
  name?: string;
  description?: string;
  inputs?: Record<string, { description?: string; required?: boolean; default?: string }>;
  outputs?: Record<string, { description?: string; value?: string }>;
  runs?: {
    using: 'composite' | 'node20' | 'node16' | 'docker';
    steps?: Array<{
      name?: string;
      id?: string;
      shell?: string;
      run?: string;
      uses?: string;
      with?: Record<string, unknown>;
      env?: Record<string, string>;
      if?: string;
      'working-directory'?: string;
      'continue-on-error'?: boolean;
    }>;
  };
}

export interface ResolvedAction {
  source: 'local';
  path: string;
  action: CompositeAction;
}

/** Locate an action.yml file from a `uses:` reference, relative to repo root. */
export function resolveAction(uses: string, repoRoot: string): ResolvedAction | null {
  if (uses.startsWith('./') || uses.startsWith('.\\')) {
    const dir = resolve(repoRoot, uses);
    for (const candidate of ['action.yml', 'action.yaml']) {
      const p = resolve(dir, candidate);
      if (existsSync(p)) {
        try {
          const action = parseYaml(readFileSync(p, 'utf-8')) as CompositeAction;
          return { source: 'local', path: p, action };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function isComposite(action: CompositeAction): boolean {
  return action.runs?.using === 'composite';
}

/**
 * Expand a parent step that calls a composite action into the action's
 * inner steps, with `${{ inputs.x }}` substituted from the parent's
 * `with:` block (or each input's default).
 */
export function expandComposite(
  parent: PlannedStep,
  resolved: ResolvedAction,
  parentCtx: ExpressionContext,
): PlannedStep[] {
  const a = resolved.action;
  if (!isComposite(a)) return [parent]; // unsupported runs.using → preserve the parent step
  const inputs: Record<string, string> = {};
  for (const [name, spec] of Object.entries(a.inputs ?? {})) {
    const provided = parent.with[name];
    const value = provided !== undefined ? String(provided) : (spec.default !== undefined ? spec.default : '');
    inputs[name] = value;
  }

  const inputCtx: ExpressionContext = { ...parentCtx, inputs };

  const expanded: PlannedStep[] = [];
  for (const [idx, raw] of (a.runs?.steps ?? []).entries()) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.env ?? {})) {
      env[k] = String(evalExpr(String(v), inputCtx) ?? '');
    }
    const w: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw.with ?? {})) {
      w[k] = typeof v === 'string' ? evalExpr(v, inputCtx) : v;
    }
    const run = raw.run ? String(evalExpr(raw.run, inputCtx) ?? '') : undefined;
    const uses = raw.uses ? String(evalExpr(raw.uses, inputCtx) ?? '') : undefined;

    const label = raw.name ?? (run ? run.split('\n')[0]!.slice(0, 60) : uses ?? `composite step ${idx + 1}`);
    expanded.push({
      index: parent.index * 100 + idx,
      label: `${parent.label} → ${label}`,
      raw: { ...raw, run, uses },
      env: { ...parent.env, ...env },
      with: w,
      run,
      uses,
      shell: raw.shell ?? parent.shell,
      workingDirectory: raw['working-directory'] ?? parent.workingDirectory,
      ifCondition: raw.if,
      continueOnError: raw['continue-on-error'] === true,
    });
  }
  return expanded;
}
