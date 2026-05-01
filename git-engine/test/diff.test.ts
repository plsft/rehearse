import { describe, it, expect } from 'vitest';
import {
  myersDiff,
  generateDiffHunks,
  generateUnifiedDiff,
  computeDiffStats,
  isBinaryContent,
} from '../src/diff';

describe('myersDiff', () => {
  it('handles identical strings', () => {
    const result = myersDiff(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(result.every((e) => e.type === 'equal')).toBe(true);
    expect(result.length).toBe(3);
  });

  it('handles completely different strings', () => {
    const result = myersDiff(['a', 'b'], ['c', 'd']);
    const inserts = result.filter((e) => e.type === 'insert');
    const deletes = result.filter((e) => e.type === 'delete');
    expect(inserts.length).toBe(2);
    expect(deletes.length).toBe(2);
  });

  it('handles empty old', () => {
    const result = myersDiff([], ['a', 'b']);
    expect(result.every((e) => e.type === 'insert')).toBe(true);
    expect(result.length).toBe(2);
  });

  it('handles empty new', () => {
    const result = myersDiff(['a', 'b'], []);
    expect(result.every((e) => e.type === 'delete')).toBe(true);
    expect(result.length).toBe(2);
  });

  it('handles both empty', () => {
    const result = myersDiff([], []);
    expect(result.length).toBe(0);
  });

  it('finds single insertion', () => {
    const result = myersDiff(['a', 'c'], ['a', 'b', 'c']);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual({ type: 'equal', oldIdx: 0, newIdx: 0 });
    expect(result[1]).toEqual({ type: 'insert', newIdx: 1 });
    expect(result[2]).toEqual({ type: 'equal', oldIdx: 1, newIdx: 2 });
  });

  it('finds single deletion', () => {
    const result = myersDiff(['a', 'b', 'c'], ['a', 'c']);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual({ type: 'equal', oldIdx: 0, newIdx: 0 });
    expect(result[1]).toEqual({ type: 'delete', oldIdx: 1 });
    expect(result[2]).toEqual({ type: 'equal', oldIdx: 2, newIdx: 1 });
  });
});

describe('generateDiffHunks', () => {
  it('produces hunks for a simple change', () => {
    const old = 'line1\nline2\nline3\n';
    const new_ = 'line1\nmodified\nline3\n';

    const hunks = generateDiffHunks(old, new_);
    expect(hunks.length).toBe(1);

    const hunk = hunks[0]!;
    const adds = hunk.lines.filter((l) => l.type === 'add');
    const removes = hunk.lines.filter((l) => l.type === 'remove');
    expect(adds.length).toBe(1);
    expect(removes.length).toBe(1);
    expect(adds[0]!.content).toBe('modified');
    expect(removes[0]!.content).toBe('line2');
  });

  it('returns empty hunks for identical content', () => {
    const hunks = generateDiffHunks('same\n', 'same\n');
    expect(hunks.length).toBe(0);
  });

  it('handles new file (empty old)', () => {
    const hunks = generateDiffHunks('', 'new line\n');
    expect(hunks.length).toBe(1);
    const adds = hunks[0]!.lines.filter((l) => l.type === 'add');
    expect(adds.length).toBeGreaterThan(0);
  });

  it('handles deleted file (empty new)', () => {
    const hunks = generateDiffHunks('old line\n', '');
    expect(hunks.length).toBe(1);
    const removes = hunks[0]!.lines.filter((l) => l.type === 'remove');
    expect(removes.length).toBeGreaterThan(0);
  });
});

describe('generateUnifiedDiff', () => {
  it('produces valid unified diff format', () => {
    const old = 'line1\nline2\nline3\nline4\nline5\n';
    const new_ = 'line1\nline2\nmodified\nline4\nline5\n';

    const diff = generateUnifiedDiff('file.txt', 'file.txt', old, new_);

    expect(diff).toContain('--- a/file.txt');
    expect(diff).toContain('+++ b/file.txt');
    expect(diff).toContain('@@');
    expect(diff).toContain('-line3');
    expect(diff).toContain('+modified');
    expect(diff).toContain(' line2'); // context line
    expect(diff).toContain(' line4'); // context line
  });

  it('returns empty string for identical files', () => {
    const diff = generateUnifiedDiff('f.txt', 'f.txt', 'same\n', 'same\n');
    expect(diff).toBe('');
  });

  it('handles multiple non-adjacent changes', () => {
    const oldLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    const newArr = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    newArr[2] = 'changed 3';
    newArr[17] = 'changed 18';
    const newLines = newArr.join('\n');

    const diff = generateUnifiedDiff('f.txt', 'f.txt', oldLines, newLines);
    expect(diff).toContain('-line 3');
    expect(diff).toContain('+changed 3');
    expect(diff).toContain('-line 18');
    expect(diff).toContain('+changed 18');
  });
});

describe('computeDiffStats', () => {
  it('computes correct stats', () => {
    const hunks = generateDiffHunks('a\nb\nc\n', 'a\nx\ny\nc\n');
    const stats = computeDiffStats(hunks);
    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(1);
  });
});

describe('isBinaryContent', () => {
  it('detects binary content (null bytes)', () => {
    const data = new Uint8Array([0x48, 0x65, 0x00, 0x6c, 0x6f]);
    expect(isBinaryContent(data)).toBe(true);
  });

  it('allows text content', () => {
    const data = new TextEncoder().encode('Hello, World!\n');
    expect(isBinaryContent(data)).toBe(false);
  });

  it('handles empty content', () => {
    expect(isBinaryContent(new Uint8Array(0))).toBe(false);
  });
});
