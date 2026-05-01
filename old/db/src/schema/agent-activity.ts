import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const agentIdentities = sqliteTable(
  'agent_identities',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    provider: text('provider').notNull(),
    matchRules: text('match_rules').notNull(),
    status: text('status', { enum: ['active', 'paused'] })
      .notNull()
      .default('active'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    orgIdx: index('idx_agents_org').on(table.orgId),
  }),
);

export const agentActivityLog = sqliteTable(
  'agent_activity_log',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    agentProvider: text('agent_provider').notNull(),
    repoId: text('repo_id').notNull(),
    prNumber: integer('pr_number'),
    activityType: text('activity_type').notNull(),
    activityUnits: real('activity_units').notNull(),
    metadata: text('metadata'),
    periodKey: text('period_key').notNull(),
    timestamp: integer('timestamp')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    orgIdx: index('idx_activity_org').on(table.orgId, table.timestamp),
    agentIdx: index('idx_activity_agent').on(table.agentProvider, table.orgId, table.periodKey),
  }),
);

export type AgentIdentityRow = typeof agentIdentities.$inferSelect;
export type AgentActivityRow = typeof agentActivityLog.$inferSelect;
export type NewAgentActivityRow = typeof agentActivityLog.$inferInsert;
