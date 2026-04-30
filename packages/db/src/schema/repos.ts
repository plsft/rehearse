import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { orgs } from './orgs.js';

export const repos = sqliteTable(
  'repos',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    githubRepoId: integer('github_repo_id').notNull().unique(),
    githubFullName: text('github_full_name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    monitoringEnabled: integer('monitoring_enabled').notNull().default(1),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    orgIdx: index('idx_repos_org').on(table.orgId),
  }),
);

export type Repo = typeof repos.$inferSelect;
export type NewRepo = typeof repos.$inferInsert;
