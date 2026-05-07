/**
 * `on: workflow_dispatch: inputs:` resolution.
 *
 * Pre-v0.6.16 we ignored declared workflow_dispatch inputs entirely — every
 * `${{ inputs.foo }}` reference collapsed to '' at substitution time. Most
 * workflows that worked happened to have defaults; ones that required
 * runtime inputs failed in obscure ways (empty path, missing token, etc.).
 *
 * Resolution order per declared input:
 *   1. CLI flag       (`--input key=value`)
 *   2. opts.inputs    (programmatic API)
 *   3. action.yml `default`
 *   4. interactive prompt (TTY only)
 *   5. fail with a clear "missing required input" error (non-TTY)
 *
 * Type coercion mirrors GH Actions:
 *   boolean  → 'true' | 'false'
 *   choice   → must match one of `options`
 *   number   → numeric string
 *   string   → as-is
 *
 * Returned values are always stringified — that's what `${{ inputs.X }}`
 * substitution sees and what @actions/core's `getInput` reads.
 */
import { createInterface } from 'node:readline/promises';
import pc from 'picocolors';
import type { ParsedWorkflow } from '@rehearse/ci';

export interface WorkflowInputSpec {
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  type?: 'string' | 'number' | 'boolean' | 'choice' | 'environment';
  options?: string[];
}

/**
 * Pull declared `inputs:` out of a parsed workflow's `on:` block.
 * Tolerant of the three shapes `on:` can take: string, string[], or object.
 */
export function declaredInputs(wf: ParsedWorkflow): Record<string, WorkflowInputSpec> {
  const on = wf.on;
  if (!on || typeof on === 'string' || Array.isArray(on)) return {};
  const dispatch = (on as Record<string, unknown>).workflow_dispatch;
  if (!dispatch || typeof dispatch !== 'object') return {};
  const inputs = (dispatch as { inputs?: Record<string, WorkflowInputSpec> }).inputs;
  return inputs ?? {};
}

export interface ResolveInputsArgs {
  declared: Record<string, WorkflowInputSpec>;
  /** Values supplied via CLI / programmatic API, pre-cast strings. */
  provided: Record<string, string>;
  /** Whether to prompt for missing required inputs. False in non-TTY. */
  interactive: boolean;
}

/**
 * Resolve every declared input to a string value. Throws if a required
 * input is missing in non-interactive mode, or if a `choice`-typed value
 * isn't in the options list.
 */
export async function resolveInputs(args: ResolveInputsArgs): Promise<Record<string, string>> {
  const { declared, provided, interactive } = args;
  const out: Record<string, string> = {};

  // No prompts needed → fast path.
  const needsPrompt = Object.entries(declared).some(([k, spec]) => {
    if (k in provided) return false;
    if (spec.default !== undefined) return false;
    return spec.required === true;
  });

  let rl: ReturnType<typeof createInterface> | null = null;
  if (needsPrompt && interactive) {
    rl = createInterface({ input: process.stdin, output: process.stderr });
  }

  try {
    for (const [name, spec] of Object.entries(declared)) {
      if (name in provided) {
        out[name] = coerce(name, provided[name]!, spec);
        continue;
      }
      if (spec.default !== undefined) {
        out[name] = String(spec.default);
        continue;
      }
      if (!spec.required) {
        // Per GH semantics: optional inputs without defaults resolve to ''.
        out[name] = '';
        continue;
      }
      // Required + no default + not provided.
      if (!interactive || !rl) {
        throw new Error(
          `missing required workflow_dispatch input '${name}'. Pass --input ${name}=<value> or run from a TTY.`,
        );
      }
      out[name] = coerce(name, await promptOne(rl, name, spec), spec);
    }
  } finally {
    rl?.close();
  }

  return out;
}

async function promptOne(
  rl: ReturnType<typeof createInterface>,
  name: string,
  spec: WorkflowInputSpec,
): Promise<string> {
  const desc = spec.description ? pc.gray(` — ${spec.description}`) : '';
  const typeHint = spec.type === 'choice' && spec.options
    ? pc.gray(` (${spec.options.join(' | ')})`)
    : spec.type
    ? pc.gray(` (${spec.type})`)
    : '';
  const prompt = `${pc.cyan('?')} ${pc.bold(name)}${typeHint}${desc}: `;
  // Loop until valid (choice values may be wrong on first try).
  // Bail out after 3 tries to avoid spinning if stdin is closed.
  for (let attempt = 0; attempt < 3; attempt++) {
    const v = (await rl.question(prompt)).trim();
    try {
      coerce(name, v, spec);
      return v;
    } catch (e) {
      process.stderr.write(`  ${pc.red('✗')} ${(e as Error).message}\n`);
    }
  }
  throw new Error(`could not resolve input '${name}' after 3 prompts`);
}

function coerce(name: string, raw: string, spec: WorkflowInputSpec): string {
  const t = spec.type ?? 'string';
  if (t === 'boolean') {
    const v = raw.toLowerCase();
    if (v === 'true' || v === 'false') return v;
    throw new Error(`input '${name}' must be true|false (got "${raw}")`);
  }
  if (t === 'number') {
    if (raw === '' || isNaN(Number(raw))) {
      throw new Error(`input '${name}' must be a number (got "${raw}")`);
    }
    return raw;
  }
  if (t === 'choice') {
    if (!spec.options || spec.options.length === 0) {
      throw new Error(`input '${name}' is type 'choice' but has no options`);
    }
    if (!spec.options.includes(raw)) {
      throw new Error(`input '${name}' must be one of: ${spec.options.join(', ')} (got "${raw}")`);
    }
    return raw;
  }
  return raw;
}
