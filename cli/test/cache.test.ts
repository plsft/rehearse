import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalCache, parsePaths } from '../src/runner/cache.js';

let cwd: string;
let cache: LocalCache;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'runner-cache-test-'));
  cache = new LocalCache(join(cwd, '.runner', 'cache'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('LocalCache', () => {
  it('initial resolve = miss', () => {
    expect(cache.resolve('node-modules-abc').hit).toBe('miss');
  });

  it('save then resolve = exact hit', () => {
    mkdirSync(join(cwd, 'node_modules'), { recursive: true });
    writeFileSync(join(cwd, 'node_modules', 'index.js'), 'module.exports = 1;');
    const saved = cache.save('node-modules-abc', cwd, ['node_modules']);
    expect(saved).toBe(true);
    const r = cache.resolve('node-modules-abc');
    expect(r.hit).toBe('exact');
    expect(r.matchedKey).toBe('node-modules-abc');
  });

  it('saving the same key twice is a no-op', () => {
    mkdirSync(join(cwd, 'foo'), { recursive: true });
    writeFileSync(join(cwd, 'foo', 'bar.txt'), 'first');
    expect(cache.save('k', cwd, ['foo'])).toBe(true);
    writeFileSync(join(cwd, 'foo', 'bar.txt'), 'second');
    expect(cache.save('k', cwd, ['foo'])).toBe(false); // already exists
    // Restore and verify content is the original "first" save.
    rmSync(join(cwd, 'foo'), { recursive: true });
    cache.restore('k', cwd);
    expect(readFileSync(join(cwd, 'foo', 'bar.txt'), 'utf-8')).toBe('first');
  });

  it('restore-key prefix match works', () => {
    mkdirSync(join(cwd, 'pkg'), { recursive: true });
    writeFileSync(join(cwd, 'pkg', 'a.txt'), 'a');
    cache.save('node-deps-os-linux-hash-abc', cwd, ['pkg']);
    const r = cache.resolve('node-deps-os-linux-hash-NEW', ['node-deps-os-linux-', 'node-deps-']);
    expect(r.hit).toBe('partial');
    expect(r.matchedKey).toBe('node-deps-os-linux-hash-abc');
  });

  it('longest-prefix-match wins among multiple restore keys', () => {
    mkdirSync(join(cwd, 'a'), { recursive: true });
    writeFileSync(join(cwd, 'a', 'x'), 'old');
    cache.save('linux-x', cwd, ['a']);
    writeFileSync(join(cwd, 'a', 'x'), 'newer');
    cache.save('linux-x-with-suffix', cwd, ['a']);
    const r = cache.resolve('miss', ['linux-x-with-', 'linux-']);
    expect(r.matchedKey).toBe('linux-x-with-suffix');
  });

  it('restore copies content back to cwd', () => {
    mkdirSync(join(cwd, 'cache-target'), { recursive: true });
    writeFileSync(join(cwd, 'cache-target', 'data.bin'), 'payload');
    cache.save('one', cwd, ['cache-target']);
    rmSync(join(cwd, 'cache-target'), { recursive: true });
    expect(existsSync(join(cwd, 'cache-target'))).toBe(false);
    cache.restore('one', cwd);
    expect(readFileSync(join(cwd, 'cache-target', 'data.bin'), 'utf-8')).toBe('payload');
  });

  it('handles multiple paths per entry', () => {
    mkdirSync(join(cwd, 'one'), { recursive: true });
    mkdirSync(join(cwd, 'two'), { recursive: true });
    writeFileSync(join(cwd, 'one', 'a'), '1');
    writeFileSync(join(cwd, 'two', 'b'), '2');
    cache.save('multi', cwd, ['one', 'two']);
    rmSync(join(cwd, 'one'), { recursive: true });
    rmSync(join(cwd, 'two'), { recursive: true });
    cache.restore('multi', cwd);
    expect(readFileSync(join(cwd, 'one', 'a'), 'utf-8')).toBe('1');
    expect(readFileSync(join(cwd, 'two', 'b'), 'utf-8')).toBe('2');
  });

  it('list() returns saved entries', () => {
    mkdirSync(join(cwd, 'p'), { recursive: true });
    writeFileSync(join(cwd, 'p', 'f'), '');
    cache.save('first', cwd, ['p']);
    cache.save('second', cwd, ['p']);
    expect(cache.list().map((e) => e.key)).toEqual(['first', 'second']);
  });
});

describe('parsePaths', () => {
  it('newline-separated string', () => {
    expect(parsePaths('a\nb\n c ')).toEqual(['a', 'b', 'c']);
  });
  it('array of strings', () => {
    expect(parsePaths(['x', 'y'])).toEqual(['x', 'y']);
  });
  it('non-string input → []', () => {
    expect(parsePaths(undefined)).toEqual([]);
    expect(parsePaths(123 as unknown)).toEqual([]);
  });
});

void resolve;
