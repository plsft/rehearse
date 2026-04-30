import { createDB } from '@gitgate/db';
import {
  agentActivityLog,
  agentLeaderboardSnapshots,
  mergeConfidenceScores,
  orgs,
} from '@gitgate/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import type { Env } from '../env.js';

const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;

export async function runLeaderboardSnapshot(env: Env): Promise<void> {
  const db = createDB(env.DB);
  const allOrgs = await db.select().from(orgs);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - NINETY_DAYS_SECONDS;

  for (const org of allOrgs) {
    const activity = await db
      .select()
      .from(agentActivityLog)
      .where(and(eq(agentActivityLog.orgId, org.id), gte(agentActivityLog.timestamp, windowStart)));
    const scores = await db
      .select()
      .from(mergeConfidenceScores)
      .where(
        and(
          eq(mergeConfidenceScores.orgId, org.id),
          gte(mergeConfidenceScores.computedAt, windowStart),
          eq(mergeConfidenceScores.isAgentAuthored, 1),
        ),
      );

    const byProvider = new Map<string, typeof activity>();
    for (const a of activity) {
      const list = byProvider.get(a.agentProvider) ?? [];
      list.push(a);
      byProvider.set(a.agentProvider, list);
    }

    for (const [provider, events] of byProvider) {
      const opens = events.filter((e) => e.activityType === 'pr_opened').length;
      const merges = events.filter((e) => e.activityType === 'pr_merged').length;
      const mergeRate = opens > 0 ? merges / opens : 0;
      const providerScores = scores; // simplified: would join via PR provider
      const avgScore = providerScores.length > 0
        ? providerScores.reduce((s, r) => s + r.overallScore, 0) / providerScores.length
        : 0;
      const activityUnits = events.reduce((s, e) => s + e.activityUnits, 0);
      const efficiency = activityUnits > 0 ? merges / activityUnits : 0;

      await db.insert(agentLeaderboardSnapshots).values({
        id: crypto.randomUUID(),
        orgId: org.id,
        agentProvider: provider,
        windowStart,
        windowEnd: now,
        prsOpened: opens,
        prsMerged: merges,
        mergeRate,
        avgMergeConfidence: avgScore,
        avgRevisionCycles: 0,
        firstPassMergeRate: 0,
        avgTimeToMerge: 0,
        ciFirstPassRate: 0,
        activityUnits,
        efficiencyRatio: efficiency,
      });
    }
  }
}
