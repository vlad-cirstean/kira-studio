-- P145 §3.1: ade facts memory. Branch tip last seen fully contained in a target / environment
-- (stale detection git alone cannot answer); recorded = 1 only via RecordMerge. Env state backs
-- the deploy script results. The prepare timeout moves to the shared git_repo_settings leaf.
CREATE TABLE ade_branch_marks (
  branch_id TEXT NOT NULL REFERENCES ade_task_branches (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('target','env')),
  name TEXT NOT NULL,
  merged_tip TEXT NOT NULL,
  recorded INTEGER NOT NULL DEFAULT 0 CHECK (recorded IN (0,1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (branch_id, kind, name)
);
CREATE TABLE ade_env_state (
  code_repo_id TEXT NOT NULL,
  env TEXT NOT NULL,
  sha TEXT NOT NULL DEFAULT '', prev_sha TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '', checked_at INTEGER NOT NULL,
  PRIMARY KEY (code_repo_id, env),
  FOREIGN KEY (code_repo_id, env) REFERENCES ade_repo_envs (code_repo_id, name) ON DELETE CASCADE
);
ALTER TABLE ade_repo_config DROP COLUMN prepare_timeout;
