import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const governanceConfig = sqliteTable('governance_config', {
  scopeId: text('scope_id').primaryKey(),
  scopeType: text('scope_type', { enum: ['org', 'repo'] }).notNull(),
  confidenceWeights: text('confidence_weights'),
  confidenceMinimum: integer('confidence_minimum'),
  sizeThresholds: text('size_thresholds'),
  scopeMappings: text('scope_mappings'),
  applyToHumanPrs: integer('apply_to_human_prs').notNull().default(1),
  detectionEnabled: integer('detection_enabled').notNull().default(1),
  detectionLabelFormat: text('detection_label_format').default('agent:{provider}'),
  detectionPostComment: integer('detection_post_comment').notNull().default(1),
  provenanceEnabled: integer('provenance_enabled').notNull().default(1),
  exemptBots: text('exempt_bots'),
  updatedAt: integer('updated_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

export type GovernanceConfigRow = typeof governanceConfig.$inferSelect;
export type NewGovernanceConfigRow = typeof governanceConfig.$inferInsert;
