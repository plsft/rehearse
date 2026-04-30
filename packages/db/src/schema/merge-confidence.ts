import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const mergeConfidenceScores = sqliteTable(
  'merge_confidence_scores',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    repoId: text('repo_id').notNull(),
    prNumber: integer('pr_number').notNull(),
    overallScore: integer('overall_score').notNull(),
    testHealth: integer('test_health').notNull(),
    scopeContainment: integer('scope_containment').notNull(),
    reviewDepth: integer('review_depth').notNull(),
    agentTrust: integer('agent_trust').notNull(),
    sizeDiscipline: integer('size_discipline').notNull(),
    provenanceQuality: integer('provenance_quality').notNull(),
    weightsSnapshot: text('weights_snapshot').notNull(),
    isAgentAuthored: integer('is_agent_authored').notNull().default(0),
    githubCheckRunId: text('github_check_run_id'),
    version: integer('version').notNull().default(1),
    computedAt: integer('computed_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    repoPrIdx: index('idx_scores_repo_pr').on(table.repoId, table.prNumber),
  }),
);

export type MergeConfidenceScoreRow = typeof mergeConfidenceScores.$inferSelect;
export type NewMergeConfidenceScoreRow = typeof mergeConfidenceScores.$inferInsert;
