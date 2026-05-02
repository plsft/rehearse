import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compat } from '../src/compat.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'compat-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function workflow(yml: string): string {
  const p = join(dir, 'wf.yml');
  writeFileSync(p, yml);
  return p;
}

describe('compat', () => {
  it('classifies host-equivalent uses as noop', () => {
    const r = compat(workflow(`
name: ci
on: workflow_dispatch
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm test
`));
    expect(r.byClass['uses-noop']).toBe(2);
    expect(r.byClass.run).toBe(1);
    expect(r.byClass['uses-unsupported']).toBe(0);
    expect(r.coverage).toBe(100);
  });

  it('counts unsupported actions correctly', () => {
    const r = compat(workflow(`
name: ci
on: workflow_dispatch
jobs:
  cov:
    runs-on: ubuntu-latest
    steps:
      - uses: codecov/codecov-action@v5
      - uses: actions/github-script@v7
`));
    expect(r.byClass['uses-unsupported']).toBe(2);
    expect(r.coverage).toBe(0);
  });

  it('flags local composite actions distinctly', () => {
    const r = compat(workflow(`
name: ci
on: workflow_dispatch
jobs:
  m:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/perf
`));
    expect(r.byClass['uses-local']).toBe(1);
  });

  it('reports matrix and services flags per job', () => {
    const r = compat(workflow(`
name: ci
on: workflow_dispatch
jobs:
  m:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: ['18', '20']
    services:
      pg:
        image: postgres:16
    steps:
      - run: echo hi
`));
    expect(r.jobs[0]!.hasMatrix).toBe(true);
    expect(r.jobs[0]!.hasServices).toBe(true);
  });

  it('coverage reflects supported steps proportion', () => {
    const r = compat(workflow(`
name: ci
on: workflow_dispatch
jobs:
  m:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-artifact@v4
      - uses: codecov/codecov-action@v5
      - run: echo hi
`));
    // 4 steps: checkout (noop), upload-artifact (supported), codecov (unsupported), run (run)
    // Supported = noop + supported + run = 3/4 = 75%
    expect(r.coverage).toBe(75);
  });
});
