import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const orgs = sqliteTable('orgs', {
  id: text('id').primaryKey(),
  githubOrgId: integer('github_org_id').notNull().unique(),
  githubOrgLogin: text('github_org_login').notNull().unique(),
  displayName: text('display_name').notNull(),
  plan: text('plan', { enum: ['free', 'team', 'enterprise'] })
    .notNull()
    .default('free'),
  installationId: integer('installation_id'),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Org = typeof orgs.$inferSelect;
export type NewOrg = typeof orgs.$inferInsert;
