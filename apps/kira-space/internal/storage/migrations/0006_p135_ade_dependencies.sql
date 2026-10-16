-- P135: external waits (a vendor reply, another team's release). Never a branch: no git facts, no
-- plan row, no colour slot. Id 'dep:' || uuid (git bans ':' in refs, so no collision with a branch).
CREATE TABLE ade_dependencies (
  id           TEXT PRIMARY KEY,
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (title <> ''),
  waiting_on   TEXT NOT NULL DEFAULT '',   -- free text, Markdown not rendered
  expected_by  TEXT,                       -- ISO date, NULL = none
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);
CREATE INDEX ade_dependencies_repo ON ade_dependencies (code_repo_id);
-- item is a branch name or 'nw:' id; no FK (two target tables), checked in the repo layer.
CREATE TABLE ade_blockers (
  code_repo_id TEXT NOT NULL REFERENCES code_repos (id) ON DELETE CASCADE,
  dependency   TEXT NOT NULL REFERENCES ade_dependencies (id) ON DELETE CASCADE,
  item         TEXT NOT NULL,
  PRIMARY KEY (code_repo_id, dependency, item)
);
CREATE INDEX ade_blockers_item ON ade_blockers (code_repo_id, item);
