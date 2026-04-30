import { createDB } from '@gitgate/db';
import { orgs, repos } from '@gitgate/db/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { GitHubAdapter } from '../adapters/github.js';
import type { Env } from '../env.js';
import { GitHubAppService } from '../services/github-app.js';
import { GitHubApi } from '../services/github-api.js';

const app = new Hono<{ Bindings: Env }>();

app.post('/', async (c) => {
  const appSvc = new GitHubAppService(c.env);
  const api = new GitHubApi(appSvc);
  const adapter = new GitHubAdapter(api, c.env.GITHUB_WEBHOOK_SECRET);
  let event;
  try {
    event = await adapter.parseWebhook(c.req.raw);
  } catch (err) {
    return c.json(
      { ok: false, error: { code: 'invalid_signature', message: (err as Error).message } },
      401,
    );
  }

  const db = createDB(c.env.DB);

  if (event.type === 'installation.created') {
    await ensureOrgAndRepos(db, event.data);
    return c.json({ ok: true, data: { installed: true } });
  }
  if (event.type === 'installation.deleted') {
    return c.json({ ok: true, data: { uninstalled: true } });
  }
  if (event.type === 'unknown') {
    return c.json({ ok: true, data: { ignored: event.data.eventName } });
  }

  const ev = event;
  const repoFull =
    ev.type === 'pr.review'
      ? `${ev.data.pr.org}/${ev.data.pr.repo}`
      : 'org' in ev.data
        ? `${(ev.data as { org: string }).org}/${(ev.data as { repo: string }).repo}`
        : '';
  if (!repoFull) return c.json({ ok: true, data: { skipped: 'no-repo' } });

  const id = c.env.REPO_ANALYZER.idFromName(repoFull);
  const stub = c.env.REPO_ANALYZER.get(id);
  const res = await stub.fetch('https://internal/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event: ev }),
  });
  return c.json({ ok: true, data: { handled: ev.type, status: res.status } });
});

async function ensureOrgAndRepos(
  db: ReturnType<typeof createDB>,
  data: { installationId: number; org: string; orgId: number; repos: Array<{ id: number; fullName: string; defaultBranch: string }> },
): Promise<void> {
  const existing = (
    await db.select().from(orgs).where(eq(orgs.githubOrgId, data.orgId)).limit(1)
  )[0];
  let orgId: string;
  if (existing) {
    orgId = existing.id;
  } else {
    orgId = `org_${data.org.toLowerCase()}`;
    await db.insert(orgs).values({
      id: orgId,
      githubOrgId: data.orgId,
      githubOrgLogin: data.org,
      displayName: data.org,
      installationId: data.installationId,
    });
  }
  for (const r of data.repos) {
    const exists = (
      await db.select().from(repos).where(eq(repos.githubRepoId, r.id)).limit(1)
    )[0];
    if (exists) continue;
    await db.insert(repos).values({
      id: `repo_${data.org.toLowerCase()}_${r.fullName.split('/')[1]!.replace(/[^a-z0-9]/gi, '_')}`,
      orgId,
      githubRepoId: r.id,
      githubFullName: r.fullName,
      defaultBranch: r.defaultBranch,
      monitoringEnabled: 1,
    });
  }
}

export default app;
