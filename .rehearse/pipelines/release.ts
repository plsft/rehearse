/**
 * Release — release-please maintains a release PR from conventional commits
 * on main. Merging that PR bumps cli + ts-ci in lockstep, tags vX.Y.Z, creates
 * the GitHub Release, and (in this same run) publishes both packages to npm.
 *
 * npm auth is trusted publishing (OIDC): no token. Each package has a trusted
 * publisher on npmjs.com (plsft/rehearse, workflow release.yml), the publish job
 * has `id-token: write`, and `npm publish` exchanges the OIDC token itself and
 * attaches provenance. Issue #11.
 *
 * Publishing must live in this workflow: a tag created with GITHUB_TOKEN does
 * not trigger other workflows, so a separate `on: push: tags` workflow would
 * never fire.
 *
 * Force a version with a `Release-As: x.y.z` footer on a commit to main.
 * Config: release-please-config.json, .release-please-manifest.json.
 */
import { Runner, job, pipeline, step, triggers } from '@rehearse/ci';

// Publish order: leaves first, dependents later. @rehearse/cli depends on
// @rehearse/ci. release-please bumps both versions in lockstep.
const PACKAGES = [
  { name: '@rehearse/ci', dir: 'ts-ci' }, // no internal deps — publish first
  { name: '@rehearse/cli', dir: 'cli' }, // depends on @rehearse/ci
] as const;

// `pnpm pack` rewrites workspace:* deps to real versions (`pnpm publish` does
// too, but only `npm publish` does the OIDC exchange), then `npm publish`
// uploads that tarball. `pnpm pack` has no --filter on pnpm 9, so run it in the
// package dir. Skips a version that is already on npm so "Re-run failed jobs"
// is safe after a partial publish.
const publishScript = `set -euo pipefail
: "\${PKG_NAME:?}" "\${PKG_DIR:?}"
VERSION=$(node -p "require('./$PKG_DIR/package.json').version")
if npm view "$PKG_NAME@$VERSION" version >/dev/null 2>&1; then
  echo "$PKG_NAME@$VERSION is already on npm, skipping"
  exit 0
fi
mkdir -p "$RUNNER_TEMP/out"
TARBALL=$(cd "$PKG_DIR" && pnpm pack --pack-destination "$RUNNER_TEMP/out" | tail -n 1)
test -f "$TARBALL"
npm publish "$TARBALL" --access public --tag latest`;

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
      permissions: { contents: 'read', idToken: 'write' },
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
        // Node 22 ships npm 10; trusted publishing needs npm >= 11.5.1.
        step.run('npm install -g npm@11 && npm --version', { name: 'Upgrade npm' }),
        step.run('pnpm install --frozen-lockfile', { name: 'Install' }),
        step.run('pnpm turbo build', { name: 'Build all packages' }),
        ...PACKAGES.map(({ name, dir }) =>
          step.run(publishScript, {
            name: `Publish ${name}`,
            env: { PKG_NAME: name, PKG_DIR: dir },
          }),
        ),
      ],
    }),
  ],
});
