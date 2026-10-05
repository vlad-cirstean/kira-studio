-- P150: review windows, the per-task review agent and the GitHub viewed-sync ledger.
ALTER TABLE ade_sessions ADD COLUMN purpose TEXT NOT NULL DEFAULT '' CHECK (purpose IN ('', 'review'));
CREATE UNIQUE INDEX ade_sessions_review ON ade_sessions (task_id) WHERE purpose = 'review';
CREATE TABLE ade_review_windows (
  window_key TEXT PRIMARY KEY REFERENCES windows (key) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES ade_tasks (id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL UNIQUE REFERENCES ade_task_branches (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE ade_gh_synced (
  branch_id TEXT NOT NULL REFERENCES ade_task_branches (id) ON DELETE CASCADE,
  path TEXT NOT NULL, pr_number INTEGER NOT NULL, marked_at INTEGER NOT NULL,
  PRIMARY KEY (branch_id, path)
);
