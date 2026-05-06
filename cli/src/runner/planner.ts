/**
 * Planning: take a parsed workflow, expand matrices, resolve `${{ matrix… }}`
 * references inside per-cell job/step env, with, run, condition, and runs-on,
 * pick a backend per job. Result: a flat list of PlannedJobs ready to execute.
 */
import type { ParsedJob, ParsedStep, ParsedWorkflow } from '@rehearse/ci';
import { expandComposite, resolveAction } from './composite.js';
import { evalExpr } from './expression.js';
import { cellId, expandMatrix, parseMatrix } from './matrix.js';
import { expandReusable, isReusableWorkflowUse } from './reusable.js';
import { hasShim } from './shims/index.js';
import type { BackendName, ExpressionContext, PlannedJob, PlannedStep, RunOptions } from './types.js';

/** Build an ExpressionContext stub good enough for matrix-time substitution. */
function matrixContext(matrix: Record<string, unknown>, opts: RunOptions): ExpressionContext {
  return {
    matrix,
    env: opts.env ?? {},
    secrets: opts.secrets ?? {},
    vars: {},
    github: {
      actor: process.env.USER ?? process.env.USERNAME ?? 'local',
      repository: 'local/local',
      ref: 'refs/heads/local',
      ref_name: 'local',
      sha: '0000000000000000000000000000000000000000',
      event_name: 'workflow_dispatch',
      workspace: opts.cwd ?? process.cwd(),
    },
    needs: {},
    steps: {},
    job: { status: 'success' },
    runner: {
      os: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
      arch: process.arch === 'x64' ? 'X64' : process.arch.toUpperCase(),
      temp: '/tmp',
    },
    inputs: {},
  };
}

export function substituteString(s: string | undefined, ctx: ExpressionContext): string | undefined {
  if (s === undefined) return undefined;
  if (typeof s !== 'string') return s;
  if (!s.includes('${{')) return s;
  const v = evalExpr(s, ctx);
  return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export function substituteEnv(
  env: Record<string, string> | undefined,
  ctx: ExpressionContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env ?? {})) {
    out[k] = substituteString(v, ctx) ?? '';
  }
  return out;
}

export function substituteWith(w: Record<string, unknown> | undefined, ctx: ExpressionContext): Record<string, unknown> {
  if (!w) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w)) {
    out[k] = typeof v === 'string' ? substituteString(v, ctx) : v;
  }
  return out;
}

function pickBackend(job: ParsedJob, opts: RunOptions, resolvedRunsOn?: string): BackendName {
  if (opts.backend && opts.backend !== 'auto') return opts.backend;
  const services = job.services;
  if (services && Object.keys(services).length > 0) return 'container';
  if ('container' in job && job.container) return 'container';
  // Use the matrix-substituted runs-on if the caller resolved it. The
  // raw form may be `${{ matrix.os }}` — pre-substitution it never
  // matches the windows-/macos- prefix and every cell wrongly picks
  // host. Resolved form is the literal label for THIS cell.
  const runsOn = resolvedRunsOn ?? String(Array.isArray(job['runs-on']) ? job['runs-on'][0] : job['runs-on'] ?? '');
  if (runsOn.startsWith('windows-') && process.platform !== 'win32') return 'container';
  if (runsOn.startsWith('macos-') && process.platform !== 'darwin') return 'container';
  return 'host';
}

function stepLabel(step: ParsedStep, idx: number, ctx: ExpressionContext): string {
  if (step.name) return substituteString(step.name, ctx) ?? step.name;
  if (step.uses) return substituteString(step.uses, ctx) ?? step.uses;
  if (step.run) {
    const first = step.run.split('\n')[0]!.trim();
    const expanded = substituteString(first, ctx) ?? first;
    return expanded.length > 60 ? expanded.slice(0, 57) + '…' : expanded;
  }
  return `step ${idx + 1}`;
}

function planSteps(rawSteps: ParsedStep[], ctx: ExpressionContext, opts: RunOptions): PlannedStep[] {
  const repoRoot = opts.cwd ?? process.cwd();
  const out: PlannedStep[] = [];
  for (const [index, raw] of rawSteps.entries()) {
    const env = substituteEnv(raw.env as Record<string, string> | undefined, ctx);
    const w = substituteWith(raw.with, ctx);
    const run = substituteString(raw.run, ctx);
    const uses = substituteString(raw.uses, ctx);
    const ifCondition = raw.if ? raw.if : undefined;
    const planned: PlannedStep = {
      index,
      label: stepLabel(raw, index, ctx),
      raw,
      env,
      with: w,
      run,
      uses,
      shell: raw.shell,
      workingDirectory: raw['working-directory'],
      ifCondition,
      continueOnError: raw['continue-on-error'] === true,
    };

    // Composite-action expansion (local or remote). The parent step is
    // replaced by the action's inner steps, with `${{ inputs.x }}`
    // substituted from the parent's `with:`. Remote composites are
    // git-cloned to .runner/actions/<slug>/ on first use.
    //
    // Shim check FIRST: if we have a host-equivalent shim for this `uses`
    // (e.g., dtolnay/rust-toolchain — host already has rustup), skip the
    // composite expansion and let the shim handle it at exec time. The
    // composite version of these actions is designed for fresh containers,
    // and its sub-steps assume a clean environment we don't always provide.
    if (uses && !hasShim(uses)) {
      const resolved = resolveAction(uses, repoRoot);
      if (resolved && resolved.action.runs?.using === 'composite') {
        out.push(...expandComposite(planned, resolved, ctx));
        continue;
      }
    }
    out.push(planned);
  }
  return out;
}

export function plan(workflow: ParsedWorkflow, opts: RunOptions): PlannedJob[] {
  const repoRoot = opts.cwd ?? process.cwd();
  // Pre-pass: expand any job-level `uses:` (reusable workflows) into the
  // caller's job dictionary. We do this before matrix expansion so the
  // expanded jobs themselves can have matrix strategies.
  const flat: Record<string, ParsedJob> = {};
  // jobs we can't expand (remote reusables) — emit them as a skipped
  // PlannedJob with a clear reason rather than a phantom 0-step success.
  const unsupportedJobs: Record<string, string> = {};
  for (const [jobKey, rawJob] of Object.entries(workflow.jobs)) {
    const j = rawJob as ParsedJob & { uses?: string };
    if (isReusableWorkflowUse(j.uses)) {
      const expansion = expandReusable(jobKey, j as never, repoRoot, opts.secrets ?? {});
      if (expansion) {
        for (const [k, v] of Object.entries(expansion.jobs)) flat[k] = v;
        continue;
      }
      // Local refs that fail to load are user errors (file missing).
      // Remote refs (org/repo/.github/workflows/x.yml@ref) are a known
      // gap — flag them clearly instead of pretending the job succeeded.
      const isRemote = j.uses && !(j.uses.startsWith('./') || j.uses.startsWith('.\\'));
      unsupportedJobs[jobKey] = isRemote
        ? `remote reusable workflow not supported: ${j.uses}`
        : `local reusable workflow not found: ${j.uses}`;
      flat[jobKey] = rawJob;
      continue;
    }
    flat[jobKey] = rawJob;
  }

  const out: PlannedJob[] = [];
  for (const [jobKey, rawJob] of Object.entries(flat)) {
    if (opts.jobFilter) {
      // Exact match wins. Also allow the caller key as a shorthand for
      // any expanded inner job (`coverage-nix` matches `coverage-nix__check-coverage`).
      const matches = opts.jobFilter === jobKey || jobKey.startsWith(`${opts.jobFilter}__`);
      if (!matches) continue;
    }
    const matrix = parseMatrix(rawJob.strategy?.matrix);
    const allCells = expandMatrix(matrix);
    // Apply --matrix filter if any.
    //
    // Semantics: a cell passes the filter iff every constraint either
    //   (a) names a key the cell DOES have AND the cell's value matches, OR
    //   (b) names a key the cell DOESN'T have (i.e. the constraint is
    //       N/A for this job — don't penalise non-matrix or differently-
    //       shaped-matrix jobs for not having the variable).
    //
    // Pre-v0.6.12 we used strict matching (`cell[k] ?? '' === v`) which
    // meant `--matrix os=ubuntu-latest` against a job WITH NO matrix
    // returned 0 cells → "no jobs match". Reported by user testing
    // honojs/hono whose `main` job has no matrix block. The non-strict
    // semantics match what users expect: "filter cells where applicable,
    // pass through everything else".
    const cells = opts.matrixFilter && Object.keys(opts.matrixFilter).length > 0
      ? allCells.filter((cell) => Object.entries(opts.matrixFilter!).every(
          ([k, v]) => !(k in cell) || String(cell[k]) === v,
        ))
      : allCells;
    const needs = Array.isArray(rawJob.needs) ? rawJob.needs : rawJob.needs ? [rawJob.needs] : [];

    for (const cell of cells) {
      const ctx = matrixContext(cell, opts);
      const id = cells.length === 1 ? jobKey : `${jobKey}:${cellId(cell)}`;
      const env = substituteEnv(rawJob.env as Record<string, string> | undefined, ctx);
      const steps = planSteps(rawJob.steps ?? [], ctx, opts);
      const rawRunsOn = String(Array.isArray(rawJob['runs-on']) ? rawJob['runs-on'][0] : rawJob['runs-on'] ?? 'ubuntu-latest');
      // Substitute ${{ matrix.* }} so the displayed runs-on shows the
      // expanded label (e.g. "ubuntu-latest" instead of "${{ matrix.os }}").
      const runsOn = substituteString(rawRunsOn, ctx) ?? rawRunsOn;
      out.push({
        id,
        jobKey,
        jobName: substituteString(rawJob.name, ctx) ?? jobKey,
        raw: rawJob,
        matrixCell: Object.keys(cell).length > 0 ? cell : undefined,
        needs,
        ifCondition: rawJob.if,
        env,
        steps,
        backend: pickBackend(rawJob, opts, runsOn),
        runsOn,
        unsupportedReason: unsupportedJobs[jobKey],
      });
    }
  }
  return out;
}
