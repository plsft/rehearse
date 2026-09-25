/**
 * Repo CI — typecheck + test the OSS packages on every PR.
 */
import { Runner, job, pipeline, step, triggers } from '@rehearse/ci';

const setupNodePnpm = [
  step.action('actions/checkout@v7', { name: 'Checkout', with: { 'fetch-depth': 0 } }),
  step.action('pnpm/action-setup@v6', { with: { version: '9.15.0' }, name: 'Setup pnpm' }),
  step.action('actions/setup-node@v7', {
    with: { 'node-version': '22', cache: 'pnpm' },
    name: 'Setup Node 22',
  }),
  step.run('pnpm install --frozen-lockfile', { name: 'Install' }),
];

export const ci = pipeline('CI', {
  triggers: [
    triggers.pullRequest(),
    triggers.push({ branches: ['main', 'master'] }),
  ],
  permissions: { contents: 'read' },
  jobs: [
    job('typecheck', {
      runner: Runner.github('ubuntu-latest'),
      steps: [...setupNodePnpm, step.run('pnpm turbo typecheck', { name: 'Typecheck' })],
    }),
    job('test', {
      runner: Runner.github('ubuntu-latest'),
      steps: [
        ...setupNodePnpm,
        step.run('pnpm --filter @rehearse/ci test', { name: 'Test ts-ci' }),
        step.run('pnpm --filter @rehearse/git-core test', { name: 'Test git-engine' }),
      ],
    }),
  ],
});
