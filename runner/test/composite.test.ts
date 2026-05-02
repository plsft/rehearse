import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandComposite, isComposite, resolveAction } from '../src/composite.js';
import type { ExpressionContext, PlannedStep } from '../src/types.js';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'runner-composite-test-'));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function ctx(): ExpressionContext {
  return {
    env: {}, secrets: {}, vars: {}, github: {}, needs: {}, steps: {},
    job: { status: 'success' },
    runner: { os: 'Linux', arch: 'X64', temp: '/tmp' },
    inputs: {},
  };
}

function makeAction(yml: string): void {
  mkdirSync(join(repo, '.github', 'actions', 'mine'), { recursive: true });
  writeFileSync(join(repo, '.github', 'actions', 'mine', 'action.yml'), yml);
}

describe('resolveAction', () => {
  it('reads a local action.yml', () => {
    makeAction(`
name: mine
description: ''
runs:
  using: composite
  steps:
    - run: echo hello
`);
    const r = resolveAction('./.github/actions/mine', repo);
    expect(r).not.toBeNull();
    expect(r!.action.runs?.using).toBe('composite');
  });

  it('returns null when path missing', () => {
    expect(resolveAction('./.github/actions/missing', repo)).toBeNull();
  });

  it('returns null for malformed refs', () => {
    expect(resolveAction('not-a-valid-uses', repo)).toBeNull();
  });
  it('returns null for remote refs to repos that 404 (no network in test)', () => {
    // Bogus owner/repo so the git-clone fails fast and returns null.
    expect(resolveAction('this-org-does-not-exist-9z9z9/nor-this-repo@v999', repo)).toBeNull();
  });
});

describe('isComposite', () => {
  it('true for composite', () => {
    expect(isComposite({ runs: { using: 'composite' } })).toBe(true);
  });
  it('false for js / docker', () => {
    expect(isComposite({ runs: { using: 'node20' } })).toBe(false);
    expect(isComposite({ runs: { using: 'docker' } })).toBe(false);
  });
});

describe('expandComposite', () => {
  function parent(withVal: Record<string, unknown> = {}): PlannedStep {
    return {
      index: 5,
      label: 'parent',
      raw: { uses: './.github/actions/mine', with: withVal },
      env: { PARENT_ENV: 'p' },
      with: withVal,
      uses: './.github/actions/mine',
      continueOnError: false,
    };
  }

  it('substitutes inputs from parent.with', () => {
    makeAction(`
name: mine
inputs:
  greeting: { default: 'hello' }
  name: { default: 'world' }
runs:
  using: composite
  steps:
    - run: 'echo \${{ inputs.greeting }} \${{ inputs.name }}'
      shell: bash
`);
    const r = resolveAction('./.github/actions/mine', repo)!;
    const out = expandComposite(parent({ name: 'alice' }), r, ctx());
    expect(out).toHaveLength(1);
    expect(out[0]!.run).toBe('echo hello alice');
    expect(out[0]!.shell).toBe('bash');
  });

  it('falls back to defaults when parent.with omits the input', () => {
    makeAction(`
inputs:
  who: { default: 'world' }
runs:
  using: composite
  steps:
    - run: 'echo \${{ inputs.who }}'
`);
    const r = resolveAction('./.github/actions/mine', repo)!;
    const out = expandComposite(parent(), r, ctx());
    expect(out[0]!.run).toBe('echo world');
  });

  it('preserves parent step when action is not composite', () => {
    makeAction(`
runs:
  using: node20
  main: dist/index.js
`);
    const r = resolveAction('./.github/actions/mine', repo)!;
    const p = parent();
    const out = expandComposite(p, r, ctx());
    expect(out).toEqual([p]);
  });

  it('multiple inner steps each get a unique index + label prefix', () => {
    makeAction(`
runs:
  using: composite
  steps:
    - run: echo one
      name: First
    - run: echo two
      name: Second
`);
    const r = resolveAction('./.github/actions/mine', repo)!;
    const out = expandComposite(parent(), r, ctx());
    expect(out).toHaveLength(2);
    expect(out[0]!.label).toBe('parent → First');
    expect(out[1]!.label).toBe('parent → Second');
    expect(out[0]!.index).not.toBe(out[1]!.index);
  });
});
