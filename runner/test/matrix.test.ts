import { describe, expect, it } from 'vitest';
import { cellId, expandMatrix, parseMatrix } from '../src/matrix.js';

describe('parseMatrix', () => {
  it('returns null for undefined', () => {
    expect(parseMatrix(undefined)).toBeNull();
  });

  it('separates variables from include/exclude', () => {
    const spec = parseMatrix({
      node: ['18', '20'],
      os: ['ubuntu', 'windows'],
      include: [{ node: '22', os: 'ubuntu' }],
      exclude: [{ node: '18', os: 'windows' }],
    });
    expect(spec?.variables).toEqual({ node: ['18', '20'], os: ['ubuntu', 'windows'] });
    expect(spec?.include).toEqual([{ node: '22', os: 'ubuntu' }]);
    expect(spec?.exclude).toEqual([{ node: '18', os: 'windows' }]);
  });
});

describe('expandMatrix', () => {
  it('returns one empty cell for null', () => {
    expect(expandMatrix(null)).toEqual([{}]);
  });

  it('cartesian product of two variables', () => {
    const cells = expandMatrix({ variables: { a: [1, 2], b: ['x', 'y'] } });
    expect(cells).toHaveLength(4);
    expect(cells).toContainEqual({ a: 1, b: 'x' });
    expect(cells).toContainEqual({ a: 2, b: 'y' });
  });

  it('exclude removes matching cells', () => {
    const cells = expandMatrix({
      variables: { node: ['18', '20', '22'], os: ['ubuntu', 'windows'] },
      exclude: [{ node: '18', os: 'windows' }],
    });
    expect(cells).toHaveLength(5);
    expect(cells).not.toContainEqual({ node: '18', os: 'windows' });
  });

  it('include merges into existing matching cell', () => {
    const cells = expandMatrix({
      variables: { node: ['18', '20'] },
      include: [{ node: '20', extra: 'augmented' }],
    });
    expect(cells).toHaveLength(2);
    const augmented = cells.find((c) => c.node === '20');
    expect(augmented).toEqual({ node: '20', extra: 'augmented' });
  });

  it('include appends a new cell when no overlap', () => {
    const cells = expandMatrix({
      variables: { node: ['18', '20'] },
      include: [{ python: '3.12' }],
    });
    expect(cells).toHaveLength(3);
    expect(cells.at(-1)).toEqual({ python: '3.12' });
  });

  it('hono node matrix shape', () => {
    const cells = expandMatrix({
      variables: { node: ['18.18.2', '20.x', '22.x'] },
    });
    expect(cells).toEqual([{ node: '18.18.2' }, { node: '20.x' }, { node: '22.x' }]);
  });
});

describe('cellId', () => {
  it('empty cell yields empty id', () => {
    expect(cellId({})).toBe('');
  });

  it('produces deterministic, slug-safe ids', () => {
    expect(cellId({ os: 'ubuntu-latest', node: '20.x' })).toBe('node=20.x,os=ubuntu-latest');
    expect(cellId({ b: 1, a: 2 })).toBe('a=2,b=1');
  });
});
