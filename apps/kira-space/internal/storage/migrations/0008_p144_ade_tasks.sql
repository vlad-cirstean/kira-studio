-- P144 §3.1: ADE v2 task store. Only adds; v1 ade_* tables stay until P148 drops them.
CREATE TABLE ade_tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('task','review','parked')),
  title TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '',
  jira_key TEXT NOT NULL DEFAULT '', jira_url TEXT NOT NULL DEFAULT '',
  github_url TEXT NOT NULL DEFAULT '',
  workflow_id TEXT NOT NULL DEFAULT '', stage_id TEXT NOT NULL DEFAULT '',
  current_stage_json TEXT,                 -- NULL = none
  est TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  color INTEGER NOT NULL CHECK (color BETWEEN 0 AND 19),
  created_at INTEGER NOT NULL, archived_at INTEGER
);
CREATE TABLE ade_task_branches (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ade_tasks (id) ON DELETE CASCADE,
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',          -- '' = not created
  kind TEXT NOT NULL CHECK (kind IN ('mine','review','parked')),
  base TEXT NOT NULL DEFAULT '',          -- ref short name, '' = repo main
  queued_after TEXT NOT NULL DEFAULT '',  -- branch id
  position INTEGER NOT NULL,              -- order inside the task
  had_commits INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL, merged_at INTEGER, archived_at INTEGER
);
CREATE UNIQUE INDEX ade_task_branches_live_name ON ade_task_branches (code_repo_id, name)
  WHERE name <> '' AND archived_at IS NULL;
CREATE INDEX ade_task_branches_task ON ade_task_branches (task_id);
CREATE TABLE ade_task_plan (
  task_id TEXT PRIMARY KEY REFERENCES ade_tasks (id) ON DELETE CASCADE,
  day TEXT, position INTEGER NOT NULL      -- day NULL = Later
);
CREATE TABLE ade_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ade_tasks (id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL, step_id TEXT NOT NULL, branch_id TEXT NOT NULL DEFAULT '',
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  state TEXT NOT NULL CHECK (state IN ('pending','running','stuck','failed','back','done')),
  todo_done INTEGER, todo_total INTEGER, loops INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '', exit_code INTEGER,
  started_at INTEGER, finished_at INTEGER,
  CHECK ((todo_done IS NULL) = (todo_total IS NULL))
);
CREATE INDEX ade_runs_task ON ade_runs (task_id);
CREATE TABLE ade_backlog (
  id TEXT PRIMARY KEY, text TEXT NOT NULL CHECK (text <> ''), position INTEGER NOT NULL,
  jira_key TEXT NOT NULL DEFAULT '', jira_url TEXT NOT NULL DEFAULT '',
  github_url TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', added_at INTEGER NOT NULL
);
CREATE TABLE ade_repo_config (
  code_repo_id TEXT PRIMARY KEY REFERENCES code_repos (id) ON DELETE CASCADE,
  nickname TEXT NOT NULL DEFAULT '', prepare_timeout TEXT NOT NULL DEFAULT '10m',
  source TEXT NOT NULL DEFAULT 'added'    -- 'added' | folder path
);
CREATE TABLE ade_repo_integration (
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  branch TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (code_repo_id, branch)
);
CREATE TABLE ade_repo_envs (
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  name TEXT NOT NULL, deployed_sha_script TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL,
  PRIMARY KEY (code_repo_id, name)
);
CREATE TABLE ade_folders (path TEXT PRIMARY KEY, watch INTEGER NOT NULL DEFAULT 0);
CREATE TABLE ade_worktree_setup (
  branch_id TEXT PRIMARY KEY REFERENCES ade_task_branches (id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('running','ready','failed')),
  started_at INTEGER NOT NULL, finished_at INTEGER, exit_code INTEGER
);
CREATE TABLE ade_workflow_last_valid (
  file_name TEXT PRIMARY KEY, workflow_json TEXT NOT NULL, recorded_at INTEGER NOT NULL
);
