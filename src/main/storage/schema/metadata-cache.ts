import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { connections } from './connections';

export const metadataCache = sqliteTable(
  'metadata_cache',
  {
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    kind: text('kind').notNull(),
    payloadJson: text('payload_json').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    etag: text('etag'),
  },
  (table) => [uniqueIndex('metadata_cache_connection_path').on(table.connectionId, table.path)],
);
