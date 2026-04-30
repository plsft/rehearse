import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const agentLeaderboardSnapshots = sqliteTable(
  'agent_leaderboard_snapshots',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    agentProvider: text('agent_provider').notNull(),
    windowStart: integer('window_start').notNull(),
    windowEnd: integer('window_end').notNull(),
    prsOpened: integer('prs_opened').notNull().default(0),
    prsMerged: integer('prs_merged').notNull().default(0),
    mergeRate: real('merge_rate'),
    avgMergeConfidence: real('avg_merge_confidence'),
    avgRevisionCycles: real('avg_revision_cycles'),
    firstPassMergeRate: real('first_pass_merge_rate'),
    avgTimeToMerge: integer('avg_time_to_merge'),
    ciFirstPassRate: real('ci_first_pass_rate'),
    activityUnits: real('activity_units'),
    efficiencyRatio: real('efficiency_ratio'),
    computedAt: integer('computed_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    orgIdx: index('idx_leaderboard_org').on(table.orgId, table.computedAt),
  }),
);

export type LeaderboardSnapshot = typeof agentLeaderboardSnapshots.$inferSelect;
export type NewLeaderboardSnapshot = typeof agentLeaderboardSnapshots.$inferInsert;
