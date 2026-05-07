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

  it('returns null for remote refs that fail to fetch (404 / network)', () => {
    // We DO support remote reusables (v0.6.16) — but org/repo refs that 404
    // fall through both the shallow and full clone attempts and return null.
    // Planner surfaces this as "remote reusable workflow could not be fetched".
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

  // ── recursive nesting + cycle detection (v0.6.15+) ───────────────────

  it('detects cycles: workflow that calls itself throws', () => {
    // self.yml has one inner job that re-uses self.yml — a self-reference.
    makeWorkflow(
      '.github/workflows/self.yml',
      `on:
  workflow_call: {}
jobs:
  recurse:
    uses: ./.github/workflows/self.yml
`,
    );
    expect(() =>
      expandReusable('caller', { uses: './.github/workflows/self.yml' } as never, repo),
    ).toThrow(/cycle detected/i);
  });

  it('throws when nesting depth exceeds the GH Actions limit (4)', () => {
    // Chain: a → b → c → d → e (depth 5, one over the limit)
    for (const [from, to] of [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']]) {
      makeWorkflow(
        `.github/workflows/${from}.yml`,
        `on:
  workflow_call: {}
jobs:
  next:
    uses: ./.github/workflows/${to}.yml
`,
      );
    }
    makeWorkflow(
      '.github/workflows/e.yml',
      `on:
  workflow_call: {}
jobs:
  terminal:
    runs-on: ubuntu-latest
    steps: [{ run: 'echo done' }]
`,
    );
    expect(() =>
      expandReusable('caller', { uses: './.github/workflows/a.yml' } as never, repo),
    ).toThrow(/nesting depth exceeds maximum/i);
  });

  // ── outputs flow (v0.6.16) ───────────────────────────────────────────

  it('captures on.workflow_call.outputs into expansion.outputsSpec', () => {
    makeWorkflow(
      '.github/workflows/release.yml',
      `on:
  workflow_call:
    outputs:
      url:
        description: deploy URL
        value: \${{ jobs.deploy.outputs.endpoint }}
      tag:
        value: \${{ jobs.deploy.outputs.tag }}
jobs:
  deploy:
    runs-on: ubuntu-latest
    outputs:
      endpoint: \${{ steps.x.outputs.endpoint }}
      tag: \${{ steps.x.outputs.tag }}
    steps:
      - id: x
        run: 'echo'
`,
    );
    const e = expandReusable(
      'release',
      { uses: './.github/workflows/release.yml' } as never,
      repo,
    );
    expect(e).not.toBeNull();
    expect(e!.outputsSpec).toEqual({
      url: '${{ jobs.deploy.outputs.endpoint }}',
      tag: '${{ jobs.deploy.outputs.tag }}',
    });
    expect(e!.innerKeyMap).toEqual({ deploy: 'release__deploy' });
  });

  it('substitutes inputs into outputsSpec values', () => {
    makeWorkflow(
      '.github/workflows/release.yml',
      `on:
  workflow_call:
    inputs:
      base:
        type: string
    outputs:
      full_url:
        value: \${{ inputs.base }}/\${{ jobs.deploy.outputs.path }}
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps: [{ run: 'echo' }]
`,
    );
    const e = expandReusable(
      'release',
      { uses: './.github/workflows/release.yml', with: { base: 'https://prod.example' } } as never,
      repo,
    );
    expect(e!.outputsSpec.full_url).toBe('https://prod.example/${{ jobs.deploy.outputs.path }}');
  });

  it('returns empty outputsSpec when reusable declares no outputs', () => {
    makeWorkflow(
      '.github/workflows/build.yml',
      `on: { workflow_call: {} }
jobs:
  inner:
    runs-on: ubuntu-latest
    steps: [{ run: 'echo' }]
`,
    );
    const e = expandReusable(
      'caller',
      { uses: './.github/workflows/build.yml' } as never,
      repo,
    );
    expect(e!.outputsSpec).toEqual({});
  });

  it('supports nested reusable workflows up to depth 4', () => {
    // Chain: a → b → c → d (depth 4, at the limit)
    for (const [from, to] of [['a', 'b'], ['b', 'c'], ['c', 'd']]) {
      makeWorkflow(
        `.github/workflows/${from}.yml`,
        `on:
  workflow_call: {}
jobs:
  next:
    uses: ./.github/workflows/${to}.yml
`,
      );
    }
    makeWorkflow(
      '.github/workflows/d.yml',
      `on:
  workflow_call: {}
jobs:
  terminal:
    runs-on: ubuntu-latest
    steps: [{ run: 'echo done' }]
`,
    );
    const e = expandReusable('caller', { uses: './.github/workflows/a.yml' } as never, repo);
    expect(e).not.toBeNull();
    // 4-level chain: caller → next → next → next → terminal
    // Composite key reflects every hop: caller__next__next__next__terminal
    const keys = Object.keys(e!.jobs);
    expect(keys.length).toBe(1);
    expect(keys[0]).toMatch(/^caller__next__next__next__terminal$/);
  });
});
