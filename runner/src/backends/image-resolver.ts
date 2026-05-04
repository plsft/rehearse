/**
 * Pro image resolver.
 *
 * If the user has a Rehearse Pro token (env var REHEARSE_TOKEN), known
 * language base images get rewritten to their warmed Pro variant on
 * registry.rehearse.sh. Anything else is passed through unchanged.
 *
 * Failure mode is silent fallback: if the Pro registry is unreachable, the
 * token is invalid, or the requested image isn't in our catalog, we use the
 * original public image. CI must not fail because of Pro.
 */

import { spawnSync } from 'node:child_process';

const PRO_REGISTRY = 'registry.rehearse.sh';

// Bare versions known to have a `<lang>:<version>-warm` variant in the v0
// Pro catalog. Anything outside this set falls through to public Docker Hub.
const KNOWN_LANGS = new Set([
  'node',
  'python',
  'bun',
  'go',
  'java',
  'dotnet',
  'ruby',
  'php',
]);

const KNOWN_PRO_REFS = new Set([
  'node:20-warm',
  'node:20-postgres-warm',
  'python:3.12-warm',
  'python:3.12-postgres-warm',
  'bun:1-warm',
  'go:1.24-warm',
  'java:21-warm',
  'dotnet:10-warm',
  'ruby:3.3-warm',
  'php:8.3-warm',
]);

export interface ResolvedImage {
  /** The image reference to actually pull. */
  image: string;
  /** 'pro' if rewritten to registry.rehearse.sh, 'public' if passthrough. */
  source: 'pro' | 'public';
  /** Auth to log in with before pulling, if any. */
  auth?: { registry: string; username: string; password: string };
}

export interface ResolverConfig {
  token?: string | undefined;
  /** Project-level overrides: { 'node:20': 'node:20-postgres-warm' } */
  mapping?: Record<string, string> | undefined;
  /** If false, never rewrite even with a token (for testing). Default true. */
  enabled?: boolean | undefined;
}

export function createImageResolver(cfg: ResolverConfig = {}): {
  resolve: (ref: string) => ResolvedImage;
} {
  const enabled = cfg.enabled !== false;
  const token = cfg.token ?? process.env.REHEARSE_TOKEN;
  const mapping = cfg.mapping ?? {};

  return {
    resolve(ref: string): ResolvedImage {
      if (!enabled || !token) return { image: ref, source: 'public' };

      const proRef = mapping[ref] ?? defaultProMapping(ref);
      if (!proRef) return { image: ref, source: 'public' };

      return {
        image: `${PRO_REGISTRY}/${proRef}`,
        source: 'pro',
        auth: { registry: PRO_REGISTRY, username: 'rehearse', password: token },
      };
    },
  };
}

function defaultProMapping(ref: string): string | null {
  // Already a Pro ref (e.g. someone wrote `node:20-warm` directly): pass through.
  if (KNOWN_PRO_REFS.has(ref)) return ref;

  const parts = ref.split(':');
  if (parts.length !== 2) return null;
  const [name, tag] = parts as [string, string];

  if (!KNOWN_LANGS.has(name)) return null;
  // Only auto-warm bare numeric versions like `node:20`, `python:3.12`,
  // `dotnet:10`. Anything with a -slim/-bookworm/-alpine suffix is
  // intentionally specific and we don't have a Pro variant.
  if (!/^\d+(\.\d+)*$/.test(tag)) return null;

  const candidate = `${name}:${tag}-warm`;
  if (!KNOWN_PRO_REFS.has(candidate)) return null;
  return candidate;
}

/**
 * Best-effort `docker login` for a registry. Returns true on success, false
 * on any failure. Caller can then decide to fall back to public.
 */
export function dockerLogin(auth: NonNullable<ResolvedImage['auth']>): boolean {
  const r = spawnSync(
    'docker',
    ['login', auth.registry, '-u', auth.username, '--password-stdin'],
    { input: auth.password, encoding: 'utf-8' },
  );
  return r.status === 0;
}
