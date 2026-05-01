import { describe, it, expect } from 'vitest';
import {
  resolveSymbolicRef,
  formatRefAdvertisement,
  parseRefUpdate,
  classifyRefUpdate,
  isValidRefName,
} from '../src/refs';

describe('resolveSymbolicRef', () => {
  it('resolves HEAD pointing to a branch', () => {
    const store: Record<string, string> = {
      'HEAD': 'ref: refs/heads/main',
      'refs/heads/main': 'abc123'.padEnd(40, '0'),
    };

    const result = resolveSymbolicRef('HEAD', (name) => store[name] ?? null);
    expect(result).toBe('refs/heads/main');
  });

  it('resolves chained symbolic refs', () => {
    const store: Record<string, string> = {
      'HEAD': 'ref: refs/heads/develop',
      'refs/heads/develop': 'ref: refs/heads/feature',
      'refs/heads/feature': 'deadbeef'.padEnd(40, '0'),
    };

    const result = resolveSymbolicRef('HEAD', (name) => store[name] ?? null);
    expect(result).toBe('refs/heads/feature');
  });

  it('returns null for missing ref', () => {
    const result = resolveSymbolicRef('HEAD', () => null);
    expect(result).toBeNull();
  });

  it('returns null for circular reference', () => {
    const store: Record<string, string> = {
      'HEAD': 'ref: refs/heads/a',
      'refs/heads/a': 'ref: refs/heads/b',
      'refs/heads/b': 'ref: HEAD',
    };

    const result = resolveSymbolicRef('HEAD', (name) => store[name] ?? null, 5);
    expect(result).toBeNull();
  });

  it('resolves a direct (non-symbolic) ref on first lookup', () => {
    const sha = 'f'.repeat(40);
    const store: Record<string, string> = {
      'refs/heads/main': sha,
    };

    const result = resolveSymbolicRef('refs/heads/main', (name) => store[name] ?? null);
    expect(result).toBe('refs/heads/main');
  });
});

describe('formatRefAdvertisement', () => {
  it('formats refs with capabilities', () => {
    const refs = [
      { name: 'HEAD', sha: 'a'.repeat(40) },
      { name: 'refs/heads/main', sha: 'a'.repeat(40) },
    ];
    const caps = ['multi_ack', 'thin-pack'];

    const lines = formatRefAdvertisement(refs, caps);

    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('\0');
    expect(lines[0]).toContain('multi_ack thin-pack');
    expect(lines[0]).toContain('a'.repeat(40) + ' HEAD');
    expect(lines[1]).toBe('a'.repeat(40) + ' refs/heads/main');
  });

  it('formats empty repo with zero-id', () => {
    const lines = formatRefAdvertisement([], ['report-status']);

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('0'.repeat(40));
    expect(lines[0]).toContain('capabilities^{}');
    expect(lines[0]).toContain('report-status');
  });

  it('uses empty capabilities when none provided', () => {
    const refs = [{ name: 'refs/heads/main', sha: 'b'.repeat(40) }];
    const lines = formatRefAdvertisement(refs);

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('\0');
  });
});

describe('parseRefUpdate', () => {
  it('parses a valid ref update line', () => {
    const oldSha = '0'.repeat(40);
    const newSha = 'a'.repeat(40);
    const result = parseRefUpdate(`${oldSha} ${newSha} refs/heads/main`);

    expect(result).toEqual({
      oldSha,
      newSha,
      refName: 'refs/heads/main',
    });
  });

  it('parses a line with capabilities after NUL', () => {
    const oldSha = 'b'.repeat(40);
    const newSha = 'c'.repeat(40);
    const line = `${oldSha} ${newSha} refs/heads/feature\0report-status delete-refs`;
    const result = parseRefUpdate(line);

    expect(result).toEqual({
      oldSha,
      newSha,
      refName: 'refs/heads/feature',
    });
  });

  it('returns null for malformed line with too few parts', () => {
    const result = parseRefUpdate('abc def');
    expect(result).toBeNull();
  });

  it('returns null for invalid SHA format', () => {
    const result = parseRefUpdate('not-a-sha not-a-sha refs/heads/main');
    expect(result).toBeNull();
  });

  it('returns null for empty input', () => {
    const result = parseRefUpdate('');
    expect(result).toBeNull();
  });
});

describe('classifyRefUpdate', () => {
  it('classifies create when oldSha is zero', () => {
    const result = classifyRefUpdate({
      oldSha: '0'.repeat(40),
      newSha: 'a'.repeat(40),
      refName: 'refs/heads/new-branch',
    });
    expect(result).toBe('create');
  });

  it('classifies delete when newSha is zero', () => {
    const result = classifyRefUpdate({
      oldSha: 'a'.repeat(40),
      newSha: '0'.repeat(40),
      refName: 'refs/heads/old-branch',
    });
    expect(result).toBe('delete');
  });

  it('classifies update when both SHAs are non-zero', () => {
    const result = classifyRefUpdate({
      oldSha: 'a'.repeat(40),
      newSha: 'b'.repeat(40),
      refName: 'refs/heads/main',
    });
    expect(result).toBe('update');
  });
});

describe('isValidRefName', () => {
  it('accepts valid ref names', () => {
    expect(isValidRefName('refs/heads/main')).toBe(true);
    expect(isValidRefName('refs/tags/v1.0.0')).toBe(true);
    expect(isValidRefName('refs/heads/feature/my-feature')).toBe(true);
  });

  it('rejects refs not starting with refs/', () => {
    expect(isValidRefName('HEAD')).toBe(false);
    expect(isValidRefName('main')).toBe(false);
  });

  it('rejects refs with disallowed characters', () => {
    expect(isValidRefName('refs/heads/bad..name')).toBe(false);
    expect(isValidRefName('refs/heads/bad~name')).toBe(false);
    expect(isValidRefName('refs/heads/bad^name')).toBe(false);
    expect(isValidRefName('refs/heads/bad:name')).toBe(false);
    expect(isValidRefName('refs/heads/bad name')).toBe(false);
  });

  it('rejects refs ending with .lock', () => {
    expect(isValidRefName('refs/heads/main.lock')).toBe(false);
  });

  it('rejects refs ending with /', () => {
    expect(isValidRefName('refs/heads/')).toBe(false);
  });
});
