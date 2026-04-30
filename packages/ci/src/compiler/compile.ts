import { resolveRunner } from '../builder/runner.js';
import type {
  Job,
  Permissions,
  Pipeline,
  PullRequestTriggerConfig,
  PushTriggerConfig,
  Step,
  Trigger,
  WorkflowDispatchConfig,
} from '../types.js';
import { generateHeader, type HeaderOptions } from './header.js';
import { toYaml } from './yaml.js';

export interface CompileOptions extends HeaderOptions {
  /** When true, skip the auto-generated header banner. */
  omitHeader?: boolean;
}

/**
 * Compile a Pipeline to a complete GitHub Actions YAML document.
 */
export function compile(pipeline: Pipeline, options: CompileOptions = {}): string {
  const doc: Record<string, unknown> = {};
  doc.name = pipeline.name;
  doc.on = compileTriggers(pipeline.triggers);
  if (pipeline.permissions !== undefined) {
    doc.permissions = compilePermissions(pipeline.permissions);
  }
  if (pipeline.concurrency) {
    doc.concurrency = compileConcurrency(pipeline.concurrency);
  }
  if (pipeline.env) doc.env = pipeline.env;
  if (pipeline.defaults?.run && Object.keys(pipeline.defaults.run).length > 0) {
    doc.defaults = compileDefaults(pipeline.defaults);
  }
  doc.jobs = compileJobs(pipeline.jobs);

  const yaml = toYaml(doc);
  const header = options.omitHeader ? '' : generateHeader(options);
  return `${header}${yaml}`;
}

function compileTriggers(triggers: Trigger[]): unknown {
  if (triggers.length === 1) {
    const t = triggers[0]!;
    return { [t.event]: triggerConfig(t) ?? {} };
  }
  const out: Record<string, unknown> = {};
  const scheduleCrons: Array<{ cron: string }> = [];
  for (const t of triggers) {
    if (t.event === 'schedule') {
      scheduleCrons.push({ cron: (t.config as { cron: string }).cron });
    } else {
      // null configs (`pull_request:`) emit as `pull_request: {}` — semantically
      // "trigger on all events of this type" in GitHub Actions.
      out[t.event] = triggerConfig(t) ?? {};
    }
  }
  if (scheduleCrons.length > 0) out.schedule = scheduleCrons;
  return out;
}

function triggerConfig(t: Trigger): unknown {
  switch (t.event) {
    case 'push': {
      const c = (t.config ?? {}) as PushTriggerConfig;
      return mapPushPullKeys(c as unknown as Record<string, unknown>);
    }
    case 'pull_request': {
      const c = (t.config ?? {}) as PullRequestTriggerConfig;
      return mapPushPullKeys(c as unknown as Record<string, unknown>);
    }
    case 'workflow_dispatch': {
      const c = (t.config ?? {}) as WorkflowDispatchConfig;
      if (!c.inputs || Object.keys(c.inputs).length === 0) return null;
      const inputs: Record<string, unknown> = {};
      for (const [name, input] of Object.entries(c.inputs)) {
        const obj: Record<string, unknown> = { description: input.description };
        if (input.required !== undefined) obj.required = input.required;
        if (input.default !== undefined) obj.default = input.default;
        if (input.type !== undefined) obj.type = input.type;
        if (input.options !== undefined) obj.options = input.options;
        inputs[name] = obj;
      }
      return { inputs };
    }
    case 'schedule':
      return [{ cron: (t.config as { cron: string }).cron }];
    case 'release': {
      const c = t.config as { types?: string[] } | undefined;
      if (!c?.types) return null;
      return { types: c.types };
    }
    case 'workflow_run': {
      const c = (t.config ?? {}) as { workflows?: string[]; types?: string[] };
      const out: Record<string, unknown> = {};
      if (c.workflows) out.workflows = c.workflows;
      if (c.types) out.types = c.types;
      return out;
    }
  }
}

function mapPushPullKeys(c: Record<string, unknown>): Record<string, unknown> | null {
  const map: Record<string, string> = {
    branchesIgnore: 'branches-ignore',
    tagsIgnore: 'tags-ignore',
    pathsIgnore: 'paths-ignore',
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (v === undefined) continue;
    out[map[k] ?? k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function compilePermissions(p: Permissions): unknown {
  if (typeof p === 'string') return p;
  const map: Record<string, string> = {
    idToken: 'id-token',
    pullRequests: 'pull-requests',
    repositoryProjects: 'repository-projects',
    securityEvents: 'security-events',
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    out[map[k] ?? k] = v;
  }
  return out;
}

function compileConcurrency(c: { group: string; cancelInProgress?: boolean }): unknown {
  const out: Record<string, unknown> = { group: c.group };
  if (c.cancelInProgress !== undefined) out['cancel-in-progress'] = c.cancelInProgress;
  return out;
}

function compileDefaults(d: { run?: { shell?: string; workingDirectory?: string } }): unknown {
  if (!d.run) return null;
  const run: Record<string, unknown> = {};
  if (d.run.shell) run.shell = d.run.shell;
  if (d.run.workingDirectory) run['working-directory'] = d.run.workingDirectory;
  return Object.keys(run).length > 0 ? { run } : null;
}

function sanitizeJobKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function compileJobs(jobs: Job[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const job of jobs) {
    const key = sanitizeJobKey(job.name);
    out[key] = compileJob(job);
  }
  return out;
}

function compileJob(job: Job): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: job.name,
    'runs-on': resolveRunner(job.runner),
  };
  if (job.needs && job.needs.length > 0) {
    out.needs = job.needs.length === 1 ? job.needs[0] : job.needs;
  }
  if (job.condition) out.if = job.condition;
  if (job.timeoutMinutes !== undefined) out['timeout-minutes'] = job.timeoutMinutes;
  if (job.permissions !== undefined) out.permissions = compilePermissions(job.permissions);
  if (job.matrix) out.strategy = compileStrategy(job.matrix);
  if (job.concurrency) out.concurrency = compileConcurrency(job.concurrency);
  if (job.environment) {
    if (typeof job.environment === 'string') {
      out.environment = job.environment;
    } else {
      out.environment = compileEnvironment(job.environment);
    }
  }
  if (job.outputs && Object.keys(job.outputs).length > 0) out.outputs = job.outputs;
  if (job.env && Object.keys(job.env).length > 0) out.env = job.env;
  if (job.defaults) {
    const d = compileDefaults(job.defaults);
    if (d) out.defaults = d;
  }
  if (job.services && Object.keys(job.services).length > 0) {
    out.services = compileServices(job.services);
  }
  if (job.continueOnError !== undefined) out['continue-on-error'] = job.continueOnError;
  out.steps = compileSteps(job.steps);
  return out;
}

function compileEnvironment(e: { name: string; url?: string }): unknown {
  const out: Record<string, unknown> = { name: e.name };
  if (e.url) out.url = e.url;
  return out;
}

function compileStrategy(matrix: NonNullable<Job['matrix']>): Record<string, unknown> {
  const m: Record<string, unknown> = {};
  if (matrix.variables) {
    for (const [k, v] of Object.entries(matrix.variables)) m[k] = v;
  }
  if (matrix.include) m.include = matrix.include;
  if (matrix.exclude) m.exclude = matrix.exclude;
  const out: Record<string, unknown> = { matrix: m };
  if (matrix.failFast !== undefined) out['fail-fast'] = matrix.failFast;
  if (matrix.maxParallel !== undefined) out['max-parallel'] = matrix.maxParallel;
  return out;
}

function compileServices(
  services: Record<string, NonNullable<Job['services']>[string]>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, svc] of Object.entries(services)) {
    const s: Record<string, unknown> = { image: svc.image };
    if (svc.ports && svc.ports.length > 0) s.ports = svc.ports;
    if (svc.env && Object.keys(svc.env).length > 0) s.env = svc.env;
    if (svc.options) s.options = svc.options;
    if (svc.credentials) s.credentials = svc.credentials;
    out[name] = s;
  }
  return out;
}

function compileSteps(steps: Step[]): unknown[] {
  const flat: Step[] = [];
  for (const s of steps) {
    if (Array.isArray(s)) {
      flat.push(...(s as Step[]));
    } else {
      flat.push(s);
    }
  }
  return flat.map((s) => compileStep(s));
}

function compileStep(s: Step): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (s.name) out.name = s.name;
  if (s.id) out.id = s.id;
  if (s.condition) out.if = s.condition;
  if (s.uses) out.uses = s.uses;
  if (s.run) out.run = s.run;
  if (s.shell) out.shell = s.shell;
  if (s.with && Object.keys(s.with).length > 0) out.with = s.with;
  if (s.env && Object.keys(s.env).length > 0) out.env = s.env;
  if (s.workingDirectory) out['working-directory'] = s.workingDirectory;
  if (s.continueOnError !== undefined) out['continue-on-error'] = s.continueOnError;
  if (s.timeoutMinutes !== undefined) out['timeout-minutes'] = s.timeoutMinutes;
  return out;
}
