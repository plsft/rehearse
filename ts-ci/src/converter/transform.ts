import type { ParsedJob, ParsedStep, ParsedTriggers, ParsedWorkflow } from './parse.js';
import { parseWorkflow } from './parse.js';
import { mapRunner } from './runner-map.js';

export interface ConvertOptions {
  /** Variable name for the exported pipeline. Default: `pipelineName` || `'workflow'`. */
  exportName?: string;
}

export interface ConvertResult {
  source: string;
  warnings: string[];
}

/**
 * Convert a GitHub Actions YAML workflow string into TypeScript that uses
 * the @rehearse/ci SDK. Returns the generated source and any best-effort
 * warnings about constructs that did not map cleanly.
 */
export function convert(yamlSource: string, options: ConvertOptions = {}): ConvertResult {
  const wf = parseWorkflow(yamlSource);
  const warnings: string[] = [];

  const imports = new Set<string>(['pipeline', 'job', 'step', 'triggers', 'Runner']);
  const jobBlocks: string[] = [];
  for (const [key, parsed] of Object.entries(wf.jobs)) {
    jobBlocks.push(renderJob(key, parsed, warnings));
  }

  const triggerBlock = renderTriggers(wf.on, warnings);

  const exportName = options.exportName ?? 'workflow';
  const importLine = `import { ${Array.from(imports).sort().join(', ')} } from '@rehearse/ci';`;

  const pipelineCfg: string[] = [`  triggers: [${triggerBlock}],`, `  jobs: [${jobBlocks.join(', ')}],`];
  if (wf.permissions !== undefined) {
    pipelineCfg.push(`  permissions: ${JSON.stringify(wf.permissions)},`);
  }
  if (wf.env) {
    pipelineCfg.push(`  env: ${JSON.stringify(wf.env)},`);
  }

  const name = wf.name ?? exportName;
  const source = [
    `// AUTO-CONVERTED from GitHub Actions YAML by @rehearse/ci`,
    importLine,
    '',
    `export const ${exportName} = pipeline(${JSON.stringify(name)}, {`,
    pipelineCfg.join('\n'),
    '});',
    '',
  ].join('\n');

  return { source, warnings };
}

function renderTriggers(on: ParsedTriggers, warnings: string[]): string {
  if (typeof on === 'string') {
    return renderTriggerEvent(on, undefined, warnings);
  }
  if (Array.isArray(on)) {
    return on.map((e) => renderTriggerEvent(e, undefined, warnings)).join(', ');
  }
  return Object.entries(on)
    .map(([event, config]) => renderTriggerEvent(event, config, warnings))
    .join(', ');
}

function renderTriggerEvent(event: string, config: unknown, warnings: string[]): string {
  switch (event) {
    case 'push':
      return `triggers.push(${configFromBranches(config)})`;
    case 'pull_request':
      return `triggers.pullRequest(${configFromBranches(config)})`;
    case 'workflow_dispatch':
      return `triggers.workflowDispatch()`;
    case 'schedule':
      if (Array.isArray(config) && config.length > 0) {
        const first = config[0] as { cron?: string };
        if (first.cron) return `triggers.schedule(${JSON.stringify(first.cron)})`;
      }
      warnings.push(`Could not parse schedule trigger config`);
      return `triggers.schedule('0 0 * * *')`;
    case 'release':
      return `triggers.release()`;
    case 'workflow_run':
      return `triggers.workflowRun()`;
    default:
      warnings.push(`Unknown trigger event "${event}" — emitted as workflowDispatch placeholder`);
      return `triggers.workflowDispatch()`;
  }
}

function configFromBranches(config: unknown): string {
  if (!config || typeof config !== 'object') return '';
  const c = config as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const keyMap: Record<string, string> = {
    branches: 'branches',
    'branches-ignore': 'branchesIgnore',
    tags: 'tags',
    'tags-ignore': 'tagsIgnore',
    paths: 'paths',
    'paths-ignore': 'pathsIgnore',
    types: 'types',
  };
  for (const [k, v] of Object.entries(c)) {
    const mapped = keyMap[k];
    if (mapped) out[mapped] = v;
  }
  if (Object.keys(out).length === 0) return '';
  return JSON.stringify(out);
}

function renderJob(key: string, parsed: ParsedJob, warnings: string[]): string {
  const name = parsed.name ?? key;
  const runner = mapRunner(parsed['runs-on']);
  const stepBlocks = parsed.steps.map((s) => renderStep(s, warnings));
  const cfg: string[] = [`runner: ${runner}`, `steps: [${stepBlocks.join(', ')}]`];
  if (parsed.needs) {
    const needs = Array.isArray(parsed.needs) ? parsed.needs : [parsed.needs];
    cfg.push(`needs: ${JSON.stringify(needs)}`);
  }
  if (parsed.if) cfg.push(`condition: ${JSON.stringify(parsed.if)}`);
  if (parsed['timeout-minutes'] !== undefined) cfg.push(`timeoutMinutes: ${parsed['timeout-minutes']}`);
  if (parsed.env) cfg.push(`env: ${JSON.stringify(parsed.env)}`);
  if (parsed.outputs) cfg.push(`outputs: ${JSON.stringify(parsed.outputs)}`);
  if (parsed['continue-on-error'] !== undefined) cfg.push(`continueOnError: ${parsed['continue-on-error']}`);
  return `\n  job(${JSON.stringify(name)}, { ${cfg.join(', ')} })`;
}

function renderStep(parsed: ParsedStep, warnings: string[]): string {
  const config = stepConfigBody(parsed);
  if (parsed.uses === 'actions/checkout@v4' || parsed.uses === 'actions/checkout@v3') {
    return `step.checkout()`;
  }
  if (parsed.uses?.startsWith('actions/setup-node@')) {
    const v = parsed.with?.['node-version'];
    warnings.push('actions/setup-node mapped to step.action — install @rehearse/ci/presets and use node.setup() for nicer ergonomics');
    return v ? `step.action(${JSON.stringify(parsed.uses)}, ${withBlock(parsed)})` : `step.action(${JSON.stringify(parsed.uses)})`;
  }
  if (parsed.uses) {
    return `step.action(${JSON.stringify(parsed.uses)}${configToOptions(parsed) ? `, ${configToOptions(parsed)}` : ''})`;
  }
  if (parsed.run) {
    const cmd = JSON.stringify(parsed.run);
    return config ? `step.run(${cmd}, ${config})` : `step.run(${cmd})`;
  }
  warnings.push('Encountered a step with no `uses` or `run` — skipping');
  return `step.run('# unrecognized step', { name: ${JSON.stringify(parsed.name ?? 'unknown')} })`;
}

function withBlock(parsed: ParsedStep): string {
  const opts: Record<string, unknown> = {};
  if (parsed.name) opts.name = parsed.name;
  if (parsed.id) opts.id = parsed.id;
  if (parsed.with) opts.with = parsed.with;
  if (parsed.env) opts.env = parsed.env;
  if (parsed.if) opts.condition = parsed.if;
  if (parsed['working-directory']) opts.workingDirectory = parsed['working-directory'];
  if (parsed['continue-on-error'] !== undefined) opts.continueOnError = parsed['continue-on-error'];
  return JSON.stringify(opts);
}

function configToOptions(parsed: ParsedStep): string {
  const opts: Record<string, unknown> = {};
  if (parsed.name) opts.name = parsed.name;
  if (parsed.id) opts.id = parsed.id;
  if (parsed.with) opts.with = parsed.with;
  if (parsed.env) opts.env = parsed.env;
  if (parsed.if) opts.condition = parsed.if;
  if (parsed['working-directory']) opts.workingDirectory = parsed['working-directory'];
  if (parsed['continue-on-error'] !== undefined) opts.continueOnError = parsed['continue-on-error'];
  return Object.keys(opts).length > 0 ? JSON.stringify(opts) : '';
}

function stepConfigBody(parsed: ParsedStep): string {
  const opts: Record<string, unknown> = {};
  if (parsed.name) opts.name = parsed.name;
  if (parsed.id) opts.id = parsed.id;
  if (parsed.shell) opts.shell = parsed.shell;
  if (parsed.env) opts.env = parsed.env;
  if (parsed.if) opts.condition = parsed.if;
  if (parsed['working-directory']) opts.workingDirectory = parsed['working-directory'];
  if (parsed['continue-on-error'] !== undefined) opts.continueOnError = parsed['continue-on-error'];
  return Object.keys(opts).length > 0 ? JSON.stringify(opts) : '';
}
