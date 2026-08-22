-- schema_version is created and seeded by storage/migrate.ts, not here (forward-only bootstrap).

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  color TEXT NOT NULL,
  mode TEXT NOT NULL,
  read_only INTEGER NOT NULL DEFAULT 0,
  host TEXT,
  port INTEGER,
  database TEXT,
  username TEXT,
  password TEXT,
  uri TEXT,
  options_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE connection_filters (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  node_kind TEXT NOT NULL,
  pattern TEXT NOT NULL,
  is_regex INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL
);

CREATE TABLE saved_queries (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE metadata_cache (
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  etag TEXT
);

CREATE TABLE op_log (
  id TEXT PRIMARY KEY,
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  tab_id TEXT,
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  rows INTEGER,
  command TEXT,
  error TEXT
);

CREATE TABLE ui_layout (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE tabs (
  id TEXT PRIMARY KEY,
  connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  state_json TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX metadata_cache_connection_path ON metadata_cache(connection_id, path);
CREATE INDEX op_log_started_at ON op_log(started_at);
CREATE INDEX saved_queries_connection_path ON saved_queries(connection_id, path);
CREATE INDEX tabs_order ON tabs("order");
CREATE INDEX connection_filters_connection_id ON connection_filters(connection_id);
