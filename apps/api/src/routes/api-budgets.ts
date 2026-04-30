import { createDB } from '@gitgate/db';
import { agentBudgetUsage, agentBudgets, orgs } from '@gitgate/db/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Env } from '../env.js';

const app = new Hono<{ Bindings: Env }>();

app.get('/:org', async (c) => {
  const orgLogin = c.req.param('org');
  const db = createDB(c.env.DB);
  const org = (await db.select().from(orgs).where(eq(orgs.githubOrgLogin, orgLogin)).limit(1))[0];
  if (!org) return c.json({ ok: false, error: { code: 'not_found' } }, 404);
  const budgets = await db.select().from(agentBudgets).where(eq(agentBudgets.orgId, org.id));
  const data = await Promise.all(
    budgets.map(async (b) => {
      const usage = await db.select().from(agentBudgetUsage).where(eq(agentBudgetUsage.budgetId, b.id));
      return { budget: b, usage };
    }),
  );
  return c.json({ ok: true, data });
});

export default app;
