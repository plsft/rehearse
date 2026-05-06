import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalArtifacts, parseArtifactPaths } from '../src/runner/artifacts.js';

let cwd: string;
let store: LocalArtifacts;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'runner-art-test-'));
  store = new LocalArtifacts(join(cwd, '.runner', 'artifacts'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('LocalArtifacts', () => {
  it('upload then list', () => {
    mkdirSync(join(cwd, 'dist'), { recursive: true });
    writeFileSync(join(cwd, 'dist', 'a.js'), 'a');
    writeFileSync(join(cwd, 'dist', 'b.js'), 'b');
    store.upload('build', ['dist'], cwd);
    expect(store.has('build')).toBe(true);
    expect(store.list()).toEqual(['build']);
  });

  it('upload preserves relative paths', () => {
    mkdirSync(join(cwd, 'dist', 'inner'), { recursive: true });
    writeFileSync(join(cwd, 'dist', 'inner', 'file.txt'), 'hello');
    store.upload('artefact', ['dist'], cwd);
    const dest = mkdtempSync(join(tmpdir(), 'dl-'));
    store.download('artefact', dest, cwd);
    expect(readFileSync(join(dest, 'dist', 'inner', 'file.txt'), 'utf-8')).toBe('hello');
    rmSync(dest, { recursive: true, force: true });
  });

  it('download by name resolves into target', () => {
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'index.ts'), 'export {}');
    store.upload('sources', ['src'], cwd);
    const out = join(cwd, 'restored');
    store.download('sources', out, cwd);
    expect(existsSync(join(out, 'src', 'index.ts'))).toBe(true);
  });

  it('download with no name pulls all artifacts side-by-side', () => {
    mkdirSync(join(cwd, 'a'), { recursive: true });
    mkdirSync(join(cwd, 'b'), { recursive: true });
    writeFileSync(join(cwd, 'a', 'x'), '');
    writeFileSync(join(cwd, 'b', 'y'), '');
    store.upload('first', ['a'], cwd);
    store.upload('second', ['b'], cwd);
    const out = join(cwd, 'restored');
    const r = store.download(undefined, out, cwd);
    expect(r.count).toBeGreaterThan(0);
    expect(existsSync(join(out, 'first', 'a', 'x'))).toBe(true);
    expect(existsSync(join(out, 'second', 'b', 'y'))).toBe(true);
  });

  it('overwrites on re-upload of same name', () => {
    mkdirSync(join(cwd, 'p'), { recursive: true });
    writeFileSync(join(cwd, 'p', 'f.txt'), 'v1');
    store.upload('thing', ['p'], cwd);
    writeFileSync(join(cwd, 'p', 'f.txt'), 'v2');
    store.upload('thing', ['p'], cwd);
    const out = join(cwd, 'r');
    store.download('thing', out, cwd);
    expect(readFileSync(join(out, 'p', 'f.txt'), 'utf-8')).toBe('v2');
  });

  it('missing path is silently skipped', () => {
    const r = store.upload('partial', ['does/not/exist', 'still/missing'], cwd);
    expect(r.paths).toEqual([]);
  });

  it('sanitises artifact names with unsafe chars', () => {
    mkdirSync(join(cwd, 'q'), { recursive: true });
    writeFileSync(join(cwd, 'q', 'f'), 'x');
    store.upload('weird/name with spaces', ['q'], cwd);
    expect(store.has('weird/name with spaces')).toBe(true);
  });
});

describe('parseArtifactPaths', () => {
  it('newline-separated string', () => {
    expect(parseArtifactPaths('a\nb\n c ')).toEqual(['a', 'b', 'c']);
  });
  it('array passthrough', () => {
    expect(parseArtifactPaths(['x', 'y'])).toEqual(['x', 'y']);
  });
  it('garbage → empty', () => {
    expect(parseArtifactPaths(undefined)).toEqual([]);
    expect(parseArtifactPaths(42 as unknown)).toEqual([]);
  });
});
