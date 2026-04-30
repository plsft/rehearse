import { describe, expect, it } from 'vitest';
import { node } from '../../src/presets/index.js';

describe('node preset', () => {
  it('setup uses actions/setup-node@v4 with node-version', () => {
    const s = node.setup('20');
    expect(s.uses).toBe('actions/setup-node@v4');
    expect(s.with?.['node-version']).toBe('20');
  });

  it('install switches between npm ci and npm install', () => {
    expect(node.install(true).run).toBe('npm ci');
    expect(node.install(false).run).toBe('npm install');
  });

  it('test --coverage when requested', () => {
    expect(node.test(true).run).toBe('npm test -- --coverage');
    expect(node.test(false).run).toBe('npm test');
  });

  it('build, lint, typecheck use npm run', () => {
    expect(node.build().run).toBe('npm run build');
    expect(node.lint().run).toBe('npm run lint');
    expect(node.typecheck().run).toBe('npm run typecheck');
  });
});
