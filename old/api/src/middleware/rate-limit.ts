import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env.js';

/** Crude per-IP rate limit using KV. */
export function rateLimit(opts: { limit: number; windowSeconds: number }): MiddlewareHandler<{
  Bindings: Env;
}> {
  return async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    const window = Math.floor(Date.now() / 1000 / opts.windowSeconds);
    const key = `rl:${ip}:${window}`;
    const current = Number((await c.env.CACHE.get(key)) ?? 0);
    if (current >= opts.limit) {
      return c.json(
        { ok: false, error: { code: 'rate_limited', message: 'Too many requests' } },
        429,
      );
    }
    await c.env.CACHE.put(key, String(current + 1), { expirationTtl: opts.windowSeconds + 5 });
    await next();
  };
}
