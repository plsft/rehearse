/**
 * Cross-OS bench workflow.
 *
 * Runs the full bench harness on ubuntu, macos, and windows GitHub-hosted
 * runners. Each OS lands a JSON artifact; an aggregator job collects them
 * into a single matrix report we can publish on the marketing site.
 *
 * Triggered manually (workflow_dispatch) or weekly via cron — we don't
 * fire on push because the bench takes ~5 minutes and runs Docker-pulls.
 */
import { Runner, expr, github, job, pipeline, step, triggers } from '@gitgate/ci';

const setup = [
  step.checkout({ fetchDepth: 0 }),
  step.action('pnpm/action-setup@v4', { with: { version: '9.15.0' }, name: 'Setup pnpm' }),
  step.action('actions/setup-node@v4', {
    with: { 'node-version': '22', cache: 'pnpm' },
    name: 'Setup Node 22',
  }),
  step.run('pnpm install --frozen-lockfile', { name: 'Install' }),
  step.run('pnpm --filter @gitgate/runner build', { name: 'Build runner' }),
];

const installAct = step.run(
  `if [[ "$RUNNER_OS" == "Linux" ]]; then
  curl -sL https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash -s -- -b /usr/local/bin
elif [[ "$RUNNER_OS" == "macOS" ]]; then
  brew install act || true
elif [[ "$RUNNER_OS" == "Windows" ]]; then
  choco install act-cli -y || true
fi
act --version`,
  { name: 'Install act', shell: 'bash' },
);

const cloneHono = step.run(
  'git clone --depth 1 https://github.com/honojs/hono.git poc/playground/hono',
  { name: 'Clone hono fixture', shell: 'bash' },
);

const dockerPulls = step.run(
  `if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker pull node:22-bookworm-slim &
  docker pull postgres:16-alpine &
  docker pull catthehacker/ubuntu:act-latest &
  wait
  echo "DOCKER_AVAILABLE=true" >> "$GITHUB_ENV"
else
  echo "::warning::Docker not running on $RUNNER_OS — service-postgres + container bench will skip"
  echo "DOCKER_AVAILABLE=false" >> "$GITHUB_ENV"
fi`,
  { name: 'Pre-pull Docker images', shell: 'bash' },
);

const benchHostOnly = step.run(
  'pnpm tsx bench/compare.ts --skip-cold --only our-ci > "bench-${RUNNER_OS}-host.txt" 2>&1 || true',
  { name: 'Bench: host backend (our-ci)', shell: 'bash' },
);

const benchMatrix = step.run(
  'pnpm tsx bench/compare.ts --skip-cold --only node-matrix > "bench-${RUNNER_OS}-matrix.txt" 2>&1 || true',
  { name: 'Bench: matrix workflow', shell: 'bash' },
);

const benchPostgres = step.run(
  `if [ "$DOCKER_AVAILABLE" = "true" ]; then
  pnpm tsx bench/compare.ts --skip-cold --only service-postgres > "bench-\${RUNNER_OS}-postgres.txt" 2>&1 || true
else
  echo "skipped: Docker not available on $RUNNER_OS" > "bench-\${RUNNER_OS}-postgres.txt"
fi`,
  { name: 'Bench: services (postgres)', shell: 'bash', env: { DOCKER_AVAILABLE: expr('env.DOCKER_AVAILABLE') } },
);

const benchHonoBun = step.run(
  `if command -v bun >/dev/null 2>&1; then
  pnpm tsx bench/compare.ts --skip-cold --only hono-bun > "bench-\${RUNNER_OS}-hono-bun.txt" 2>&1 || true
else
  echo "skipped: bun not on PATH for $RUNNER_OS" > "bench-\${RUNNER_OS}-hono-bun.txt"
fi`,
  { name: 'Bench: real OSS workflow', shell: 'bash' },
);

const installBun = step.action('oven-sh/setup-bun@v2', {
  with: { 'bun-version': 'latest' },
  name: 'Install bun (for hono-bun target)',
});

const upload = step.action('actions/upload-artifact@v4', {
  with: { name: `bench-results-${expr('runner.os')}`, path: `bench-*.txt` },
  name: 'Upload bench results',
});

export const bench = pipeline('Bench', {
  triggers: [
    triggers.workflowDispatch(),
    triggers.schedule('0 6 * * 1'), // Mondays 06:00 UTC
  ],
  permissions: { contents: 'read' },
  jobs: [
    job('bench', {
      runner: Runner.custom(expr('matrix.os')),
      timeoutMinutes: 25,
      matrix: { variables: { os: ['ubuntu-latest', 'macos-latest', 'windows-latest'] }, failFast: false },
      steps: [
        ...setup,
        installBun,
        installAct,
        cloneHono,
        dockerPulls,
        benchHostOnly,
        benchMatrix,
        benchHonoBun,
        benchPostgres,
        upload,
      ],
    }),
  ],
});
