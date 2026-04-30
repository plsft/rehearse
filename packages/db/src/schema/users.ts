import { sql } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { orgs } from './orgs.js';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  githubUserId: integer('github_user_id').notNull().unique(),
  githubLogin: text('github_login').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  email: text('email'),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

export const orgMembers = sqliteTable(
  'org_members',
  {
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ['owner', 'admin', 'member'] })
      .notNull()
      .default('member'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.orgId, table.userId] }),
  }),
);

export type User = typeof users.$inferSelect;
export type OrgMember = typeof orgMembers.$inferSelect;
