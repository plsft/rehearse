/**
 * PR title lint — squash-merge makes the PR title the commit subject on main,
 * and release-please reads that subject to decide the next version.
 *
 * Separate from ci.ts so editing a title doesn't re-run typecheck + tests.
 */
import { Runner, job, pipeline, step, triggers } from '@rehearse/ci';

export const prTitle = pipeline('PR Title', {
  // A types list replaces GitHub's defaults, so spell all four out.
  triggers: [triggers.pullRequest({ types: ['opened', 'edited', 'synchronize', 'reopened'] })],
  permissions: { contents: 'read' },
  jobs: [
    job('lint-title', {
      runner: Runner.github('ubuntu-latest'),
      steps: [
        step.action('actions/checkout@v7', { name: 'Checkout' }),
        step.action('pnpm/action-setup@v6', { with: { version: '9.15.0' }, name: 'Setup pnpm' }),
        step.action('actions/setup-node@v7', {
          with: { 'node-version': '22', cache: 'pnpm' },
          name: 'Setup Node 22',
        }),
        step.run('pnpm install --frozen-lockfile', { name: 'Install' }),
        // Title goes through env, never inlined into the script (injection).
        step.run('echo "$PR_TITLE" | pnpm exec commitlint', {
          name: 'Lint PR title',
          env: { PR_TITLE: '${{ github.event.pull_request.title }}' },
        }),
      ],
    }),
  ],
});
