-- schema_version is created and seeded by internal/sqlitex.Migrate, not here (forward-only
-- bootstrap) — see repo-root internal/sqlitex's own doc comment.
--
-- Kira Space's own database (its own kira.db, under its own home — never Kira Studio's; see
-- internal/kirapaths' doc comment for why the two never share one). P100 Part 1 wires only the
-- tables this phase's own services actually use: settings (advanced.gitLogLevel + git.* leaves),
-- windows (this app's own shell-level window persistence), and the three git-module tables
-- (git_clients, git_repo_settings, code_repos) carried over verbatim from Kira Studio's own
-- 0016/0017/0018 migrations. Kira Studio's own `layout`/`tabs` tables are deliberately NOT
-- included here — nothing in Part 1's own scope (GitClientsService, CodeWorkspaceService,
-- GithubService, the git RPC stream, this app's own window shell) reads or writes either one;
-- Part 2 (the frontend) is what will need them, and adds them in its own migration when it
-- actually has a consumer for them, rather than this phase pre-building unused schema.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Carried over from Kira Studio's own 0002_p8_windows.sql/0014_p22_window_mode.sql, minus the
-- `mode` column: Kira Space has no Studio/Api app-mode concept for a window to remember
-- (confirmed via internal/shell/window.go — Options()/Attach() never read WindowRecord.Mode, only
-- .Key/.Bounds), so WindowsRepo's own GetMode/SetMode never existed here to need a column for.
CREATE TABLE windows (
  key         TEXT PRIMARY KEY,
  "order"     INTEGER NOT NULL,
  bounds_json TEXT
);

-- Carried over verbatim from Kira Studio's own 0016_g1_git_clients.sql — see that file for the
-- full column-by-column rationale (the trust store for paired VS Code extensions, G1 D7).
CREATE TABLE git_clients (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  token_hash   BLOB NOT NULL,
  token_salt   BLOB NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at   INTEGER
);

CREATE INDEX git_clients_last_seen ON git_clients(last_seen_at DESC);

-- Carried over verbatim from Kira Studio's own 0017_g18_git_repo_settings.sql — see that file for
-- the full rationale (G18 D3).
CREATE TABLE git_repo_settings (
  repo_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (repo_id, key)
);

-- Carried over from Kira Studio's own 0018_c5_code_repos.sql, minus its own trailing
-- `ALTER TABLE tabs ADD COLUMN workspace_id` — Kira Space has no `tabs` table yet to alter (see
-- this file's own header comment).
CREATE TABLE code_repos (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  root       TEXT NOT NULL,
  repo_id    TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX code_repos_repo ON code_repos (repo_id);
