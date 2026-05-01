import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const provenanceChains = sqliteTable(
  'provenance_chains',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    repoId: text('repo_id').notNull(),
    prNumber: integer('pr_number').notNull(),
    agentProvider: text('agent_provider').notNull(),
    artifactsRepoName: text('artifacts_repo_name').notNull(),
    eventCount: integer('event_count').notNull().default(0),
    status: text('status', { enum: ['open', 'sealed'] })
      .notNull()
      .default('open'),
    openedAt: integer('opened_at')
      .notNull()
      .default(sql`(unixepoch())`),
    sealedAt: integer('sealed_at'),
  },
  (table) => ({
    repoPrIdx: index('idx_provenance_repo').on(table.repoId, table.prNumber),
    repoPrUnique: unique().on(table.repoId, table.prNumber),
  }),
);

export type ProvenanceChain = typeof provenanceChains.$inferSelect;
export type NewProvenanceChain = typeof provenanceChains.$inferInsert;
