import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import type { AppVariables, Env } from './env.js';
import githubWebhooks from './routes/github-webhooks.js';
import apiConfidence from './routes/api-confidence.js';
import apiProvenance from './routes/api-provenance.js';
import apiBudgets from './routes/api-budgets.js';
import apiLeaderboard from './routes/api-leaderboard.js';
import apiConfig from './routes/api-config.js';
import { runLeaderboardSnapshot } from './engine/leaderboard.js';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use('*', logger());
app.use('/v1/*', cors({ origin: ['https://gitgate.com', 'https://app.gitgate.com'] }));

app.get('/', (c) => c.json({ ok: true, service: 'gitgate-api', version: '0.1.0' }));
app.get('/health', (c) => c.json({ ok: true }));

app.route('/webhooks/github', githubWebhooks);
app.route('/v1/confidence', apiConfidence);
app.route('/v1/provenance', apiProvenance);
app.route('/v1/budgets', apiBudgets);
app.route('/v1/leaderboard', apiLeaderboard);
app.route('/v1/governance', apiConfig);

app.notFound((c) => c.json({ ok: false, error: { code: 'not_found', message: 'Route not found' } }, 404));

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    { ok: false, error: { code: 'internal', message: 'Internal server error' } },
    500,
  );
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runLeaderboardSnapshot(env));
  },
};

export { RepoAnalyzer } from './durable-objects/repo-analyzer.js';
