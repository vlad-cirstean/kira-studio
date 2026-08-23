import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  color: text('color').notNull(),
  mode: text('mode').notNull(),
  readOnly: integer('read_only', { mode: 'boolean' }).notNull().default(false),
  host: text('host'),
  port: integer('port'),
  database: text('database'),
  username: text('username'),
  password: text('password'),
  uri: text('uri'),
  optionsJson: text('options_json'),
  preconnect: text('preconnect'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});
