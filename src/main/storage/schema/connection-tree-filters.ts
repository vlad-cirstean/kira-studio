import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { connections } from './connections';

// P28 D12: replaces connection_filters (rule list) — a set has neither a synthetic id nor an
// order, so this table has neither.
export const connectionTreeFilters = sqliteTable(
  'connection_tree_filters',
  {
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(), // 'kind' | 'path'
    value: text('value').notNull(),
  },
  (table) => [primaryKey({ columns: [table.connectionId, table.scope, table.value] })],
);
