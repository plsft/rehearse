/**
 * POC #2 — Compatibility analyzer.
 *
 * Audit any GitHub Actions workflow YAML and report what % of its steps the
 * runner can execute today, what's a no-op (host-equivalent), and what we
 * don't support yet. Output a per-job table and a feature-gap summary that
 * becomes the v1 backlog.
 *
 * Usage:
 *   pnpm tsx poc/2-compat.ts poc/fixtures/hono-ci.yml
 *   pnpm tsx poc/2-compat.ts poc/fixtures/vite-ci.yml
 *   pnpm tsx poc/2-compat.ts .github/workflows/ci.yml
 */
import { parseWorkflow, type ParsedJob, type ParsedStep } from '@rehearse/ci';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

type StepClass =
  | 'run'                  // shell script — supported today
  | 'uses-noop'            // checkout/setup-* — skipped, host equivalent
  | 'uses-supported'       // could implement easily
  | 'uses-unsupported'     // hard or out-of-scope
  | 'uses-local';          // local action (./.github/actions/*) — out of POC scope
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
  hasContainer: boolean;
  steps: StepAnalysis[];
}

const KNOWN_NOOP: Record<string, string> = {
  'actions/checkout': 'host has the repo',
  'actions/setup-node': 'use host node (or asdf/nvm)',
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
  'actions/upload-artifact': 'write to .runner/artifacts/',
  'actions/download-artifact': 'read from .runner/artifacts/',
};

const UNSUPPORTED_USES: Record<string, string> = {
  'codecov/codecov-action': 'external service upload — no-op locally',
  'actions/github-script': 'GitHub API — needs real GITHUB_TOKEN',
  'tj-actions/changed-files': 'git diff against PR base — feasible but not yet',
  'docker/setup-buildx-action': 'requires Docker daemon',
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
      return { index: idx, label, class: 'uses-local', reason: `local composite action: ${name}`, backend: defaultBackend, features };
    }
    if (KNOWN_NOOP[name]) {
      return { index: idx, label, class: 'uses-noop', reason: KNOWN_NOOP[name], backend: defaultBackend, features };
    }
    if (SUPPORTED_USES[name]) {
      return { index: idx, label, class: 'uses-supported', reason: SUPPORTED_USES[name], backend: defaultBackend, features };
    }
    if (UNSUPPORTED_USES[name]) {
      return { index: idx, label, class: 'uses-unsupported', reason: UNSUPPORTED_USES[name], backend: defaultBackend, features };
    }
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
  // Default backend: host on Linux/Mac, host on Windows (the steps usually work);
  // 'container' would be selected only when the host can't satisfy the runner OS.
  const defaultBackend: Backend = (isWindowsOnly && process.platform !== 'win32') || (isMacOnly && process.platform !== 'darwin')
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
    hasContainer: false,
    steps: job.steps.map((s, i) => classifyStep(s, i, defaultBackend)),
  };
}

function color(c: 'green' | 'red' | 'yellow' | 'cyan' | 'gray' | 'bold' | 'dim', s: string): string {
  if (!process.stdout.isTTY) return s;
  const map: Record<string, string> = {
    green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
    gray: '\x1b[90m', bold: '\x1b[1m', dim: '\x1b[2m',
  };
  return `${map[c]}${s}\x1b[0m`;
}

function printJobTable(jobs: JobAnalysis[]): void {
  console.log('');
  console.log(color('bold', 'Per-job analysis'));
  const cols = ['Job', 'Steps', 'run', 'noop', 'sup', 'unsup', 'matrix', 'if', 'needs', 'svc', 'backend'];
  const widths = [22, 6, 4, 5, 4, 6, 7, 3, 6, 4, 9];
  const header = cols.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(color('gray', header));
  console.log(color('gray', '─'.repeat(header.length)));
  for (const j of jobs) {
    const counts = j.steps.reduce(
      (acc, s) => ({ ...acc, [s.class]: (acc[s.class] ?? 0) + 1 }),
      {} as Record<string, number>,
    );
    const allHost = j.steps.every((s) => s.backend === 'host');
    const backend = allHost ? color('green', 'host') : color('yellow', 'container');
    const row = [
      j.key.slice(0, widths[0]!),
      String(j.steps.length),
      String(counts.run ?? 0),
      String(counts['uses-noop'] ?? 0),
      String(counts['uses-supported'] ?? 0),
      String(counts['uses-unsupported'] ?? 0),
      j.hasMatrix ? color('yellow', 'yes') : color('gray', 'no'),
      j.hasIf ? color('yellow', 'yes') : color('gray', 'no'),
      String(j.needsCount),
      j.hasServices ? color('yellow', 'yes') : color('gray', 'no'),
      backend,
    ];
    console.log(row.map((v, i) => v.padEnd(widths[i]!)).join('  '));
  }
}

function printSummary(jobs: JobAnalysis[], file: string): void {
  const stepsTotal = jobs.flatMap((j) => j.steps).length;
  const stepsByClass = jobs.flatMap((j) => j.steps).reduce(
    (acc, s) => ({ ...acc, [s.class]: (acc[s.class] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  const supported = (stepsByClass.run ?? 0) + (stepsByClass['uses-noop'] ?? 0) + (stepsByClass['uses-supported'] ?? 0);
  const supportedPct = ((supported / stepsTotal) * 100).toFixed(1);

  const allFeatures = new Map<string, number>();
  for (const j of jobs) {
    for (const s of j.steps) {
      for (const f of s.features) allFeatures.set(f, (allFeatures.get(f) ?? 0) + 1);
    }
  }

  const unsupportedSamples = jobs
    .flatMap((j) => j.steps)
    .filter((s) => s.class === 'uses-unsupported' || s.class === 'uses-local')
    .slice(0, 10);

  console.log('');
  console.log(color('bold', 'Summary'));
  console.log(color('gray', '─'.repeat(70)));
  console.log(`  File:               ${file}`);
  console.log(`  Jobs:               ${jobs.length}`);
  console.log(`  Steps total:        ${stepsTotal}`);
  console.log(`  ${color('green', '✓')} run scripts:       ${stepsByClass.run ?? 0}`);
  console.log(`  ${color('green', '✓')} uses (host noop):  ${stepsByClass['uses-noop'] ?? 0}`);
  console.log(`  ${color('cyan', '~')} uses (supported):  ${stepsByClass['uses-supported'] ?? 0}`);
  console.log(`  ${color('red', '✗')} uses (unsupported):${stepsByClass['uses-unsupported'] ?? 0}`);
  console.log(`  ${color('yellow', '~')} local actions:     ${stepsByClass['uses-local'] ?? 0}`);
  console.log('');
  console.log(`  Coverage:           ${supportedPct}% of ${stepsTotal} steps would execute`);

  console.log('');
  console.log(color('bold', 'Features in use (frequency)'));
  console.log(color('gray', '─'.repeat(70)));
  const sortedFeatures = Array.from(allFeatures.entries()).sort((a, b) => b[1] - a[1]);
  for (const [feat, n] of sortedFeatures) {
    console.log(`  ${String(n).padStart(3)}× ${feat}`);
  }

  if (unsupportedSamples.length > 0) {
    console.log('');
    console.log(color('bold', 'Top unsupported / local actions'));
    console.log(color('gray', '─'.repeat(70)));
    for (const s of unsupportedSamples) {
      console.log(`  ${color('red', '✗')} ${s.label.padEnd(40)} ${color('gray', s.reason ?? '')}`);
    }
  }
}

function main(): void {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: tsx poc/2-compat.ts <workflow.yml>');
    process.exit(2);
  }
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) {
    console.error(`not found: ${path}`);
    process.exit(2);
  }
  const yaml = readFileSync(path, 'utf-8');
  const wf = parseWorkflow(yaml);
  const jobs = Object.entries(wf.jobs).map(([k, j]) => analyzeJob(k, j));

  console.log(color('bold', `Compatibility audit: ${wf.name ?? file}`));
  console.log(color('gray', path));

  printJobTable(jobs);
  printSummary(jobs, file);
}

main();
