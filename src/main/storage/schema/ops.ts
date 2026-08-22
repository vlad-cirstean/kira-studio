import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { connections } from './connections';

export const opLog = sqliteTable(
  'op_log',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').references(() => connections.id, { onDelete: 'set null' }),
    tabId: text('tab_id'),
    startedAt: text('started_at').notNull(),
    durationMs: integer('duration_ms'),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    rows: integer('rows'),
    command: text('command'),
    error: text('error'),
  },
  (table) => [index('op_log_started_at').on(table.startedAt)],
);
