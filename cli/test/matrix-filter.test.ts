/**
 * v0.6.2: --matrix filter for narrowing parallel matrix runs to specific cells.
 *
 * Use case: developer on Linux iterating on a 9-cell `[os] × [node-version]`
 * matrix wants to run ONLY the `os=ubuntu-latest` cells (the macOS/Windows
 * cells get auto-routed to container backend on a Linux host, which isn't
 * faithful for platform-specific code anyway). `rh run ... --matrix os=ubuntu-latest`
 * prunes those cells before scheduling.
 */
import { describe, expect, it } from 'vitest';
import { plan } from '../src/runner/planner.js';
import type { ParsedWorkflow } from '@rehearse/ci';

const wf = (): ParsedWorkflow => ({
  name: 'ci',
  on: 'push',
  jobs: {
    'test-unit': {
      'runs-on': '${{ matrix.os }}',
      strategy: {
        matrix: {
          'node-version': [20, 22, 24],
          os: ['ubuntu-latest', 'macos-latest', 'windows-latest'],
        },
      },
      steps: [{ run: 'echo hi' }],
    },
  },
}) as unknown as ParsedWorkflow;

describe('plan() — matrix filter', () => {
  it('no filter → all 9 cells', () => {
    const jobs = plan(wf(), { workflowPath: '.', cwd: '.' });
    expect(jobs).toHaveLength(9);
  });

  it('filter to single OS → 3 cells', () => {
    const jobs = plan(wf(), {
      workflowPath: '.',
      cwd: '.',
      matrixFilter: { os: 'ubuntu-latest' },
    });
    expect(jobs).toHaveLength(3);
    for (const j of jobs) expect(j.matrixCell?.os).toBe('ubuntu-latest');
  });

  it('filter to OS + node-version → 1 cell', () => {
    const jobs = plan(wf(), {
      workflowPath: '.',
      cwd: '.',
      matrixFilter: { os: 'ubuntu-latest', 'node-version': '20' },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.matrixCell).toMatchObject({ os: 'ubuntu-latest', 'node-version': 20 });
  });

  it('filter that mismatches every cell value → 0 cells (caller surfaces "no jobs match")', () => {
    const jobs = plan(wf(), {
      workflowPath: '.',
      cwd: '.',
      matrixFilter: { os: 'plan9-latest' },
    });
    expect(jobs).toHaveLength(0);
  });

  it('filter on a key the matrix DOES NOT have → all cells pass (non-strict)', () => {
    // Pre-v0.6.12 was strict: missing key → 0 cells. Now we treat the
    // constraint as N/A and let the cells through. Without this, a job
    // without `architecture` in its matrix gets filtered out by an
    // `--matrix architecture=x86_64` flag that wasn't meant to apply
    // to it. Reported by user testing honojs/hono.
    const jobs = plan(wf(), {
      workflowPath: '.',
      cwd: '.',
      matrixFilter: { architecture: 'x86_64' },
    });
    expect(jobs).toHaveLength(9);
  });

  // ── --collapse-matrix (noMatrix flag) ───────────────────────────────

  it('--collapse-matrix collapses 9 cells to 1 (first-of-each-variable)', () => {
    const jobs = plan(wf(), {
      workflowPath: '.',
      cwd: '.',
      noMatrix: true,
    });
    expect(jobs).toHaveLength(1);
    // First values from the matrix definitions
    expect(jobs[0]!.matrixCell).toMatchObject({ 'node-version': 20, os: 'ubuntu-latest' });
  });

  it('--collapse-matrix is a no-op for non-matrix jobs', () => {
    const wf2: ParsedWorkflow = {
      name: 'ci',
      on: 'push',
      jobs: { build: { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo' }] } },
    } as unknown as ParsedWorkflow;
    const jobs = plan(wf2, { workflowPath: '.', cwd: '.', noMatrix: true });
    expect(jobs).toHaveLength(1);
  });

  it('--collapse-matrix combines with --matrix filter (collapse runs first)', () => {
    // After collapse there's 1 cell with first-values; the matrix filter
    // then has to match those first-values to keep the cell.
    const jobs = plan(wf(), {
      workflowPath: '.',
      cwd: '.',
      noMatrix: true,
      matrixFilter: { os: 'ubuntu-latest' }, // matches the first-value
    });
    expect(jobs).toHaveLength(1);
  });

  it('non-matrix job + matrix filter → job runs (non-strict)', () => {
    // Mirrors the hono/main case: job with NO strategy.matrix block,
    // user passes --matrix os=ubuntu-latest. Pre-fix, this returned 0
    // cells. Now the job runs unaffected.
    const wf2: ParsedWorkflow = {
      name: 'ci',
      on: 'push',
      jobs: {
        main: { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo hi' }] },
      },
    } as unknown as ParsedWorkflow;
    const jobs = plan(wf2, {
      workflowPath: '.',
      cwd: '.',
      matrixFilter: { os: 'ubuntu-latest' },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.jobKey).toBe('main');
  });

  it('matrix-os runs-on substituted per cell', () => {
    const jobs = plan(wf(), {
      workflowPath: '.',
      cwd: '.',
      matrixFilter: { os: 'ubuntu-latest' },
    });
    for (const j of jobs) expect(j.runsOn).toBe('ubuntu-latest');
  });

  it('jobFilter + matrixFilter combine — only test-unit ubuntu cells', () => {
    const wf2 = wf();
    (wf2.jobs as Record<string, unknown>)['lint'] = {
      'runs-on': 'ubuntu-latest',
      steps: [{ run: 'echo lint' }],
    };
    const jobs = plan(wf2, {
      workflowPath: '.',
      cwd: '.',
      jobFilter: 'test-unit',
      matrixFilter: { os: 'ubuntu-latest' },
    });
    expect(jobs).toHaveLength(3);
    for (const j of jobs) expect(j.jobKey).toBe('test-unit');
  });
});
