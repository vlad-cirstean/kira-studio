import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tabs = sqliteTable('tabs', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id'),
  path: text('path').notNull(),
  kind: text('kind').notNull(),
  stateJson: text('state_json').notNull(),
  order: integer('order').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
});
