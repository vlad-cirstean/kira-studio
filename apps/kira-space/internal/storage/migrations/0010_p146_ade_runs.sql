-- P146: ade_sessions gains task-level and headless rows; v1 rows copied (task_id = '').
CREATE TABLE ade_sessions_new (
  id TEXT PRIMARY KEY,
  code_repo_id TEXT REFERENCES code_repos (id) ON DELETE CASCADE,  -- NULL for task-level rows
  branch TEXT NOT NULL DEFAULT '', new_work_id TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'tui' CHECK (mode IN ('tui','headless')),
  task_id TEXT NOT NULL DEFAULT '', branch_id TEXT NOT NULL DEFAULT '',
  stage_id TEXT NOT NULL DEFAULT '', step_id TEXT NOT NULL DEFAULT '', run_id TEXT NOT NULL DEFAULT '',
  resumes TEXT NOT NULL DEFAULT '',
  claude_session_id TEXT NOT NULL, cwd TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','stopped')),
  terminal_id TEXT, started_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL,
  CHECK (
    (task_id = '' AND mode = 'tui' AND code_repo_id IS NOT NULL AND (branch = '') <> (new_work_id = ''))
    OR (task_id <> '' AND branch = '' AND new_work_id = '' AND (mode = 'tui' OR run_id <> ''))
  )
);
INSERT INTO ade_sessions_new (id, code_repo_id, branch, new_work_id, claude_session_id, cwd, state,
  terminal_id, started_at, last_active_at)
  SELECT id, code_repo_id, branch, new_work_id, claude_session_id, cwd, state, terminal_id,
    started_at, last_active_at FROM ade_sessions;
DROP TABLE ade_sessions;
ALTER TABLE ade_sessions_new RENAME TO ade_sessions;
CREATE INDEX ade_sessions_repo ON ade_sessions (code_repo_id);
CREATE INDEX ade_sessions_task ON ade_sessions (task_id);
-- run log (id = run id) and worktree setup log (id = branch id); tail kept, see truncated.
CREATE TABLE ade_logs (
  kind TEXT NOT NULL CHECK (kind IN ('run','setup')), id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES ade_tasks (id) ON DELETE CASCADE,
  next_seq INTEGER NOT NULL DEFAULT 1, bytes INTEGER NOT NULL DEFAULT 0,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
  PRIMARY KEY (kind, id)
);
CREATE TABLE ade_log_chunks (
  kind TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL,
  at INTEGER NOT NULL, stream TEXT NOT NULL CHECK (stream IN ('stdout','stderr','event')),
  text TEXT NOT NULL,
  PRIMARY KEY (kind, id, seq),
  FOREIGN KEY (kind, id) REFERENCES ade_logs (kind, id) ON DELETE CASCADE
);
CREATE INDEX ade_runs_state ON ade_runs (state);
