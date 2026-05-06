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

  it('filter that matches no cells → 0 cells (caller surfaces "no jobs match")', () => {
    const jobs = plan(wf(), {
      workflowPath: '.',
      cwd: '.',
      matrixFilter: { os: 'plan9-latest' },
    });
    expect(jobs).toHaveLength(0);
  });

  it('filter on a key that does not exist on matrix → 0 cells', () => {
    const jobs = plan(wf(), {
      workflowPath: '.',
      cwd: '.',
      matrixFilter: { architecture: 'x86_64' },
    });
    expect(jobs).toHaveLength(0);
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
