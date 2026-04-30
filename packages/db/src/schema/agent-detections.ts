import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const agentDetections = sqliteTable(
  'agent_detections',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    repoId: text('repo_id').notNull(),
    prNumber: integer('pr_number').notNull(),
    detectedProvider: text('detected_provider').notNull(),
    confidence: text('confidence', { enum: ['high', 'medium', 'low'] }).notNull(),
    signals: text('signals').notNull(),
    labeled: integer('labeled').notNull().default(0),
    commented: integer('commented').notNull().default(0),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    repoPrIdx: index('idx_detections_repo').on(table.repoId, table.prNumber),
    repoPrUnique: unique().on(table.repoId, table.prNumber),
  }),
);

export type AgentDetection = typeof agentDetections.$inferSelect;
export type NewAgentDetection = typeof agentDetections.$inferInsert;
