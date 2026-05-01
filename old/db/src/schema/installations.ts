import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { orgs } from './orgs.js';

export const installations = sqliteTable('installations', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => orgs.id),
  githubInstallationId: integer('github_installation_id').notNull().unique(),
  accessToken: text('access_token'),
  accessTokenExpiresAt: integer('access_token_expires_at'),
  permissions: text('permissions').notNull(),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Installation = typeof installations.$inferSelect;
export type NewInstallation = typeof installations.$inferInsert;
