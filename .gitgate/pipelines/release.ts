/**
 * npm release — fires on tags matching `v*`. Publishes the four OSS
 * packages under the `@gitgate` scope using `NPM_TOKEN` (configured as a
 * GitHub Actions secret in github.com/plsft/gitgate).
 *
 * Cut a release:
 *   pnpm --filter @gitgate/runner version 0.2.0
 *   git tag v0.2.0 && git push --tags
 */
import { Runner, job, pipeline, secrets, step, triggers } from '@gitgate/ci';

const PACKAGES = [
  '@gitgate/git-core', // no internal deps — publish first
  '@gitgate/ci',
  '@gitgate/cli', // depends on @gitgate/ci
  '@gitgate/runner', // depends on @gitgate/ci + @gitgate/git-core
] as const;

export const release = pipeline('Release', {
  triggers: [triggers.push({ tags: ['v*'] })],
  permissions: { contents: 'read', idToken: 'write' },
  jobs: [
    job('publish', {
      runner: Runner.github('ubuntu-latest'),
      steps: [
        step.checkout({ fetchDepth: 0 }),
        step.action('pnpm/action-setup@v4', { with: { version: '9.15.0' }, name: 'Setup pnpm' }),
        step.action('actions/setup-node@v4', {
          with: {
            'node-version': '22',
            cache: 'pnpm',
            'registry-url': 'https://registry.npmjs.org',
          },
          name: 'Setup Node 22',
        }),
        step.run('pnpm install --frozen-lockfile', { name: 'Install' }),
        step.run('pnpm turbo build', { name: 'Build all packages' }),
        ...PACKAGES.map((name) =>
          step.run(`pnpm --filter ${name} publish --access public --no-git-checks`, {
            name: `Publish ${name}`,
            env: { NODE_AUTH_TOKEN: secrets('NPM_TOKEN') },
          }),
        ),
      ],
    }),
  ],
});
