/**
 * Release — release-please maintains a release PR from conventional commits
 * on main. Merging that PR bumps cli + ts-ci in lockstep, tags vX.Y.Z, creates
 * the GitHub Release, and (in this same run) publishes both packages to npm.
 *
 * Publishing must live in this workflow: a tag created with GITHUB_TOKEN does
 * not trigger other workflows, so a separate `on: push: tags` workflow would
 * never fire.
 *
 * Force a version with a `Release-As: x.y.z` footer on a commit to main.
 * Config: release-please-config.json, .release-please-manifest.json.
 */
import { Runner, job, pipeline, secrets, step, triggers } from '@rehearse/ci';

// Publish order: leaves first, dependents later. @rehearse/cli depends on
// @rehearse/ci. release-please bumps both versions in lockstep.
const PACKAGES = [
  '@rehearse/ci',  // no internal deps — publish first
  '@rehearse/cli', // depends on @rehearse/ci
] as const;

export const release = pipeline('Release', {
  triggers: [triggers.push({ branches: ['main'] })],
  permissions: { contents: 'read' },
  jobs: [
    job('release-please', {
      runner: Runner.github('ubuntu-latest'),
      permissions: { contents: 'write', pullRequests: 'write' },
      outputs: {
        release_created: '${{ steps.rp.outputs.release_created }}',
        tag_name: '${{ steps.rp.outputs.tag_name }}',
      },
      steps: [
        step.action('googleapis/release-please-action@v5', { id: 'rp', name: 'Run release-please' }),
      ],
    }),
    job('publish', {
      runner: Runner.github('ubuntu-latest'),
      needs: ['release-please'],
      condition: "needs.release-please.outputs.release_created == 'true'",
      permissions: { contents: 'read' },
      steps: [
        step.action('actions/checkout@v7', { name: 'Checkout', with: { 'fetch-depth': 0 } }),
        step.action('pnpm/action-setup@v6', { with: { version: '9.15.0' }, name: 'Setup pnpm' }),
        step.action('actions/setup-node@v7', {
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
          step.run(`pnpm --filter ${name} publish --tag latest --access public --no-git-checks`, {
            name: `Publish ${name}`,
            env: { NODE_AUTH_TOKEN: secrets('NPM_TOKEN') },
          }),
        ),
      ],
    }),
  ],
});
