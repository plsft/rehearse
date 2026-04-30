import { createDB } from '@gitgate/db';
import { governanceConfig, orgs, repos } from '@gitgate/db/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Env } from '../env.js';

const app = new Hono<{ Bindings: Env }>();

app.get('/:owner/:repo/status', async (c) => {
  const { owner, repo: repoName } = c.req.param();
  const db = createDB(c.env.DB);
  const repoRow = (
    await db.select().from(repos).where(eq(repos.githubFullName, `${owner}/${repoName}`)).limit(1)
  )[0];
  if (!repoRow) return c.json({ ok: false, error: { code: 'not_found' } }, 404);
  const org = (await db.select().from(orgs).where(eq(orgs.id, repoRow.orgId)).limit(1))[0];
  const repoCfg = (
    await db.select().from(governanceConfig).where(eq(governanceConfig.scopeId, repoRow.id)).limit(1)
  )[0];
  const orgCfg = org
    ? (await db.select().from(governanceConfig).where(eq(governanceConfig.scopeId, org.id)).limit(1))[0]
    : undefined;
  return c.json({
    ok: true,
    data: {
      repo: repoRow,
      org,
      orgConfig: orgCfg,
      repoConfig: repoCfg,
    },
  });
});

export default app;
