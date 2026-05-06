import { describe, expect, it } from 'vitest';
import { evalBody, evalCondition, evalExpr } from '../src/runner/expression.js';
import type { ExpressionContext } from '../src/runner/types.js';

const baseCtx = (): ExpressionContext => ({
  matrix: { node: '20.x', os: 'ubuntu-latest' },
  env: { NODE_ENV: 'test' },
  secrets: { TOKEN: 's3cret' },
  vars: { REGION: 'us-west-2' },
  github: { event_name: 'pull_request', actor: 'alice', ref: 'refs/heads/main' },
  needs: { build: { result: 'success', outputs: { sha: 'abc123' } } },
  steps: { setup: { outputs: { node: 'v20.10.0' }, outcome: 'success', conclusion: 'success' } },
  job: { status: 'success' },
  runner: { os: 'Linux', arch: 'X64', temp: '/tmp' },
  inputs: {},
});

describe('evalBody — atoms', () => {
  it('string literal', () => expect(evalBody("'hello'", baseCtx())).toBe('hello'));
  it('number literal', () => expect(evalBody('42', baseCtx())).toBe(42));
  it('true/false/null', () => {
    expect(evalBody('true', baseCtx())).toBe(true);
    expect(evalBody('false', baseCtx())).toBe(false);
    expect(evalBody('null', baseCtx())).toBe(null);
  });
});

describe('evalBody — context lookups', () => {
  it('matrix.x', () => expect(evalBody('matrix.node', baseCtx())).toBe('20.x'));
  it('env.X', () => expect(evalBody('env.NODE_ENV', baseCtx())).toBe('test'));
  it('secrets.X', () => expect(evalBody('secrets.TOKEN', baseCtx())).toBe('s3cret'));
  it('runner.os', () => expect(evalBody('runner.os', baseCtx())).toBe('Linux'));
  it('needs.<job>.outputs.<n>', () => expect(evalBody('needs.build.outputs.sha', baseCtx())).toBe('abc123'));
  it('steps.<id>.outputs.<n>', () => expect(evalBody('steps.setup.outputs.node', baseCtx())).toBe('v20.10.0'));
  it('github.event_name', () => expect(evalBody('github.event_name', baseCtx())).toBe('pull_request'));
});

describe('evalBody — operators', () => {
  it('eq / ne', () => {
    expect(evalBody("github.event_name == 'pull_request'", baseCtx())).toBe(true);
    expect(evalBody("github.event_name != 'push'", baseCtx())).toBe(true);
  });
  it('and / or / not', () => {
    expect(evalBody("github.actor == 'alice' && runner.os == 'Linux'", baseCtx())).toBe(true);
    expect(evalBody('false || true', baseCtx())).toBe(true);
    expect(evalBody('!false', baseCtx())).toBe(true);
  });
});

describe('evalBody — functions', () => {
  it('contains on array', () => {
    const ctx = baseCtx();
    ctx.github.labels = ['agent:claude', 'enhancement'];
    expect(evalBody("contains(github.labels, 'agent:claude')", ctx)).toBe(true);
  });
  it('contains on string (case-insensitive)', () => {
    expect(evalBody("contains('Hello World', 'WORLD')", baseCtx())).toBe(true);
  });
  it('startsWith / endsWith', () => {
    expect(evalBody("startsWith('refs/heads/main', 'refs/heads')", baseCtx())).toBe(true);
    expect(evalBody("endsWith('main.yml', '.yml')", baseCtx())).toBe(true);
  });
  it('success / failure / always under different job statuses', () => {
    const ok = baseCtx(); ok.job.status = 'success';
    const bad = baseCtx(); bad.job.status = 'failure';
    expect(evalBody('success()', ok)).toBe(true);
    expect(evalBody('failure()', ok)).toBe(false);
    expect(evalBody('failure()', bad)).toBe(true);
    expect(evalBody('always()', bad)).toBe(true);
  });
  it('format()', () => {
    expect(evalBody("format('Hello {0} {1}', 'world', '!')", baseCtx())).toBe('Hello world !');
  });
});

describe('evalExpr — interpolation', () => {
  it('whole-string expression returns raw value', () => {
    expect(evalExpr('${{ matrix.node }}', baseCtx())).toBe('20.x');
  });
  it('inline interpolation returns string', () => {
    expect(evalExpr('node-${{ matrix.node }}-${{ runner.os }}', baseCtx())).toBe('node-20.x-Linux');
  });
  it('passthrough when no expression', () => {
    expect(evalExpr('static-text', baseCtx())).toBe('static-text');
  });
});

describe('evalCondition', () => {
  it('truthy values run', () => {
    expect(evalCondition("github.event_name == 'pull_request'", baseCtx())).toBe(true);
  });
  it('failure() under success status', () => {
    const ctx = baseCtx(); ctx.job.status = 'success';
    expect(evalCondition('failure()', ctx)).toBe(false);
  });
});
