/**
 * Cross-OS bench workflow.
 *
 * Per-OS realities (these are GH-hosted runner constraints, not ours):
 *   ubuntu-latest   docker (linux containers) ✓, act ✓, bun via setup-bun ✓
 *                   → full bench: host + container + service-postgres + act head-to-head
 *
 *   macos-latest    docker ✗ (not preinstalled), act ✗ (needs docker), bun ✓
 *                   → host-only bench: our-ci, node-matrix, hono-bun
 *
 *   windows-latest  docker ⚠ (defaults to Windows containers, flaky for Linux),
 *                   act ⚠ (same blocker), bun ✓
 *                   → host-only bench: our-ci, node-matrix, hono-bun
 *
 * Triggered manually (workflow_dispatch) or weekly via cron — the bench
 * takes ~5 minutes per OS because of docker-pulls on Linux.
 */
import { Runner, expr, job, pipeline, step, triggers } from '@rehearse/ci';

const setup = [
  step.checkout({ fetchDepth: 0 }),
  step.action('pnpm/action-setup@v4', { with: { version: '9.15.0' }, name: 'Setup pnpm' }),
  step.action('actions/setup-node@v4', {
    with: { 'node-version': '22', cache: 'pnpm' },
    name: 'Setup Node 22',
  }),
  step.action('oven-sh/setup-bun@v2', {
    with: { 'bun-version': 'latest' },
    name: 'Setup Bun (for hono-bun target)',
  }),
  step.run('pnpm install --frozen-lockfile', { name: 'Install', shell: 'bash' }),
  // Build via turbo so workspace deps (@rehearse/ci → @rehearse/cli) build
  // in dependency order. A bare `pnpm --filter @rehearse/cli build` would
  // try to typecheck against a `@rehearse/ci` whose `dist/` doesn't exist yet
  // on a fresh checkout, and fail with TS2307 'Cannot find module @rehearse/ci'.
  step.run('pnpm turbo build --filter=@rehearse/cli...', {
    name: 'Build runner (and workspace deps)',
    shell: 'bash',
  }),
];

// act installs cleanly only where Docker is actually usable for Linux
// containers. Today that's ubuntu-latest only on GH-hosted runners.
const installAct = step.run(
  'curl -sL https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash -s -- -b /usr/local/bin && act --version',
  { name: 'Install act (Linux only)', shell: 'bash', condition: "runner.os == 'Linux'" },
);

const cloneHono = step.run(
  'git clone --depth 1 https://github.com/honojs/hono.git poc/playground/hono',
  { name: 'Clone hono fixture', shell: 'bash' },
);

// Linux: pull docker images so the bench's first run isn't dominated by pulls.
// macOS / Windows: no docker available on GH-hosted runners — skip cleanly.
const dockerPulls = step.run(
  'docker pull node:22-bookworm-slim & docker pull postgres:16-alpine & docker pull catthehacker/ubuntu:act-latest & wait',
  { name: 'Pre-pull Docker images (Linux only)', shell: 'bash', condition: "runner.os == 'Linux'", continueOnError: true },
);

const bench = (target: string, extraCondition?: string) =>
  step.run(
    `pnpm tsx bench/compare.ts --skip-cold --only ${target} | tee "bench-\${RUNNER_OS}-${target}.txt"`,
    {
      name: `Bench: ${target}`,
      shell: 'bash',
      condition: extraCondition,
      continueOnError: true,
    },
  );

const upload = step.action('actions/upload-artifact@v4', {
  with: {
    name: `bench-results-${expr('runner.os')}`,
    path: 'bench-*.txt',
    'if-no-files-found': 'warn',
  },
  name: 'Upload bench results',
});

export const benchPipeline = pipeline('Bench', {
  triggers: [
    triggers.workflowDispatch(),
    triggers.schedule('0 6 * * 1'), // Mondays 06:00 UTC
  ],
  permissions: { contents: 'read' },
  jobs: [
    job('bench', {
      runner: Runner.custom(expr('matrix.os')),
      timeoutMinutes: 30,
      matrix: {
        variables: { os: ['ubuntu-latest', 'macos-latest', 'windows-latest'] },
        failFast: false,
      },
      steps: [
        ...setup,
        installAct,
        cloneHono,
        dockerPulls,

        // Host-backend targets — work on every OS we ship to.
        bench('our-ci'),
        bench('node-matrix'),
        bench('hono-bun'),
        bench('hono-node-matrix'),

        // Docker-required targets — Linux GH runners only.
        bench('service-postgres', "runner.os == 'Linux'"),

        upload,
      ],
    }),
  ],
});
