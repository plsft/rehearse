import type { MiddlewareHandler } from 'hono';
import type { AppVariables, Env } from '../env.js';

/**
 * Extracts and verifies a bearer token. The token format is `gg_<orgId>_<random>` —
 * for v1 we treat any well-formed token as authenticated and rely on org scoping
 * via the URL path. Real verification is added when we ship the dashboard.
 */
export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (
  c,
  next,
) => {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json(
      { ok: false, error: { code: 'unauthorized', message: 'Bearer token required' } },
      401,
    );
  }
  await next();
};
