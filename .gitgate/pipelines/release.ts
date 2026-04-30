/**
 * npm release — fired on tags matching `v*`. Publishes the three OSS packages
 * (@gitgate/ci, @gitgate/git-core, gg) using NPM_TOKEN. Uses the tag itself as
 * the version source — verify against package.json before tagging.
 *
 * To cut a release:
 *   pnpm --filter @gitgate/ci version 0.2.0
 *   git tag v0.2.0 && git push --tags
 */
import { Runner, job, pipeline, secrets, step, triggers } from '@gitgate/ci';

export const release = pipeline('Release', {
  triggers: [triggers.push({ tags: ['v*'] })],
  permissions: { contents: 'read', idToken: 'write' },
  jobs: [
    job('publish', {
      runner: Runner.ubicloud('standard-2'),
      steps: [
        step.checkout({ fetchDepth: 0 }),
        step.action('pnpm/action-setup@v4', { with: { version: '9.15.0' }, name: 'Setup pnpm' }),
        step.action('actions/setup-node@v4', {
          with: { 'node-version': '22', cache: 'pnpm', 'registry-url': 'https://registry.npmjs.org' },
          name: 'Setup Node 22',
        }),
        step.run('pnpm install --frozen-lockfile', { name: 'Install' }),
        step.run('pnpm --filter @gitgate/git-core build', { name: 'Build @gitgate/git-core' }),
        step.run('pnpm --filter @gitgate/ci build', { name: 'Build @gitgate/ci' }),
        step.run('pnpm --filter gg build', { name: 'Build gg' }),
        step.run(
          'pnpm --filter @gitgate/git-core publish --access public --no-git-checks',
          {
            name: 'Publish @gitgate/git-core',
            env: { NODE_AUTH_TOKEN: secrets('NPM_TOKEN') },
          },
        ),
        step.run('pnpm --filter @gitgate/ci publish --access public --no-git-checks', {
          name: 'Publish @gitgate/ci',
          env: { NODE_AUTH_TOKEN: secrets('NPM_TOKEN') },
        }),
        step.run('pnpm --filter gg publish --access public --no-git-checks', {
          name: 'Publish gg',
          env: { NODE_AUTH_TOKEN: secrets('NPM_TOKEN') },
        }),
      ],
    }),
  ],
});
