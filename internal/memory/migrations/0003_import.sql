-- memory_events gains source 'import' and source_ref (the import file id). SQLite cannot alter a
-- CHECK, so the table is rebuilt. Nothing references memory_events.
CREATE TABLE memory_events_v3 (
  seq          INTEGER PRIMARY KEY,
  request_id   TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('mcp', 'ui', 'import')),
  source_ref   TEXT,
  action       TEXT NOT NULL CHECK (action IN ('add', 'update', 'noop')),
  lineage_id   TEXT NOT NULL,
  memory_id    TEXT NOT NULL REFERENCES memories(id),
  previous_id  TEXT REFERENCES memories(id),
  author       TEXT NOT NULL CHECK (author IN ('user', 'agent')),
  rationale    TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  CHECK ((source = 'import') = (source_ref IS NOT NULL))
);
INSERT INTO memory_events_v3
  (seq, request_id, source, action, lineage_id, memory_id, previous_id, author, rationale, created_at)
  SELECT seq, request_id, source, action, lineage_id, memory_id, previous_id, author, rationale, created_at
  FROM memory_events;
DROP TABLE memory_events;
ALTER TABLE memory_events_v3 RENAME TO memory_events;
CREATE INDEX memory_events_lineage ON memory_events(lineage_id, seq);
CREATE INDEX memory_events_memory ON memory_events(memory_id);
CREATE INDEX memory_events_previous ON memory_events(previous_id);
CREATE INDEX memory_events_source_ref ON memory_events(source_ref) WHERE source_ref IS NOT NULL;

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
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  finished_at   TEXT,
  dismissed_at  TEXT
);

CREATE TABLE import_files (
  id                TEXT PRIMARY KEY,
  job_id            TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  path              TEXT NOT NULL,
  rel_path          TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('markdown', 'text')),
  size              INTEGER NOT NULL,
  content_hash      TEXT NOT NULL DEFAULT '',
  state             TEXT NOT NULL CHECK (state IN ('pending', 'skipped', 'extracting', 'extracted', 'finalizing', 'done', 'failed', 'cancelled')),
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
  updated_at        TEXT NOT NULL,
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
