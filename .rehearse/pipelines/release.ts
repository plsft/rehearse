/**
 * npm release — fires on any `v*.*.*` tag.
 *
 * Routing:
 *   v0.2.0           → npm dist-tag `latest`, GitHub Release marked stable
 *   v0.2.0-next.0    → npm dist-tag `next`,   GitHub Release marked prerelease
 *   v0.2.0-rc.1      → npm dist-tag `rc`,     GitHub Release marked prerelease
 *   v0.2.0-beta.3    → npm dist-tag `beta`,   GitHub Release marked prerelease
 *
 * The npm dist-tag is derived from the part of the version after `-`, before
 * the dot. Anything matching `v<int>.<int>.<int>` (no hyphen) is treated
 * as stable and gets `latest`.
 *
 * Cut a release:
 *   pnpm release patch          # 0.1.0 → 0.1.1
 *   pnpm release minor          # 0.1.0 → 0.2.0
 *   pnpm release prerelease     # 0.1.0 → 0.2.0-next.0
 *   pnpm release 0.2.0-rc.1     # explicit version
 */
import { Runner, github, job, pipeline, secrets, step, triggers } from '@rehearse/ci';

// Publish order: leaves first, dependents later. v0.6.0 folded the
// runner + git-core packages into @rehearse/cli, so the active publish
// list is just two packages now. release.mjs bumps both in lockstep
// before tagging.
//
// Pre-fix this list had @rehearse/cli TWICE (the second slot was a
// stale rename of the now-folded @rehearse/runner). Every release tag's
// CI run failed on the duplicate invocation with npm 403 "cannot
// publish over existing version", which also skipped the GitHub Release
// creation step at the bottom. Caught by inspecting the v0.6.18 run.
const PACKAGES = [
  '@rehearse/ci',  // no internal deps — publish first
  '@rehearse/cli', // depends on @rehearse/ci
] as const;

// Detect prerelease vs stable from the tag and emit NPM_TAG + PRERELEASE
// to $GITHUB_ENV so subsequent steps can use $NPM_TAG / $PRERELEASE directly.
const detectScript = `set -euo pipefail
TAG="${github('ref_name')}"
VERSION="\${TAG#v}"
if [[ "$VERSION" == *-* ]]; then
  SUFFIX="\${VERSION#*-}"
  NPM_TAG="\${SUFFIX%%.*}"
  echo "Tag $TAG → prerelease, npm dist-tag '$NPM_TAG'"
  echo "NPM_TAG=$NPM_TAG"   >> "$GITHUB_ENV"
  echo "PRERELEASE=true"    >> "$GITHUB_ENV"
else
  echo "Tag $TAG → stable, npm dist-tag 'latest'"
  echo "NPM_TAG=latest"     >> "$GITHUB_ENV"
  echo "PRERELEASE=false"   >> "$GITHUB_ENV"
fi`;

const releaseScript = `set -euo pipefail
ARGS=(--generate-notes --verify-tag --title "${github('ref_name')}")
if [ "$PRERELEASE" = "true" ]; then
  ARGS+=(--prerelease)
else
  ARGS+=(--latest)
fi
gh release create "${github('ref_name')}" "\${ARGS[@]}"`;

export const release = pipeline('Release', {
  // Match any semver-shaped tag — stable and prerelease both go through this.
  triggers: [triggers.push({ tags: ['v*.*.*'] })],
  permissions: { contents: 'write', idToken: 'write' },
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
        step.run(detectScript, { name: 'Detect release channel' }),
        step.run('pnpm install --frozen-lockfile', { name: 'Install' }),
        step.run('pnpm turbo build', { name: 'Build all packages' }),
        ...PACKAGES.map((name) =>
          step.run(
            `pnpm --filter ${name} publish --tag "$NPM_TAG" --access public --no-git-checks`,
            {
              name: `Publish ${name}`,
              env: { NODE_AUTH_TOKEN: secrets('NPM_TOKEN') },
            },
          ),
        ),
        step.run(releaseScript, {
          name: 'Create GitHub Release with auto-generated notes',
          env: { GH_TOKEN: secrets('GITHUB_TOKEN') },
        }),
      ],
    }),
  ],
});
