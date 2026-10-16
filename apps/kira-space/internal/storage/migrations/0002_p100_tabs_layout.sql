-- P100 Part 2: adds the two tables 0001_init.sql's own header comment deferred — this phase's
-- frontend is the first consumer of either. Carried over from Kira Studio's own
-- 0001_init.sql (ui_layout/tabs) and 0002_p8_windows.sql (window_key scoping), minus every column
-- neither table needs here: no `operations`/`cellEditor` panel leaves (this app has no
-- DB-results-grid or cell-editor concept), no `connection_id` on tabs (no connections concept).

CREATE TABLE ui_layout (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- window_key scopes ownership (Kira Studio's own F6 fix, carried straight into this table's first
-- shape rather than added later); workspace_id is required for every row here since every tab kind
-- this app has is scoped to a repository (model.TabRecord.Validate's own rule) — unlike Kira
-- Studio's own `tabs.workspace_id`, which is nullable for its studio/api tabs.
CREATE TABLE tabs (
  id           TEXT PRIMARY KEY,
  path         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  state_json   TEXT NOT NULL,
  "order"      INTEGER NOT NULL,
  active       INTEGER NOT NULL,
  window_key   TEXT NOT NULL REFERENCES windows(key) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL
);

CREATE INDEX tabs_window ON tabs (window_key, "order");
