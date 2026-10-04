-- P148 (D5): drop the v1 ade queue tables and rebuild ade_sessions without the v1 columns. No data
-- migration; v1 session rows (task_id = '') are discarded.
DROP TABLE ade_blockers;
DROP TABLE ade_dependencies;
DROP TABLE ade_colors;
DROP TABLE ade_plan;
DROP TABLE ade_new_work;
DROP TABLE ade_branches;
CREATE TABLE ade_sessions_new (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'tui' CHECK (mode IN ('tui','headless')),
  task_id TEXT NOT NULL, branch_id TEXT NOT NULL DEFAULT '',
  stage_id TEXT NOT NULL DEFAULT '', step_id TEXT NOT NULL DEFAULT '', run_id TEXT NOT NULL DEFAULT '',
  resumes TEXT NOT NULL DEFAULT '',
  claude_session_id TEXT NOT NULL, cwd TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','stopped')),
  terminal_id TEXT, started_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL,
  CHECK (task_id <> '' AND (mode = 'tui' OR run_id <> ''))
);
INSERT INTO ade_sessions_new (id, mode, task_id, branch_id, stage_id, step_id, run_id, resumes,
  claude_session_id, cwd, state, terminal_id, started_at, last_active_at)
  SELECT id, mode, task_id, branch_id, stage_id, step_id, run_id, resumes,
    claude_session_id, cwd, state, terminal_id, started_at, last_active_at
  FROM ade_sessions WHERE task_id <> '';
DROP TABLE ade_sessions;
ALTER TABLE ade_sessions_new RENAME TO ade_sessions;
CREATE INDEX ade_sessions_task ON ade_sessions (task_id);
