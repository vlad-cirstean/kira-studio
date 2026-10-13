-- Ingest: import jobs gain provenance, channel, groups and write-back; import files gain the json,
-- jsonl and memdoc kinds, the verifying state and cross-check results. SQLite cannot alter a CHECK,
-- and with foreign_keys on a DROP TABLE of import_files cascades into any table naming it, so the
-- three tables are copied to TEMP tables (no foreign keys), dropped child first, rebuilt under
-- their final names and refilled. The carried-over *_at columns keep 0003's ISO-8601 text values; their
-- type name is dropped (no affinity stores text as text) so the guard against new TEXT instants does
-- not fire on them.
CREATE TEMP TABLE jobs_old AS SELECT * FROM import_jobs;
CREATE TEMP TABLE files_old AS SELECT * FROM import_files;
CREATE TEMP TABLE chunks_old AS SELECT * FROM import_chunks;

DROP TABLE import_chunks;
DROP TABLE import_files;
DROP TABLE import_jobs;

CREATE TABLE import_jobs (
  id            TEXT PRIMARY KEY,
  roots         TEXT NOT NULL,
  base          TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('scanning', 'awaiting', 'running', 'paused', 'done', 'cancelled', 'failed')),
  reason        TEXT NOT NULL DEFAULT '',
  truncated     INTEGER NOT NULL DEFAULT 0,
  ignored_count INTEGER NOT NULL DEFAULT 0,
  est_tokens    INTEGER NOT NULL DEFAULT 0,
  est_chunks    INTEGER NOT NULL DEFAULT 0,
  calls         INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0,
  created_at NOT NULL,
  started_at,
  finished_at,
  dismissed_at,
  channel       TEXT NOT NULL DEFAULT 'ui' CHECK (channel IN ('ui', 'mcp')),
  origin        TEXT NOT NULL DEFAULT 'external' CHECK (origin IN ('user', 'agent', 'external')),
  source_tag    TEXT CHECK (source_tag IS NULL OR (length(source_tag) BETWEEN 1 AND 32 AND source_tag NOT GLOB '*[^a-z0-9-]*')),
  scope         TEXT NOT NULL DEFAULT 'personal' CHECK (scope IN ('company', 'project', 'personal')),
  project       TEXT CHECK (project IS NULL OR (length(project) BETWEEN 1 AND 300
                  AND project = replace(replace(replace(project, ' ', ''), char(9), ''), char(10), ''))),
  session_id    TEXT CHECK (session_id IS NULL OR length(session_id) BETWEEN 1 AND 128),
  groups_json   TEXT NOT NULL DEFAULT '[]',
  auto_start    INTEGER NOT NULL DEFAULT 0 CHECK (auto_start IN (0, 1)),
  write_doc     INTEGER NOT NULL DEFAULT 0 CHECK (write_doc IN (0, 1)),
  CHECK ((origin = 'external') = (source_tag IS NOT NULL)),
  CHECK ((scope = 'project') = (project IS NOT NULL))
);

CREATE TABLE import_files (
  id                TEXT PRIMARY KEY,
  job_id            TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  path              TEXT NOT NULL,
  rel_path          TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('markdown', 'text', 'json', 'jsonl', 'memdoc')),
  size              INTEGER NOT NULL,
  content_hash      TEXT NOT NULL DEFAULT '',
  state             TEXT NOT NULL CHECK (state IN ('pending', 'skipped', 'extracting', 'extracted', 'verifying', 'finalizing', 'done', 'failed', 'cancelled')),
  reason            TEXT NOT NULL DEFAULT '',
  title             TEXT NOT NULL DEFAULT '',
  chunk_count       INTEGER NOT NULL DEFAULT 0,
  est_tokens        INTEGER NOT NULL DEFAULT 0,
  fact_count        INTEGER NOT NULL DEFAULT 0,
  finalize_attempts INTEGER NOT NULL DEFAULT 0,
  added             INTEGER NOT NULL DEFAULT 0,
  updated           INTEGER NOT NULL DEFAULT 0,
  noop              INTEGER NOT NULL DEFAULT 0,
  unresolved        TEXT NOT NULL DEFAULT '[]',
  dropped           TEXT NOT NULL DEFAULT '[]',
  cost_usd          REAL NOT NULL DEFAULT 0,
  updated_at NOT NULL,
  verify_json       TEXT NOT NULL DEFAULT '{}',
  verified          INTEGER NOT NULL DEFAULT 0,
  orphaned          INTEGER NOT NULL DEFAULT 0,
  group_id          TEXT NOT NULL DEFAULT '',
  prov_json         TEXT NOT NULL DEFAULT '',
  doc_path          TEXT NOT NULL DEFAULT '',
  doc_error         TEXT NOT NULL DEFAULT '',
  UNIQUE (job_id, rel_path)
);
CREATE INDEX import_files_job_state ON import_files(job_id, state);
CREATE INDEX import_files_done_hash ON import_files(content_hash) WHERE state = 'done';

CREATE TABLE import_chunks (
  file_id      TEXT NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,
  idx          INTEGER NOT NULL,
  heading_path TEXT NOT NULL DEFAULT '',
  context      TEXT NOT NULL DEFAULT '',
  text         TEXT NOT NULL,
  tokens       INTEGER NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('pending', 'running', 'done', 'failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  error        TEXT NOT NULL DEFAULT '',
  facts        TEXT NOT NULL DEFAULT '[]',
  cost_usd     REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (file_id, idx)
);

-- Existing jobs are UI imports; P272 stored their facts as external/doc/personal.
INSERT INTO import_jobs
  (id, roots, base, state, reason, truncated, ignored_count, est_tokens, est_chunks, calls, cost_usd,
   created_at, started_at, finished_at, dismissed_at, channel, origin, source_tag, scope, project,
   session_id, groups_json, auto_start, write_doc)
  SELECT id, roots, base, state, reason, truncated, ignored_count, est_tokens, est_chunks, calls, cost_usd,
   created_at, started_at, finished_at, dismissed_at, 'ui', 'external', 'doc', 'personal', NULL,
   NULL, '[]', 0, 0
  FROM jobs_old;
INSERT INTO import_files
  (id, job_id, path, rel_path, kind, size, content_hash, state, reason, title, chunk_count, est_tokens,
   fact_count, finalize_attempts, added, updated, noop, unresolved, dropped, cost_usd, updated_at)
  SELECT id, job_id, path, rel_path, kind, size, content_hash, state, reason, title, chunk_count, est_tokens,
   fact_count, finalize_attempts, added, updated, noop, unresolved, dropped, cost_usd, updated_at
  FROM files_old;
INSERT INTO import_chunks
  (file_id, idx, heading_path, context, text, tokens, state, attempts, error, facts, cost_usd)
  SELECT file_id, idx, heading_path, context, text, tokens, state, attempts, error, facts, cost_usd
  FROM chunks_old;

DROP TABLE jobs_old;
DROP TABLE files_old;
DROP TABLE chunks_old;
