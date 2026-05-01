/**
 * Planning: take a parsed workflow, expand matrices, resolve `${{ matrix… }}`
 * references inside per-cell job/step env, with, run, condition, and runs-on,
 * pick a backend per job. Result: a flat list of PlannedJobs ready to execute.
 */
import type { ParsedJob, ParsedStep, ParsedWorkflow } from '@gitgate/ci';
import { expandComposite, resolveAction } from './composite.js';
import { evalExpr } from './expression.js';
import { cellId, expandMatrix, parseMatrix } from './matrix.js';
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

function substituteString(s: string | undefined, ctx: ExpressionContext): string | undefined {
  if (s === undefined) return undefined;
  if (typeof s !== 'string') return s;
  if (!s.includes('${{')) return s;
  const v = evalExpr(s, ctx);
  return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function substituteEnv(
  env: Record<string, string> | undefined,
  ctx: ExpressionContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env ?? {})) {
    out[k] = substituteString(v, ctx) ?? '';
  }
  return out;
}

function substituteWith(w: Record<string, unknown> | undefined, ctx: ExpressionContext): Record<string, unknown> {
  if (!w) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w)) {
    out[k] = typeof v === 'string' ? substituteString(v, ctx) : v;
  }
  return out;
}

function pickBackend(job: ParsedJob, opts: RunOptions): BackendName {
  if (opts.backend && opts.backend !== 'auto') return opts.backend;
  const services = job.services;
  if (services && Object.keys(services).length > 0) return 'container';
  if ('container' in job && job.container) return 'container';
  const runsOn = String(Array.isArray(job['runs-on']) ? job['runs-on'][0] : job['runs-on'] ?? '');
  if (runsOn.startsWith('windows-') && process.platform !== 'win32') return 'container';
  if (runsOn.startsWith('macos-') && process.platform !== 'darwin') return 'container';
  return 'host';
}

function stepLabel(step: ParsedStep, idx: number): string {
  if (step.name) return step.name;
  if (step.uses) return step.uses;
  if (step.run) {
    const first = step.run.split('\n')[0]!.trim();
    return first.length > 60 ? first.slice(0, 57) + '…' : first;
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
      label: stepLabel(raw, index),
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

    // Local composite expansion. The parent step is replaced by the
    // action's inner steps, with `${{ inputs.x }}` substituted.
    if (uses && (uses.startsWith('./') || uses.startsWith('.\\'))) {
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
  const out: PlannedJob[] = [];
  for (const [jobKey, rawJob] of Object.entries(workflow.jobs)) {
    if (opts.jobFilter && opts.jobFilter !== jobKey) continue;
    const matrix = parseMatrix(rawJob.strategy?.matrix);
    const cells = expandMatrix(matrix);
    const needs = Array.isArray(rawJob.needs) ? rawJob.needs : rawJob.needs ? [rawJob.needs] : [];

    for (const cell of cells) {
      const ctx = matrixContext(cell, opts);
      const id = cells.length === 1 ? jobKey : `${jobKey}:${cellId(cell)}`;
      const env = substituteEnv(rawJob.env as Record<string, string> | undefined, ctx);
      const steps = planSteps(rawJob.steps ?? [], ctx, opts);
      const runsOn = String(Array.isArray(rawJob['runs-on']) ? rawJob['runs-on'][0] : rawJob['runs-on'] ?? 'ubuntu-latest');
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
        backend: pickBackend(rawJob, opts),
        runsOn,
      });
    }
  }
  return out;
}
