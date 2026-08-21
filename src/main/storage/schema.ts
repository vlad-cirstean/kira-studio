import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Single source of truth for the schema (Step 13b). Migrations are generated from this file by
// drizzle-kit (`bun run db:generate`), so FKs, defaults and indexes must be declared here — they
// are no longer hand-written in a raw .sql bootstrap. `mode: 'boolean'` maps the INTEGER 0/1
// columns to booleans so the storage modules never sprinkle `? 1 : 0`.

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

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
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const connectionFilters = sqliteTable(
  'connection_filters',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    nodeKind: text('node_kind').notNull(),
    pattern: text('pattern').notNull(),
    isRegex: integer('is_regex', { mode: 'boolean' }).notNull().default(false),
    action: text('action').notNull(),
  },
  (t) => [index('connection_filters_connection_id').on(t.connectionId)],
);

export const savedQueries = sqliteTable(
  'saved_queries',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
    usedAt: text('used_at'),
  },
  (t) => [index('saved_queries_connection_path').on(t.connectionId, t.path)],
);

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
  (t) => [uniqueIndex('metadata_cache_connection_path').on(t.connectionId, t.path)],
);

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
  (t) => [index('op_log_started_at').on(t.startedAt)],
);

export const uiLayout = sqliteTable('ui_layout', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const tabs = sqliteTable(
  'tabs',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').references(() => connections.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    kind: text('kind').notNull(),
    stateJson: text('state_json').notNull(),
    order: integer('order').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('tabs_order').on(t.order)],
);
