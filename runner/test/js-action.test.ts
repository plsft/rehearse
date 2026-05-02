import { describe, expect, it } from 'vitest';
import { isJsActionUses, parseGithubOutput } from '../src/js-action.js';

describe('isJsActionUses', () => {
  it('matches owner/repo@ref', () => {
    expect(isJsActionUses('actions/checkout@v4')).toBe(true);
    expect(isJsActionUses('actions/setup-node@v4.0.0')).toBe(true);
    expect(isJsActionUses('owner/repo/sub-path@main')).toBe(true);
    expect(isJsActionUses('owner/repo@abc123def')).toBe(true);
  });
  it('rejects local composite refs', () => {
    expect(isJsActionUses('./.github/actions/foo')).toBe(false);
  });
  it('rejects undefined / empty', () => {
    expect(isJsActionUses(undefined)).toBe(false);
    expect(isJsActionUses('')).toBe(false);
  });
});

describe('parseGithubOutput', () => {
  it('parses simple key=value', () => {
    expect(parseGithubOutput('foo=bar\nbaz=qux\n')).toEqual({ foo: 'bar', baz: 'qux' });
  });
  it('handles heredoc multiline values', () => {
    const input = 'big<<EOF\nline1\nline2\nline3\nEOF\nflag=true\n';
    expect(parseGithubOutput(input)).toEqual({ big: 'line1\nline2\nline3', flag: 'true' });
  });
  it('skips blank lines', () => {
    expect(parseGithubOutput('\nfoo=1\n\nbar=2\n')).toEqual({ foo: '1', bar: '2' });
  });
  it('returns empty for empty input', () => {
    expect(parseGithubOutput('')).toEqual({});
  });
  it('survives custom heredoc markers', () => {
    const input = 'k<<MY_MARKER\nhello\nMY_MARKER\nx=y\n';
    expect(parseGithubOutput(input)).toEqual({ k: 'hello', x: 'y' });
  });
});
