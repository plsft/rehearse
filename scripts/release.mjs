#!/usr/bin/env node
/**
 * Retired. Releases are cut by release-please: merge the release PR.
 *
 * A hand-cut tag doesn't update .release-please-manifest.json, so
 * release-please would later propose the same version and fail on the
 * existing tag. Kept so `pnpm release` explains itself instead of vanishing.
 */
console.error(
  'release.mjs is retired: merge the release-please PR, or force a version with a "Release-As: x.y.z" commit footer',
);
process.exit(1);
