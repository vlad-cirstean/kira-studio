-- P409: artifacts agents and the user report for a task. Detected artifacts (PRs, branches,
-- deployments, task links) are derived on read and never stored here.
CREATE TABLE ade_task_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ade_tasks (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('changeRequest', 'issue', 'deployment', 'doc', 'link')),
  title TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('agent', 'user')),
  step_id TEXT NOT NULL DEFAULT '',
  run_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (url <> '' OR ref <> '')
);
CREATE UNIQUE INDEX ade_task_artifacts_url ON ade_task_artifacts (task_id, url) WHERE url <> '';
CREATE INDEX ade_task_artifacts_task ON ade_task_artifacts (task_id, created_at);
