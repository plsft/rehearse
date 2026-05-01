import { describe, expect, it } from 'vitest';
import { step } from '../../src/index.js';

describe('step', () => {
  it('run() requires a non-empty command', () => {
    expect(() => step.run('')).toThrow(/command/);
    expect(step.run('echo hi').run).toBe('echo hi');
  });

  it('action() emits a `uses` step', () => {
    const s = step.action('actions/setup-node@v4', { with: { 'node-version': '20' } });
    expect(s.uses).toBe('actions/setup-node@v4');
    expect(s.with).toEqual({ 'node-version': '20' });
  });

  it('checkout() defaults', () => {
    const s = step.checkout();
    expect(s.uses).toBe('actions/checkout@v4');
    expect(s.with).toBeUndefined();
  });

  it('checkout() honours options', () => {
    const s = step.checkout({ ref: 'main', fetchDepth: 0, submodules: 'recursive' });
    expect(s.with).toEqual({ ref: 'main', 'fetch-depth': 0, submodules: 'recursive' });
  });

  it('uploadArtifact() and downloadArtifact()', () => {
    const up = step.uploadArtifact({ name: 'dist', path: 'dist/' });
    expect(up.uses).toBe('actions/upload-artifact@v4');
    expect(up.with).toEqual({ name: 'dist', path: 'dist/' });

    const dn = step.downloadArtifact('dist', '/tmp/dist');
    expect(dn.uses).toBe('actions/download-artifact@v4');
    expect(dn.with).toEqual({ name: 'dist', path: '/tmp/dist' });
  });

  it('cache() stringifies array paths', () => {
    const s = step.cache({ path: ['~/.cargo', 'target'], key: 'k' });
    expect(s.with?.path).toBe('~/.cargo\ntarget');
  });
});
