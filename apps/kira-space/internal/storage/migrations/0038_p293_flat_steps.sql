-- P293: flat workflow steps. A task no longer sits in a stage: ade_tasks keeps the step it last entered
-- (entry_step_id) and the pass watermark (since_json). ADE task data is reset (no installed base to keep).
-- Children are deleted before parents so the result does not depend on the foreign key pragma.
DELETE FROM windows WHERE key IN (SELECT window_key FROM ade_review_windows);
DELETE FROM ade_review_windows;
DELETE FROM ade_gh_synced;
DELETE FROM ade_branch_marks;
DELETE FROM ade_worktree_setup;
DELETE FROM ade_log_chunks;
DELETE FROM ade_logs;
DELETE FROM ade_task_plan;
DELETE FROM ade_task_branches;

-- Runs and sessions lose stage_id. SQLite cannot DROP COLUMN under their CHECKs (precedent 0015), so
-- the emptied tables are recreated.
DROP TABLE ade_run_sandbox;
DROP TABLE ade_reviews;
DROP TABLE ade_runs;
DELETE FROM ade_tasks;
DELETE FROM ade_workflow_last_valid;

CREATE TABLE ade_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ade_tasks (id) ON DELETE CASCADE,
  step_id TEXT NOT NULL, branch_id TEXT NOT NULL DEFAULT '',
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  state TEXT NOT NULL CHECK (state IN ('pending','running','stuck','failed','back','done','review')),
  loops INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '', exit_code INTEGER,
  started_at INTEGER, finished_at INTEGER,
  launch_note TEXT NOT NULL DEFAULT '', launch_resume_id TEXT NOT NULL DEFAULT '',
  launch_prompt TEXT NOT NULL DEFAULT '', launch_extra TEXT NOT NULL DEFAULT '',
  outcome_json TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '' CHECK (purpose IN ('', 'rebase', 'review')),
  spec_json TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ade_runs_task ON ade_runs (task_id);
CREATE INDEX ade_runs_state ON ade_runs (state);
CREATE INDEX ade_runs_branch_purpose ON ade_runs (branch_id, purpose);

CREATE TABLE ade_reviews (
  run_id TEXT PRIMARY KEY REFERENCES ade_runs (id) ON DELETE CASCADE,
  route TEXT NOT NULL CHECK (route IN ('implementer', 'new')),
  target_run_id TEXT NOT NULL DEFAULT '',
  dedicated_claude_id TEXT NOT NULL DEFAULT '',
  rounds INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ade_run_sandbox (
  run_id TEXT PRIMARY KEY REFERENCES ade_runs (id) ON DELETE CASCADE,
  access TEXT NOT NULL CHECK (access IN ('write', 'read', 'off')),
  enforced INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  policy_json TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  denial_count INTEGER NOT NULL DEFAULT 0,
  denials_json TEXT NOT NULL DEFAULT '[]'
);

DROP TABLE ade_sessions;
CREATE TABLE ade_sessions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'tui' CHECK (mode IN ('tui','headless')),
  task_id TEXT NOT NULL, branch_id TEXT NOT NULL DEFAULT '',
  step_id TEXT NOT NULL DEFAULT '', run_id TEXT NOT NULL DEFAULT '',
  resumes TEXT NOT NULL DEFAULT '',
  claude_session_id TEXT NOT NULL, cwd TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','stopped')),
  terminal_id TEXT, started_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL, purpose TEXT NOT NULL DEFAULT '' CHECK (purpose IN ('', 'review')),
  CHECK (task_id <> '' AND (mode = 'tui' OR run_id <> ''))
);
CREATE INDEX ade_sessions_task ON ade_sessions (task_id);
CREATE UNIQUE INDEX ade_sessions_review ON ade_sessions (task_id) WHERE purpose = 'review';

ALTER TABLE ade_tasks RENAME COLUMN stage_id TO entry_step_id;
ALTER TABLE ade_tasks RENAME COLUMN current_stage_json TO since_json;
