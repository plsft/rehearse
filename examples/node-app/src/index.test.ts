import { describe, expect, it } from 'vitest';
import { asyncDelay, sum, uniqueWords } from './index.js';

describe('sum', () => {
  it('adds two numbers', () => expect(sum(2, 3)).toBe(5));
  it('handles negatives', () => expect(sum(-1, 1)).toBe(0));
});

describe('uniqueWords', () => {
  it('lowercases, dedupes, sorts', () => {
    expect(uniqueWords('The quick brown fox jumps over THE lazy fox')).toEqual([
      'brown', 'fox', 'jumps', 'lazy', 'over', 'quick', 'the',
    ]);
  });
  it('returns empty for non-words', () => expect(uniqueWords('!!!')).toEqual([]));
  it('rejects non-strings', () => {
    // @ts-expect-error
    expect(() => uniqueWords(42)).toThrow(TypeError);
  });
});

describe('asyncDelay', () => {
  it('resolves with the value after the delay', async () => {
    const t0 = Date.now();
    const v = await asyncDelay(20, 'ok');
    expect(v).toBe('ok');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
  });
});
