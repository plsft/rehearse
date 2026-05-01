import { describe, expect, it } from 'vitest';
import { versionMatches } from '../src/shims/setup-node.js';

describe('versionMatches', () => {
  it('exact match', () => {
    expect(versionMatches('20.10.0', '20.10.0')).toBe(true);
  });
  it('major-only request matches any same-major host', () => {
    expect(versionMatches('20', '20.10.0')).toBe(true);
    expect(versionMatches('20', '21.0.0')).toBe(false);
  });
  it('wildcard 20.x matches any 20.*.*', () => {
    expect(versionMatches('20.x', '20.10.0')).toBe(true);
    expect(versionMatches('20.x', '20.0.5')).toBe(true);
    expect(versionMatches('20.x', '22.0.0')).toBe(false);
  });
  it('caret / tilde treated as major-anchored', () => {
    expect(versionMatches('^20', '20.5.1')).toBe(true);
    expect(versionMatches('~20', '20.5.1')).toBe(true);
    expect(versionMatches('^20', '21.0.0')).toBe(false);
  });
  it('partial version comparisons', () => {
    expect(versionMatches('20.10', '20.10.0')).toBe(true);
    expect(versionMatches('20.10', '20.11.0')).toBe(false);
  });
  it('empty wanted accepts anything', () => {
    expect(versionMatches('', '22.0.0')).toBe(true);
  });
});
