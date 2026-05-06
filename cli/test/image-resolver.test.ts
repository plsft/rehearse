import { describe, expect, test } from 'vitest';
import { createImageResolver } from '../src/runner/backends/image-resolver.js';

describe('image-resolver', () => {
  test('with no token returns public passthrough', () => {
    const r = createImageResolver({ token: undefined });
    expect(r.resolve('node:20')).toEqual({ image: 'node:20', source: 'public' });
    expect(r.resolve('python:3.12')).toEqual({ image: 'python:3.12', source: 'public' });
  });

  test('with token rewrites known bare versions to warmed Pro images', () => {
    const r = createImageResolver({ token: 'rh_pro_live_xxx' });
    const node = r.resolve('node:20');
    expect(node.source).toBe('pro');
    expect(node.image).toBe('registry.rehearse.sh/node:20-warm');
    expect(node.auth?.registry).toBe('registry.rehearse.sh');
    expect(node.auth?.username).toBe('rehearse');
    expect(node.auth?.password).toBe('rh_pro_live_xxx');
  });

  test('with token, unknown language passes through', () => {
    const r = createImageResolver({ token: 'rh_pro_live_xxx' });
    expect(r.resolve('redis:7-alpine')).toEqual({ image: 'redis:7-alpine', source: 'public' });
  });

  test('with token, specific tag with non-numeric suffix passes through', () => {
    const r = createImageResolver({ token: 'rh_pro_live_xxx' });
    expect(r.resolve('node:22-bookworm-slim').source).toBe('public');
  });

  test('with token, version not in Pro catalog passes through', () => {
    const r = createImageResolver({ token: 'rh_pro_live_xxx' });
    expect(r.resolve('node:22').source).toBe('public');
  });

  test('with token, already-Pro ref passes through to Pro registry', () => {
    const r = createImageResolver({ token: 'rh_pro_live_xxx' });
    const result = r.resolve('node:20-warm');
    expect(result.source).toBe('pro');
    expect(result.image).toBe('registry.rehearse.sh/node:20-warm');
  });

  test('with token, project-level mapping override wins', () => {
    const r = createImageResolver({
      token: 'rh_pro_live_xxx',
      mapping: { 'node:20': 'node:20-postgres-warm' },
    });
    const result = r.resolve('node:20');
    expect(result.source).toBe('pro');
    expect(result.image).toBe('registry.rehearse.sh/node:20-postgres-warm');
  });

  test('disabled config skips Pro even with token', () => {
    const r = createImageResolver({ token: 'rh_pro_live_xxx', enabled: false });
    expect(r.resolve('node:20').source).toBe('public');
  });

  test('all 8 catalog languages resolve to Pro', () => {
    const r = createImageResolver({ token: 'rh_pro_live_xxx' });
    const cases = [
      ['node:20', 'node:20-warm'],
      ['python:3.12', 'python:3.12-warm'],
      ['bun:1', 'bun:1-warm'],
      ['go:1.24', 'go:1.24-warm'],
      ['java:21', 'java:21-warm'],
      ['dotnet:10', 'dotnet:10-warm'],
      ['ruby:3.3', 'ruby:3.3-warm'],
      ['php:8.3', 'php:8.3-warm'],
    ] as const;
    for (const [askedFor, expectedPro] of cases) {
      expect(r.resolve(askedFor).image).toBe(`registry.rehearse.sh/${expectedPro}`);
    }
  });
});
