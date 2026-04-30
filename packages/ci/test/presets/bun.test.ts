import { describe, expect, it } from 'vitest';
import { bun } from '../../src/presets/index.js';

describe('bun preset', () => {
  it('setup uses oven-sh/setup-bun@v2', () => {
    expect(bun.setup().uses).toBe('oven-sh/setup-bun@v2');
    expect(bun.setup('1.1.0').with?.['bun-version']).toBe('1.1.0');
  });

  it('install with frozen lockfile', () => {
    expect(bun.install(true).run).toBe('bun install --frozen-lockfile');
    expect(bun.install(false).run).toBe('bun install');
  });

  it('test honors coverage flag', () => {
    expect(bun.test(true).run).toBe('bun test --coverage');
  });
});
