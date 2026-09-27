-- P129 Part 2 §2.1: the agent merge queue's own four tables. Item id = a branch's own short name,
-- or `nw:<uuid>` for new work not yet a branch — git forbids `:` in ref names, so the two id spaces
-- never collide, and ade_plan/ade_colors key on the item id alone with no separate type column.
CREATE TABLE ade_branches (
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  branch       TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('mine', 'review', 'parked')),
  name         TEXT NOT NULL DEFAULT '',   -- user title override
  draft_title  TEXT NOT NULL DEFAULT '',   -- carried from new work on rebind
  start_from   TEXT NOT NULL DEFAULT '',
  jira_key     TEXT NOT NULL DEFAULT '',
  jira_url     TEXT NOT NULL DEFAULT '',
  pr_url       TEXT NOT NULL DEFAULT '',   -- pasted link; live PR comes from RepoPrs
  est          TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',   -- Markdown
  added_at     INTEGER NOT NULL,
  had_commits  INTEGER NOT NULL DEFAULT 0,
  merged_at    INTEGER,
  archived_at  INTEGER,
  PRIMARY KEY (code_repo_id, branch)
);
CREATE TABLE ade_new_work (
  id           TEXT PRIMARY KEY,           -- 'nw:' || uuid
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT '',
  jira_key     TEXT NOT NULL DEFAULT '',
  jira_url     TEXT NOT NULL DEFAULT '',
  start_from   TEXT NOT NULL DEFAULT 'main',
  notes        TEXT NOT NULL DEFAULT '',
  est          TEXT NOT NULL DEFAULT '',
  branch_name  TEXT NOT NULL DEFAULT '',   -- optional name typed at launch (Part 4)
  created_at   INTEGER NOT NULL,
  archived_at  INTEGER,
  CHECK (title <> '' OR jira_key <> '')
);
CREATE INDEX ade_new_work_repo ON ade_new_work (code_repo_id);
CREATE TABLE ade_plan (
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  item         TEXT NOT NULL,
  day          TEXT,                       -- ISO date, NULL = Later
  position     INTEGER NOT NULL,
  queued_after TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (code_repo_id, item)
);
CREATE TABLE ade_colors (
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  item         TEXT NOT NULL,
  slot         INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 19),
  PRIMARY KEY (code_repo_id, item)
);
