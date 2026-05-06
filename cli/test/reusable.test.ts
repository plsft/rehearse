import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandReusable, isReusableWorkflowUse } from '../src/runner/reusable.js';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'reusable-'));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function makeWorkflow(rel: string, yml: string): void {
  const path = join(repo, rel);
  mkdirSync(join(repo, '.github', 'workflows'), { recursive: true });
  writeFileSync(path, yml);
}

describe('isReusableWorkflowUse', () => {
  it('matches local workflow paths', () => {
    expect(isReusableWorkflowUse('./.github/workflows/build.yml')).toBe(true);
    expect(isReusableWorkflowUse('./.github/workflows/deploy.yaml')).toBe(true);
  });
  it('matches remote workflow refs', () => {
    expect(isReusableWorkflowUse('octo/repo/.github/workflows/build.yml@v1')).toBe(true);
  });
  it('rejects step-level uses', () => {
    expect(isReusableWorkflowUse('actions/checkout@v4')).toBe(false);
    expect(isReusableWorkflowUse('./.github/actions/foo')).toBe(false);
    expect(isReusableWorkflowUse(undefined)).toBe(false);
  });
});

describe('expandReusable', () => {
  it('substitutes inputs from caller with: into inner steps', () => {
    makeWorkflow(
      '.github/workflows/build.yml',
      `name: build
on:
  workflow_call:
    inputs:
      env:
        type: string
        default: 'staging'
jobs:
  inner:
    runs-on: ubuntu-latest
    steps:
      - run: 'echo deploying to \${{ inputs.env }}'
`,
    );
    const expansion = expandReusable(
      'deploy',
      { uses: './.github/workflows/build.yml', with: { env: 'production' } } as never,
      repo,
    );
    expect(expansion).not.toBeNull();
    const job = expansion!.jobs['deploy__inner']!;
    expect(job).toBeDefined();
    expect(job.steps[0]!.run).toBe('echo deploying to production');
  });

  it('falls back to default inputs when caller omits with:', () => {
    makeWorkflow(
      '.github/workflows/build.yml',
      `on:
  workflow_call:
    inputs:
      env:
        type: string
        default: 'staging'
jobs:
  inner:
    runs-on: ubuntu-latest
    steps:
      - run: 'echo \${{ inputs.env }}'
`,
    );
    const e = expandReusable('d', { uses: './.github/workflows/build.yml' } as never, repo);
    expect(e!.jobs['d__inner']!.steps[0]!.run).toBe('echo staging');
  });

  it("forwards caller secrets via 'inherit'", () => {
    makeWorkflow(
      '.github/workflows/use.yml',
      `on:
  workflow_call: {}
jobs:
  inner:
    runs-on: ubuntu-latest
    steps:
      - run: 'echo \${{ secrets.MY_TOKEN }}'
`,
    );
    const e = expandReusable(
      'caller',
      { uses: './.github/workflows/use.yml', secrets: 'inherit' } as never,
      repo,
      { MY_TOKEN: 's3cret' },
    );
    expect(e!.jobs['caller__inner']!.steps[0]!.run).toBe('echo s3cret');
  });

  it('keeps explicit secret map (no inherit)', () => {
    makeWorkflow(
      '.github/workflows/use.yml',
      `on:
  workflow_call: {}
jobs:
  inner:
    runs-on: ubuntu-latest
    steps:
      - run: 'echo \${{ secrets.API_TOKEN }}'
`,
    );
    const e = expandReusable(
      'caller',
      { uses: './.github/workflows/use.yml', secrets: { API_TOKEN: 'forwarded' } } as never,
      repo,
      { OTHER: 'leaked' },
    );
    expect(e!.jobs['caller__inner']!.steps[0]!.run).toBe('echo forwarded');
  });

  it('returns null for missing workflow files', () => {
    const e = expandReusable('caller', { uses: './.github/workflows/missing.yml' } as never, repo);
    expect(e).toBeNull();
  });

  it('returns null for remote refs (not yet supported)', () => {
    const e = expandReusable('caller', { uses: 'octo/repo/.github/workflows/build.yml@v1' } as never, repo);
    expect(e).toBeNull();
  });

  it('expands multiple inner jobs and prefixes their keys', () => {
    makeWorkflow(
      '.github/workflows/multi.yml',
      `on:
  workflow_call: {}
jobs:
  alpha:
    runs-on: ubuntu-latest
    steps: [{ run: 'echo a' }]
  beta:
    runs-on: ubuntu-latest
    steps: [{ run: 'echo b' }]
`,
    );
    const e = expandReusable('caller', { uses: './.github/workflows/multi.yml' } as never, repo);
    expect(Object.keys(e!.jobs)).toEqual(['caller__alpha', 'caller__beta']);
  });
});
