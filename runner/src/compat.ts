/**
 * Workflow compatibility analyzer.
 *
 * Given a `.github/workflows/*.yml`, classify every step against what the
 * runner can currently execute and report:
 *   - per-job table (steps / classifications / matrix / needs / services / backend)
 *   - feature usage frequencies (`if:` conditions, `${{ … }}` contexts)
 *   - top unsupported / local actions (the v1 backlog)
 *
 * Hoisted from `poc/2-compat.ts` so it ships in the runner CLI as
 * `runner compat <yml>`.
 */
import { parseWorkflow, type ParsedJob, type ParsedStep } from '@gitgate/ci';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pc from 'picocolors';

type StepClass = 'run' | 'uses-noop' | 'uses-supported' | 'uses-unsupported' | 'uses-local';
type Backend = 'host' | 'container';

interface StepAnalysis {
  index: number;
  label: string;
  class: StepClass;
  reason?: string;
  backend: Backend;
  features: Set<string>;
}

interface JobAnalysis {
  key: string;
  name: string;
  runsOn: string | string[];
  hasMatrix: boolean;
  hasIf: boolean;
  needsCount: number;
  hasServices: boolean;
  steps: StepAnalysis[];
}

const KNOWN_NOOP: Record<string, string> = {
  'actions/checkout': 'host has the repo',
  'actions/setup-node': 'use host node (or fnm fallback)',
  'actions/setup-python': 'use host python',
  'actions/setup-go': 'use host go',
  'actions/setup-java': 'use host java',
  'actions/setup-dotnet': 'use host dotnet',
  'oven-sh/setup-bun': 'use host bun',
  'pnpm/action-setup': 'use host pnpm',
  'denoland/setup-deno': 'use host deno',
  'dtolnay/rust-toolchain': 'use host rustup',
  'ruby/setup-ruby': 'use host ruby',
  'actions/cache': 'cache via local fs',
  'actions/cache/save': 'cache via local fs',
  'actions/cache/restore': 'cache via local fs',
};

const SUPPORTED_USES: Record<string, string> = {
  'actions/upload-artifact': 'local fs (.runner/artifacts/)',
  'actions/download-artifact': 'local fs (.runner/artifacts/)',
};

const UNSUPPORTED_USES: Record<string, string> = {
  'codecov/codecov-action': 'external service upload — no-op locally',
  'actions/github-script': 'GitHub API — needs real GITHUB_TOKEN',
  'tj-actions/changed-files': 'git diff against PR base — feasible but not yet',
  'docker/setup-buildx-action': 'requires Docker daemon — supported in container backend',
  'docker/login-action': 'requires registry credentials',
  'docker/build-push-action': 'requires Docker daemon',
  'softprops/action-gh-release': 'GitHub API',
  'peter-evans/create-pull-request': 'GitHub API',
};

function actionName(uses: string): string {
  const at = uses.indexOf('@');
  return at >= 0 ? uses.slice(0, at) : uses;
}

function classifyStep(step: ParsedStep, idx: number, defaultBackend: Backend): StepAnalysis {
  const features = new Set<string>();
  const label = step.name ?? step.uses ?? step.run?.split('\n')[0]?.slice(0, 60) ?? `step ${idx + 1}`;
  if (step.if) features.add(`if: ${step.if}`);
  if (step['working-directory']) features.add('working-directory');
  if (step.shell) features.add(`shell: ${step.shell}`);
  if (step['continue-on-error']) features.add('continue-on-error');
  if (step['timeout-minutes'] != null) features.add('timeout-minutes');

  if (step.uses) {
    const name = actionName(step.uses);
    if (name.startsWith('./')) {
      return { index: idx, label, class: 'uses-local', reason: `local composite: ${name}`, backend: defaultBackend, features };
    }
    if (KNOWN_NOOP[name]) return { index: idx, label, class: 'uses-noop', reason: KNOWN_NOOP[name], backend: defaultBackend, features };
    if (SUPPORTED_USES[name]) return { index: idx, label, class: 'uses-supported', reason: SUPPORTED_USES[name], backend: defaultBackend, features };
    if (UNSUPPORTED_USES[name]) return { index: idx, label, class: 'uses-unsupported', reason: UNSUPPORTED_USES[name], backend: defaultBackend, features };
    return { index: idx, label, class: 'uses-unsupported', reason: `unknown action: ${name}`, backend: defaultBackend, features };
  }

  if (step.run) {
    if (step.run.includes('${{ matrix.')) features.add('expr: matrix');
    if (step.run.match(/\$\{\{\s*secrets\./)) features.add('expr: secrets');
    if (step.run.match(/\$\{\{\s*github\./)) features.add('expr: github context');
    if (step.run.match(/\$\{\{\s*env\./)) features.add('expr: env');
    return { index: idx, label, class: 'run', backend: defaultBackend, features };
  }

  return { index: idx, label, class: 'uses-unsupported', reason: 'no run/uses', backend: defaultBackend, features };
}

function analyzeJob(key: string, job: ParsedJob): JobAnalysis {
  const runsOn = Array.isArray(job['runs-on']) ? job['runs-on'].join(',') : (job['runs-on'] ?? '?');
  const runsOnStr = String(runsOn);
  const isWindowsOnly = runsOnStr === 'windows-latest' || runsOnStr.startsWith('windows-');
  const isMacOnly = runsOnStr === 'macos-latest' || runsOnStr.startsWith('macos-');
  const defaultBackend: Backend =
    (isWindowsOnly && process.platform !== 'win32') || (isMacOnly && process.platform !== 'darwin')
      ? 'container'
      : 'host';
  return {
    key,
    name: job.name ?? key,
    runsOn: job['runs-on'],
    hasMatrix: !!job.strategy?.matrix,
    hasIf: !!job.if,
    needsCount: Array.isArray(job.needs) ? job.needs.length : (job.needs ? 1 : 0),
    hasServices: !!job.services && Object.keys(job.services).length > 0,
    steps: job.steps.map((s, i) => classifyStep(s, i, defaultBackend)),
  };
}

interface RunResult {
  workflowName: string;
  workflowPath: string;
  jobs: JobAnalysis[];
  stepsTotal: number;
  byClass: Record<StepClass, number>;
  coverage: number;
}

export function compat(workflowPath: string): RunResult {
  const path = resolve(process.cwd(), workflowPath);
  if (!existsSync(path)) throw new Error(`workflow not found: ${path}`);
  const yaml = readFileSync(path, 'utf-8');
  const wf = parseWorkflow(yaml);
  const jobs = Object.entries(wf.jobs).map(([k, j]) => analyzeJob(k, j));
  const stepsTotal = jobs.flatMap((j) => j.steps).length;
  const byClass = jobs.flatMap((j) => j.steps).reduce(
    (acc, s) => ({ ...acc, [s.class]: (acc[s.class] ?? 0) + 1 }),
    { run: 0, 'uses-noop': 0, 'uses-supported': 0, 'uses-unsupported': 0, 'uses-local': 0 } as Record<StepClass, number>,
  );
  const supported = byClass.run + byClass['uses-noop'] + byClass['uses-supported'];
  const coverage = stepsTotal === 0 ? 0 : (supported / stepsTotal) * 100;
  return { workflowName: wf.name ?? workflowPath, workflowPath: path, jobs, stepsTotal, byClass, coverage };
}

export function printReport(r: RunResult, opts: { json?: boolean } = {}): void {
  if (opts.json) {
    process.stdout.write(JSON.stringify({
      workflow: r.workflowName, path: r.workflowPath, stepsTotal: r.stepsTotal,
      byClass: r.byClass, coverage: r.coverage,
      jobs: r.jobs.map((j) => ({
        key: j.key, name: j.name, runsOn: j.runsOn, hasMatrix: j.hasMatrix,
        hasIf: j.hasIf, needsCount: j.needsCount, hasServices: j.hasServices,
        steps: j.steps.map((s) => ({ label: s.label, class: s.class, reason: s.reason, backend: s.backend })),
      })),
    }, null, 2) + '\n');
    return;
  }

  console.log(pc.bold(`Compatibility audit: ${r.workflowName}`));
  console.log(pc.gray(r.workflowPath));
  console.log('');
  console.log(pc.bold('Per-job analysis'));
  const cols = ['Job', 'Steps', 'run', 'noop', 'sup', 'unsup', 'local', 'matrix', 'if', 'needs', 'svc', 'backend'];
  const widths = [22, 6, 4, 5, 4, 6, 6, 7, 3, 6, 4, 9];
  const header = cols.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(pc.gray(header));
  console.log(pc.gray('─'.repeat(header.length)));
  for (const j of r.jobs) {
    const counts = j.steps.reduce(
      (acc, s) => ({ ...acc, [s.class]: (acc[s.class] ?? 0) + 1 }),
      {} as Record<string, number>,
    );
    const allHost = j.steps.every((s) => s.backend === 'host');
    const backend = allHost ? pc.green('host') : pc.yellow('container');
    const row = [
      j.key.slice(0, widths[0]!),
      String(j.steps.length),
      String(counts.run ?? 0),
      String(counts['uses-noop'] ?? 0),
      String(counts['uses-supported'] ?? 0),
      String(counts['uses-unsupported'] ?? 0),
      String(counts['uses-local'] ?? 0),
      j.hasMatrix ? pc.yellow('yes') : pc.gray('no'),
      j.hasIf ? pc.yellow('yes') : pc.gray('no'),
      String(j.needsCount),
      j.hasServices ? pc.yellow('yes') : pc.gray('no'),
      backend,
    ];
    console.log(row.map((v, i) => v.padEnd(widths[i]!)).join('  '));
  }

  const allFeatures = new Map<string, number>();
  for (const j of r.jobs) for (const s of j.steps) for (const f of s.features) allFeatures.set(f, (allFeatures.get(f) ?? 0) + 1);

  console.log('');
  console.log(pc.bold('Summary'));
  console.log(pc.gray('─'.repeat(70)));
  console.log(`  Jobs:               ${r.jobs.length}`);
  console.log(`  Steps total:        ${r.stepsTotal}`);
  console.log(`  ${pc.green('✓')} run scripts:       ${r.byClass.run}`);
  console.log(`  ${pc.green('✓')} uses (host noop):  ${r.byClass['uses-noop']}`);
  console.log(`  ${pc.cyan('~')} uses (supported):  ${r.byClass['uses-supported']}`);
  console.log(`  ${pc.red('✗')} uses (unsupported):${r.byClass['uses-unsupported']}`);
  console.log(`  ${pc.yellow('~')} local actions:     ${r.byClass['uses-local']}`);
  console.log('');
  console.log(`  ${pc.bold('Coverage:')}           ${r.coverage.toFixed(1)}% of ${r.stepsTotal} steps would execute`);

  if (allFeatures.size > 0) {
    console.log('');
    console.log(pc.bold('Features in use'));
    console.log(pc.gray('─'.repeat(70)));
    for (const [feat, n] of [...allFeatures.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}× ${feat}`);
    }
  }

  const unsupportedSamples = r.jobs
    .flatMap((j) => j.steps)
    .filter((s) => s.class === 'uses-unsupported' || s.class === 'uses-local')
    .slice(0, 12);
  if (unsupportedSamples.length > 0) {
    console.log('');
    console.log(pc.bold('Top unsupported / local actions'));
    console.log(pc.gray('─'.repeat(70)));
    for (const s of unsupportedSamples) {
      console.log(`  ${pc.red('✗')} ${s.label.padEnd(40)} ${pc.gray(s.reason ?? '')}`);
    }
  }
}
