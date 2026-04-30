import { createDB } from '@gitgate/db';
import { agentLeaderboardSnapshots, orgs } from '@gitgate/db/schema';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Env } from '../env.js';

const app = new Hono<{ Bindings: Env }>();

app.get('/:org', async (c) => {
  const orgLogin = c.req.param('org');
  const db = createDB(c.env.DB);
  const org = (await db.select().from(orgs).where(eq(orgs.githubOrgLogin, orgLogin)).limit(1))[0];
  if (!org) return c.json({ ok: false, error: { code: 'not_found' } }, 404);
  const rows = await db
    .select()
    .from(agentLeaderboardSnapshots)
    .where(eq(agentLeaderboardSnapshots.orgId, org.id))
    .orderBy(desc(agentLeaderboardSnapshots.computedAt))
    .limit(50);
  return c.json({ ok: true, data: rows });
});

export default app;
