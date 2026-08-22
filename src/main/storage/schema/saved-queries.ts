import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const savedQueries = sqliteTable('saved_queries', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull(),
  path: text('path').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  body: text('body').notNull(),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  usedAt: text('used_at'),
});
