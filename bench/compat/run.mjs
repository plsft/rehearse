#!/usr/bin/env node
/**
 * Compat scoreboard runner.
 *
 * For each fixture in fixtures.json: shallow-clone, run `rh`, score based
 * on the fixture's `expected` outcome. Writes a results JSON + an exit
 * code that's 0 only when all fixtures meet expectation.
 *
 * Used by:
 *   - `.github/workflows/compat.yml` — runs nightly + on PRs touching cli/
 *   - Manual: `node bench/compat/run.mjs [--cli @rehearse/cli@x.y.z]`
 *
 * The honest framing: this is the only thing standing between us and
 * silent compat drift from GH Actions semantics. Unit tests can't catch
 * "this real-world workflow that worked yesterday now hangs", only
 * running real workflows can.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i > -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const fixturesPath = resolve(here, arg('fixtures', 'fixtures.json'));
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf-8')).fixtures;

const cliPkg = arg('cli', '@rehearse/cli@latest');
const root = arg('workdir', join(tmpdir(), 'rehearse-compat'));
const verbose = process.argv.includes('--verbose');
const keepClones = process.argv.includes('--keep-clones');

mkdirSync(root, { recursive: true });

console.log(`[compat] cli=${cliPkg}`);
console.log(`[compat] workdir=${root}`);
console.log(`[compat] fixtures=${fixtures.length}`);
console.log('');

const results = [];

for (const fx of fixtures) {
  const t0 = Date.now();
  const dir = join(root, fx.name);
  let log = '';
  let pass = false;
  let reason = '';

  try {
    // 1. Materialize the workflow source. Two modes:
    //    - `repo`: clone an OSS project (real-world compat target)
    //    - `local_workflow`: copy a synthetic workflow we control into
    //      a fresh git repo. Use this when the assertion needs the
    //      workflow shape pinned (e.g. testing --input substitution
    //      requires the workflow to actually echo the input).
    if (!existsSync(dir)) {
      if (fx.local_workflow) {
        const src = resolve(here, fx.local_workflow);
        if (!existsSync(src)) {
          throw new Error(`local_workflow not found: ${src}`);
        }
        const wfDest = join(dir, '.github', 'workflows', 'compat-fixture.yml');
        mkdirSync(dirname(wfDest), { recursive: true });
        execSync(`git init -q "${dir}"`);
        execSync(`git -C "${dir}" config user.email t@compat.local && git -C "${dir}" config user.name compat`);
        const { copyFileSync } = await import('node:fs');
        copyFileSync(src, wfDest);
        execSync(`git -C "${dir}" add -A && git -C "${dir}" commit -q -m fixture`);
      } else {
        const r = spawnSync(
          'git',
          ['clone', '--depth=50', '--branch', fx.ref, fx.repo, dir],
          { encoding: 'utf-8' },
        );
        if (r.status !== 0) {
          // SHA refs don't work with --branch; full clone + checkout.
          spawnSync('git', ['clone', fx.repo, dir], { encoding: 'utf-8' });
          spawnSync('git', ['checkout', fx.ref], { cwd: dir, encoding: 'utf-8' });
        }
      }
    }

    // 2. Build the rh invocation.
    const workflowPath = fx.local_workflow
      ? '.github/workflows/compat-fixture.yml'
      : fx.workflow;
    const args = ['-y', cliPkg, 'run', workflowPath];
    if (fx.matrix_filter) args.push('--matrix', fx.matrix_filter);
    if (fx.inputs) {
      for (const [k, v] of Object.entries(fx.inputs)) args.push('--input', `${k}=${v}`);
    }

    // 3. Run.
    const r = spawnSync('npx', args, {
      cwd: dir,
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
      shell: process.platform === 'win32', // npx is a .cmd on Windows
    });
    log = (r.stdout ?? '') + (r.stderr ?? '');

    // 4. Score against fx.expected.
    switch (fx.expected) {
      case 'pass':
        pass = r.status === 0;
        reason = pass ? 'exit=0' : `exit=${r.status}`;
        break;
      case 'no-eloop':
        // Workflow may legitimately fail; the criterion is "no infinite
        // recursion in the source tree". v0.6.17 fix.
        pass = !/\bELOOP\b/i.test(log);
        reason = pass
          ? 'no ELOOP in log (worktree fix held)'
          : 'ELOOP found — worktree symlink regression';
        break;
      case 'input-substituted':
        // workflow_dispatch + --input flow target. The synthetic fixture
        // (bench/compat/synthetic/workflow-dispatch-input.yml) uses
        // `if [ "${{ inputs.sentinel }}" = "COMPAT_OK_42" ]; then …;
        // else exit 1; fi` so a bad substitution forces a non-zero exit.
        // We don't grep for stdout markers because rh's default mode
        // suppresses successful steps' output; the workflow's own exit
        // code is the source of truth.
        pass = r.status === 0;
        reason = pass
          ? 'input substituted (sentinel-test step exited 0)'
          : `exit=${r.status} (sentinel mismatch — input parsing/substitution broken)`;
        break;
      default:
        pass = false;
        reason = `unknown expected: ${fx.expected}`;
    }
  } catch (err) {
    pass = false;
    reason = `runner error: ${err.message}`;
  }

  const durationMs = Date.now() - t0;
  results.push({ name: fx.name, expected: fx.expected, pass, reason, durationMs });

  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`  ${mark.padEnd(5)} ${fx.name.padEnd(30)} ${(durationMs + 'ms').padStart(8)}  ${reason}`);
  if (verbose && !pass) {
    console.log('    --- log tail ---');
    console.log(log.split('\n').slice(-20).map((l) => '    ' + l).join('\n'));
  }
}

// Cleanup unless --keep-clones was passed.
if (!keepClones) {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* */ }
}

const passed = results.filter((r) => r.pass).length;
const total = results.length;
const score = total > 0 ? passed / total : 0;

console.log('');
console.log(`[compat] score: ${passed}/${total} (${(score * 100).toFixed(1)}%)`);

const outPath = resolve(here, 'results.json');
writeFileSync(
  outPath,
  JSON.stringify(
    {
      cli: cliPkg,
      ran_at: new Date().toISOString(),
      passed,
      total,
      score,
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(`[compat] results written to ${outPath}`);

// Exit non-zero if ANY fixture failed. CI uses this to gate PRs.
process.exit(passed === total ? 0 : 1);
