import { createDB } from '@gitgate/db';
import { provenanceChains, repos } from '@gitgate/db/schema';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Env } from '../env.js';
import { ArtifactsClient } from '../services/artifacts-client.js';
import { recordEvent } from '../engine/provenance.js';

const app = new Hono<{ Bindings: Env }>();

app.get('/:owner/:repo/:pr', async (c) => {
  const { owner, repo: repoName, pr } = c.req.param();
  const prNumber = Number(pr);
  const db = createDB(c.env.DB);
  const fullName = `${owner}/${repoName}`;
  const repoRow = (await db.select().from(repos).where(eq(repos.githubFullName, fullName)).limit(1))[0];
  if (!repoRow) return c.json({ ok: false, error: { code: 'not_found', message: 'Repo not monitored' } }, 404);
  const chain = (
    await db
      .select()
      .from(provenanceChains)
      .where(and(eq(provenanceChains.repoId, repoRow.id), eq(provenanceChains.prNumber, prNumber)))
      .limit(1)
  )[0];
  if (!chain) return c.json({ ok: false, error: { code: 'not_found', message: 'No chain' } }, 404);
  const artifacts = new ArtifactsClient(c.env.ARTIFACTS);
  const exportToken = await artifacts.createExportToken(chain.artifactsRepoName, 60 * 60);
  return c.json({
    ok: true,
    data: {
      artifactsRepoName: chain.artifactsRepoName,
      eventCount: chain.eventCount,
      status: chain.status,
      cloneUrl: exportToken.cloneUrl,
      events: [],
    },
  });
});

app.post('/events', async (c) => {
  const body = (await c.req.json()) as {
    type: string;
    pr?: string | number;
    repo?: string;
    sha?: string;
    actor?: string;
    runId?: string;
    data?: Record<string, unknown>;
  };
  if (!body.type || !body.repo || !body.pr) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'type, repo, pr required' } }, 400);
  }
  const [owner, repoName] = body.repo.split('/');
  if (!owner || !repoName) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'repo must be "owner/name"' } }, 400);
  }
  const prNumber = Number(body.pr);
  const db = createDB(c.env.DB);
  const repoRow = (
    await db.select().from(repos).where(eq(repos.githubFullName, `${owner}/${repoName}`)).limit(1)
  )[0];
  if (!repoRow) return c.json({ ok: false, error: { code: 'not_found' } }, 404);
  const artifacts = new ArtifactsClient(c.env.ARTIFACTS);
  await recordEvent({
    db,
    artifacts,
    orgId: repoRow.orgId,
    repoId: repoRow.id,
    prNumber,
    event: {
      type: body.type,
      actor: body.actor ?? 'ci',
      actorType: 'system',
      data: { sha: body.sha, runId: body.runId, ...(body.data ?? {}) },
      timestamp: Math.floor(Date.now() / 1000),
    },
  });
  return c.json({ ok: true, data: { recorded: true } });
});

export default app;
