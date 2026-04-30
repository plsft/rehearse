import { createDB } from '@gitgate/db';
import { mergeConfidenceScores, repos } from '@gitgate/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Env } from '../env.js';

const app = new Hono<{ Bindings: Env }>();

app.get('/:owner/:repo/:pr', async (c) => {
  const { owner, repo: repoName, pr } = c.req.param();
  const prNumber = Number(pr);
  if (!Number.isInteger(prNumber)) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'pr must be an integer' } }, 400);
  }
  const db = createDB(c.env.DB);
  const fullName = `${owner}/${repoName}`;
  const repoRow = (await db.select().from(repos).where(eq(repos.githubFullName, fullName)).limit(1))[0];
  if (!repoRow) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'Repo not monitored' } }, 404);
  }
  const score = (
    await db
      .select()
      .from(mergeConfidenceScores)
      .where(
        and(
          eq(mergeConfidenceScores.repoId, repoRow.id),
          eq(mergeConfidenceScores.prNumber, prNumber),
        ),
      )
      .orderBy(desc(mergeConfidenceScores.computedAt))
      .limit(1)
  )[0];
  if (!score) {
    return c.json({ ok: false, error: { code: 'not_found', message: 'No score yet' } }, 404);
  }
  return c.json({
    ok: true,
    data: {
      overall: score.overallScore,
      testHealth: score.testHealth,
      scopeContainment: score.scopeContainment,
      reviewDepth: score.reviewDepth,
      agentTrust: score.agentTrust,
      sizeDiscipline: score.sizeDiscipline,
      provenanceQuality: score.provenanceQuality,
      isAgentAuthored: !!score.isAgentAuthored,
      weights: JSON.parse(score.weightsSnapshot),
      computedAt: score.computedAt,
    },
  });
});

export default app;
