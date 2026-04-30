import { sql } from 'drizzle-orm';
import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const agentBudgets = sqliteTable('agent_budgets', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  scopeType: text('scope_type', { enum: ['org', 'repo', 'agent'] }).notNull(),
  scopeId: text('scope_id').notNull(),
  period: text('period', { enum: ['daily', 'weekly', 'monthly'] }).notNull(),
  limitUnits: real('limit_units').notNull(),
  costPerUnit: real('cost_per_unit'),
  alertThresholdPct: integer('alert_threshold_pct').notNull().default(80),
  enforcement: text('enforcement', { enum: ['alert', 'comment', 'block-check'] })
    .notNull()
    .default('alert'),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

export const agentBudgetUsage = sqliteTable(
  'agent_budget_usage',
  {
    budgetId: text('budget_id').notNull(),
    periodKey: text('period_key').notNull(),
    unitsConsumed: real('units_consumed').notNull().default(0),
    lastUpdated: integer('last_updated')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.budgetId, table.periodKey] }),
  }),
);

export type AgentBudgetRow = typeof agentBudgets.$inferSelect;
export type NewAgentBudgetRow = typeof agentBudgets.$inferInsert;
export type AgentBudgetUsageRow = typeof agentBudgetUsage.$inferSelect;
