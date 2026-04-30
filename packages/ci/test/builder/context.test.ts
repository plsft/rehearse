import { describe, expect, it } from 'vitest';
import {
  env,
  expr,
  github,
  hashFiles,
  needs,
  secrets,
  steps,
  vars,
} from '../../src/index.js';

describe('context helpers', () => {
  it('secrets()', () => {
    expect(secrets('TOKEN')).toBe('${{ secrets.TOKEN }}');
    expect(() => secrets('')).toThrow(/non-empty/);
  });

  it('vars()', () => {
    expect(vars('REGION')).toBe('${{ vars.REGION }}');
  });

  it('github()', () => {
    expect(github('event.pull_request.number')).toBe(
      '${{ github.event.pull_request.number }}',
    );
  });

  it('env()', () => {
    expect(env('NODE_ENV')).toBe('${{ env.NODE_ENV }}');
  });

  it('needs()', () => {
    expect(needs('build', 'sha')).toBe('${{ needs.build.outputs.sha }}');
  });

  it('steps()', () => {
    expect(steps('s1', 'out')).toBe('${{ steps.s1.outputs.out }}');
  });

  it('expr()', () => {
    expect(expr("github.ref == 'refs/heads/main'")).toBe(
      "${{ github.ref == 'refs/heads/main' }}",
    );
  });

  it('hashFiles()', () => {
    expect(hashFiles('**/package-lock.json')).toBe(
      "${{ hashFiles('**/package-lock.json') }}",
    );
    expect(hashFiles('a', 'b')).toBe("${{ hashFiles('a', 'b') }}");
    expect(() => hashFiles()).toThrow(/pattern/);
  });
});
