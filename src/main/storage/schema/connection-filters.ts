import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { connections } from './connections';

export const connectionFilters = sqliteTable('connection_filters', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id')
    .notNull()
    .references(() => connections.id, { onDelete: 'cascade' }),
  nodeKind: text('node_kind').notNull(),
  pattern: text('pattern').notNull(),
  isRegex: integer('is_regex', { mode: 'boolean' }).notNull().default(false),
  action: text('action').notNull(),
});
