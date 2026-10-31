-- P415: persisted operation log (git spawns, agent sessions, in-app MCP calls). Foreground rows
-- and failed background rows; pruned to 30 days / 5000 rows at start and every 500 finished ops.
CREATE TABLE op_log (
  id TEXT PRIMARY KEY,
  started_ms INTEGER NOT NULL,
  duration_ms INTEGER,
  category TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  module TEXT NOT NULL,
  trigger_ TEXT NOT NULL,
  source TEXT NOT NULL,
  subject TEXT NOT NULL,
  repo_root TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  task_id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  command TEXT,
  error TEXT,
  steps_json TEXT NOT NULL,
  steps_dropped INTEGER NOT NULL DEFAULT 0,
  background INTEGER NOT NULL DEFAULT 0,
  repeat_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX op_log_started_ms ON op_log (started_ms);
