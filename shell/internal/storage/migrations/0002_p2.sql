-- Saved filters are `saved_queries` rows with kind = 'filter' and a JSON `body` of
-- { where, orderBy }. `pinned` sorts them above the rest of a table's saved set (D19).
ALTER TABLE saved_queries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

-- History is a separate, evicting, unnamed ring — distinct from saved_queries.name's NOT NULL
-- lifecycle (D19). Capped at 20 rows per (connection_id, path) by the repo, not by SQL.
CREATE TABLE filter_history (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  where_text TEXT,
  order_by_json TEXT,
  used_at TEXT NOT NULL
);

CREATE INDEX filter_history_target ON filter_history(connection_id, path, used_at);
