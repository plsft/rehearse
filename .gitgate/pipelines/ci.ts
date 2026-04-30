/**
 * Repo CI — typecheck + test the OSS packages on every PR.
 */
import { Runner, job, pipeline, step, triggers } from '@gitgate/ci';

const setupNodePnpm = [
  step.checkout({ fetchDepth: 0 }),
  step.action('pnpm/action-setup@v4', { with: { version: '9.15.0' }, name: 'Setup pnpm' }),
  step.action('actions/setup-node@v4', {
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
      runner: Runner.ubicloud('standard-4'),
      steps: [...setupNodePnpm, step.run('pnpm turbo typecheck', { name: 'Typecheck' })],
    }),
    job('test', {
      runner: Runner.ubicloud('standard-4'),
      steps: [
        ...setupNodePnpm,
        step.run('pnpm --filter @gitgate/ci test', { name: 'Test @gitgate/ci' }),
        step.run('pnpm --filter @gitgate/git-core test', { name: 'Test @gitgate/git-core' }),
      ],
    }),
    job('site', {
      runner: Runner.ubicloud('standard-2'),
      steps: [...setupNodePnpm, step.run('pnpm --filter @gitgate/site build', { name: 'Build site' })],
    }),
  ],
});
