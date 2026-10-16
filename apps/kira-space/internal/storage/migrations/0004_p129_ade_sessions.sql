-- P129 Part 1 §4.7: one row per Claude Code session this app's own ade.Tracker spawned or resumed,
-- keyed on our own id (never the mutable Claude session id, which changes across a /clear). Exactly
-- one of branch/new_work_id is set — a session launched against a plain branch checkout carries no
-- new-work id, one launched for a not-yet-a-branch piece of work carries no branch, and the CHECK
-- below refuses a row that is both or neither. terminal_id is nullable: a stopped session (the
-- terminal closed, or Reconcile noticed it exit) still carries its own history row, just with no
-- live terminal to point at.
CREATE TABLE ade_sessions (
  id                TEXT PRIMARY KEY,
  code_repo_id      TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  branch            TEXT NOT NULL DEFAULT '',
  new_work_id       TEXT NOT NULL DEFAULT '',
  claude_session_id TEXT NOT NULL,
  cwd               TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN ('running', 'stopped')),
  terminal_id       TEXT,
  started_at        INTEGER NOT NULL,
  last_active_at    INTEGER NOT NULL,
  CHECK ((branch = '') <> (new_work_id = ''))
);
CREATE INDEX ade_sessions_repo ON ade_sessions (code_repo_id);
