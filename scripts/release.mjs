#!/usr/bin/env node
/**
 * release.mjs — bump all four @rehearse/* packages in lockstep and tag.
 *
 * Usage:
 *   node scripts/release.mjs <bump>
 *
 *   <bump> can be:
 *     patch                 0.1.0   → 0.1.1
 *     minor                 0.1.0   → 0.2.0
 *     major                 0.1.0   → 1.0.0
 *     prerelease            0.1.0   → 0.1.1-next.0
 *                           0.1.1-next.0 → 0.1.1-next.1
 *     prerelease:rc         0.1.0   → 0.1.1-rc.0
 *     prerelease:beta       0.1.0   → 0.1.1-beta.0
 *     <explicit>            anything else, e.g. 0.2.0-rc.1
 *
 *   --no-tag    don't `git tag`
 *   --no-push   don't `git push --tags`
 *   --no-commit don't `git commit`
 *   --dry       show what would happen, write nothing
 *
 * Workflow:
 *   1. Bump versions in all four package.json files.
 *   2. git add the package.json changes.
 *   3. git commit -m "release: <new-version>".
 *   4. git tag v<new-version>.
 *   5. git push && git push --tags.
 *
 * The release.yml workflow on github.com/plsft/rehearse fires on the tag
 * push, builds all packages, publishes them with the right npm dist-tag
 * (`latest` for stable, `next`/`rc`/`beta` for prereleases), and creates
 * a GitHub Release with auto-generated notes.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Public packages bumped + published in lockstep. As of v0.6.0:
//   - @rehearse/cli — single binary `rh` (was @rehearse/cli + @rehearse/cli)
//   - @rehearse/ci  — TS→YAML SDK
// Removed from public release: @rehearse/cli (folded into cli),
// @rehearse/git-core (kept private; consumers use the cli internals).
const PACKAGES = [
  'ts-ci/package.json',
  'cli/package.json',
];

function readPkg(rel) {
  return JSON.parse(readFileSync(resolve(repoRoot, rel), 'utf-8'));
}
function writePkg(rel, pkg) {
  writeFileSync(resolve(repoRoot, rel), JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(v);
  if (!m) throw new Error(`unrecognised version: ${v}`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ?? null,
    preNum: m[5] !== undefined ? Number(m[5]) : null,
  };
}

function formatSemver({ major, minor, patch, pre, preNum }) {
  const base = `${major}.${minor}.${patch}`;
  if (pre === null) return base;
  return `${base}-${pre}.${preNum}`;
}

function bumpVersion(current, instruction) {
  // Explicit version: anything that looks like semver.
  if (/^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/.test(instruction)) {
    return instruction;
  }
  const cur = parseSemver(current);
  if (instruction === 'patch') {
    return formatSemver({ ...cur, patch: cur.patch + 1, pre: null, preNum: null });
  }
  if (instruction === 'minor') {
    return formatSemver({ ...cur, minor: cur.minor + 1, patch: 0, pre: null, preNum: null });
  }
  if (instruction === 'major') {
    return formatSemver({
      ...cur,
      major: cur.major + 1,
      minor: 0,
      patch: 0,
      pre: null,
      preNum: null,
    });
  }
  if (instruction === 'prerelease' || instruction.startsWith('prerelease:')) {
    const channel = instruction.includes(':') ? instruction.split(':')[1] : 'next';
    if (cur.pre === channel) {
      // e.g. 0.1.1-next.0 → 0.1.1-next.1 (same base, increment preNum)
      return formatSemver({ ...cur, preNum: cur.preNum + 1 });
    }
    // First prerelease on a new base: bump patch and start at .0
    return formatSemver({
      ...cur,
      patch: cur.patch + 1,
      pre: channel,
      preNum: 0,
    });
  }
  throw new Error(`unrecognised bump: ${instruction}`);
}

function sh(cmd, opts = {}) {
  if (opts.dry) {
    console.log(`  [dry] ${cmd}`);
    return '';
  }
  return execSync(cmd, { cwd: repoRoot, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function shInherit(cmd) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit' });
}

function main() {
  const args = process.argv.slice(2);
  const flags = {
    dry: args.includes('--dry'),
    tag: !args.includes('--no-tag'),
    push: !args.includes('--no-push'),
    commit: !args.includes('--no-commit'),
  };
  const positional = args.filter((a) => !a.startsWith('--'));
  const bump = positional[0];
  if (!bump) {
    console.error(
      'usage: node scripts/release.mjs <patch|minor|major|prerelease[:channel]|x.y.z[-channel.n]> [--dry] [--no-tag] [--no-push] [--no-commit]',
    );
    process.exit(2);
  }

  // Working tree clean check
  if (!flags.dry && sh('git status --porcelain').length > 0) {
    console.error('✗ working tree dirty — commit or stash first');
    process.exit(1);
  }

  // Read current versions; require all four to agree
  const pkgs = PACKAGES.map((rel) => ({ rel, pkg: readPkg(rel) }));
  const versions = new Set(pkgs.map((p) => p.pkg.version));
  if (versions.size !== 1) {
    console.error(`✗ packages drift in version: ${[...versions].join(', ')}`);
    process.exit(1);
  }
  const current = pkgs[0].pkg.version;
  const next = bumpVersion(current, bump);

  console.log(`\n  ${current}  →  ${next}\n`);

  // Bump
  for (const { rel, pkg } of pkgs) {
    pkg.version = next;
    if (flags.dry) {
      console.log(`  [dry] write ${rel} version=${next}`);
    } else {
      writePkg(rel, pkg);
      console.log(`  ✓ ${rel}`);
    }
  }

  if (flags.commit) {
    sh('git add ' + PACKAGES.join(' '), { dry: flags.dry });
    sh(`git commit -m "release: v${next}"`, { dry: flags.dry });
  }
  if (flags.tag) {
    const tag = `v${next}`;
    sh(`git tag ${tag} -m "v${next}"`, { dry: flags.dry });
    if (flags.push && !flags.dry) {
      shInherit('git push');
      shInherit(`git push origin ${tag}`);
    } else if (flags.push) {
      console.log(`  [dry] git push && git push origin ${tag}`);
    }
  }

  console.log(`\n✓ released v${next}`);
  if (flags.push && flags.tag && !flags.dry) {
    console.log(`  watch: gh run watch --exit-status --workflow=release.yml`);
  }
}

main();
