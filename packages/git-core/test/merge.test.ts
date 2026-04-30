import { describe, it, expect } from 'vitest';
import { threeWayMerge, canFastForward } from '../src/merge';

describe('threeWayMerge', () => {
  it('returns theirs when ours equals base', () => {
    const result = threeWayMerge('base\n', 'base\n', 'theirs\n');
    expect(result.content).toBe('theirs\n');
    expect(result.hasConflicts).toBe(false);
  });

  it('returns ours when theirs equals base', () => {
    const result = threeWayMerge('base\n', 'ours\n', 'base\n');
    expect(result.content).toBe('ours\n');
    expect(result.hasConflicts).toBe(false);
  });

  it('returns ours when both sides are identical', () => {
    const result = threeWayMerge('base\n', 'same\n', 'same\n');
    expect(result.content).toBe('same\n');
    expect(result.hasConflicts).toBe(false);
  });

  it('merges non-overlapping changes on different lines', () => {
    const base =   'line1\nline2\nline3\nline4\nline5';
    const ours =   'line1\nOUR CHANGE\nline3\nline4\nline5';
    const theirs = 'line1\nline2\nline3\nTHEIR CHANGE\nline5';

    const result = threeWayMerge(base, ours, theirs);
    expect(result.hasConflicts).toBe(false);
    expect(result.content).toContain('OUR CHANGE');
    expect(result.content).toContain('THEIR CHANGE');
    expect(result.content).toContain('line1');
    expect(result.content).toContain('line5');
  });

  it('detects conflicts when both sides change the same line', () => {
    const base =   'line1\nline2\nline3';
    const ours =   'line1\nours\nline3';
    const theirs = 'line1\ntheirs\nline3';

    const result = threeWayMerge(base, ours, theirs);
    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.content).toContain('<<<<<<< ours');
    expect(result.content).toContain('=======');
    expect(result.content).toContain('>>>>>>> theirs');
  });

  it('handles ours deleting a line while theirs keeps it', () => {
    const base =   'a\nb\nc';
    const ours =   'a\nc';        // deleted b
    const theirs = 'a\nb\nc';     // no change

    const result = threeWayMerge(base, ours, theirs);
    expect(result.hasConflicts).toBe(false);
    expect(result.content).toBe('a\nc');
  });

  it('handles theirs inserting a line while ours keeps base', () => {
    const base =   'a\nc';
    const ours =   'a\nc';        // no change
    const theirs = 'a\nb\nc';     // inserted b

    const result = threeWayMerge(base, ours, theirs);
    expect(result.hasConflicts).toBe(false);
    expect(result.content).toBe('a\nb\nc');
  });

  it('handles both sides making identical changes (no conflict)', () => {
    const base =   'a\nb\nc';
    const ours =   'a\nX\nc';
    const theirs = 'a\nX\nc';

    const result = threeWayMerge(base, ours, theirs);
    expect(result.hasConflicts).toBe(false);
    expect(result.content).toContain('X');
  });

  it('conflict markers are correctly formatted', () => {
    const base =   'a\nb\nc';
    const ours =   'a\nX\nc';
    const theirs = 'a\nY\nc';

    const result = threeWayMerge(base, ours, theirs);
    expect(result.hasConflicts).toBe(true);
    // Check exact marker structure
    const lines = result.content.split('\n');
    const markerStart = lines.findIndex((l) => l === '<<<<<<< ours');
    const markerSep = lines.findIndex((l) => l === '=======');
    const markerEnd = lines.findIndex((l) => l === '>>>>>>> theirs');
    expect(markerStart).toBeGreaterThanOrEqual(0);
    expect(markerSep).toBeGreaterThan(markerStart);
    expect(markerEnd).toBeGreaterThan(markerSep);
  });

  it('handles empty base (both sides add content)', () => {
    const result = threeWayMerge('', 'ours\n', 'theirs\n');
    // Both sides added different content from empty — should contain both
    expect(result.content).toBeTruthy();
  });

  it('handles one side adding at end, other unchanged', () => {
    const base =   'a\nb';
    const ours =   'a\nb\nc';     // added c
    const theirs = 'a\nb';        // no change

    const result = threeWayMerge(base, ours, theirs);
    expect(result.hasConflicts).toBe(false);
    expect(result.content).toContain('c');
  });
});

describe('canFastForward', () => {
  it('returns true when base equals ours', () => {
    expect(canFastForward('abc123', 'abc123')).toBe(true);
  });

  it('returns false when base differs from ours', () => {
    expect(canFastForward('abc123', 'def456')).toBe(false);
  });
});
