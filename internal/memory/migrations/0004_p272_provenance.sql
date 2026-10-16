-- Provenance: nanoid fact ids, origin (replaces author), scope, project, session, groups.
-- SQLite cannot alter a CHECK or drop a column across the triggers and FTS, so memories and
-- memory_events are rebuilt; memory_embeddings is copied across the rebuild. The FTS index and the
-- embeddings key on seq, which is kept. The new rows are staged in temp tables and the old tables
-- dropped first, so no foreign key checks against rows of a table that is about to vanish.
PRAGMA defer_foreign_keys = ON;

-- One new fact id per lineage: 'km_' plus 12 Crockford base32 characters (60 bits, uniform:
-- random() & 31 covers 32 values). A collision aborts the step on UNIQUE; the next open retries.
CREATE TEMP TABLE lineage_map (
  old_lineage TEXT PRIMARY KEY,
  new_lineage TEXT NOT NULL UNIQUE
);
INSERT INTO lineage_map (old_lineage, new_lineage)
  SELECT lineage_id, 'km_' || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) FROM (SELECT DISTINCT lineage_id FROM memories);

CREATE TEMP TABLE id_map (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL UNIQUE
);
INSERT INTO id_map (old_id, new_id)
  SELECT m.id, l.new_lineage || '.' || m.version
  FROM memories m JOIN lineage_map l ON l.old_lineage = m.lineage_id;

CREATE TEMP TABLE mem_new AS
  SELECT m.seq AS seq, i.new_id AS id, l.new_lineage AS lineage_id, m.version AS version, m.fact AS fact,
    m.reason AS reason, m.keywords AS keywords,
    CASE WHEN imp.imported THEN 'external' ELSE m.author END AS origin,
    CASE WHEN imp.imported THEN 'doc' END AS source_tag,
    'personal' AS scope, NULL AS project, NULL AS session_id,
    m.status AS status, s.new_id AS supersedes_id, b.new_id AS superseded_by_id, m.fact_hash AS fact_hash,
    m.created_at AS created_at, m.superseded_at AS superseded_at
  FROM memories m
  JOIN id_map i ON i.old_id = m.id
  JOIN lineage_map l ON l.old_lineage = m.lineage_id
  LEFT JOIN id_map s ON s.old_id = m.supersedes_id
  LEFT JOIN id_map b ON b.old_id = m.superseded_by_id
  LEFT JOIN (SELECT DISTINCT memory_id, 1 AS imported FROM memory_events
             WHERE source = 'import' AND action IN ('add', 'update')) imp ON imp.memory_id = m.id;


CREATE TEMP TABLE ev_new AS
  SELECT e.seq AS seq, e.request_id AS request_id, e.source AS source, e.source_ref AS source_ref, e.action AS action,
    l.new_lineage AS lineage_id, i.new_id AS memory_id, p.new_id AS previous_id,
    CASE WHEN e.source = 'import' THEN 'external' ELSE e.author END AS origin,
    CASE WHEN e.source = 'import' THEN 'doc' END AS source_tag,
    NULL AS session_id, e.rationale AS rationale, e.created_at AS created_at
  FROM memory_events e
  JOIN id_map i ON i.old_id = e.memory_id
  JOIN lineage_map l ON l.old_lineage = e.lineage_id
  LEFT JOIN id_map p ON p.old_id = e.previous_id;

CREATE TEMP TABLE emb_old AS SELECT seq, model, vec, created_at FROM memory_embeddings;

DROP TABLE memory_embeddings;
DROP TABLE memory_events;
DROP TABLE memories;

CREATE TABLE memories (
  seq              INTEGER PRIMARY KEY,
  id               TEXT NOT NULL UNIQUE,
  lineage_id       TEXT NOT NULL,
  version          INTEGER NOT NULL CHECK (version >= 1),
  fact             TEXT NOT NULL CHECK (length(fact) BETWEEN 1 AND 1000),
  reason           TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  keywords         TEXT NOT NULL DEFAULT '',
  origin           TEXT NOT NULL CHECK (origin IN ('user', 'agent', 'external')),
  source_tag       TEXT CHECK (source_tag IS NULL OR (length(source_tag) BETWEEN 1 AND 32 AND source_tag NOT GLOB '*[^a-z0-9-]*')),
  scope            TEXT NOT NULL CHECK (scope IN ('company', 'project', 'personal')),
  project          TEXT CHECK (project IS NULL OR (length(project) BETWEEN 1 AND 300
                     AND project = replace(replace(replace(project, ' ', ''), char(9), ''), char(10), ''))),
  session_id       TEXT CHECK (session_id IS NULL OR length(session_id) BETWEEN 1 AND 128),
  status           TEXT NOT NULL CHECK (status IN ('current', 'superseded')),
  supersedes_id    TEXT REFERENCES memories(id),
  superseded_by_id TEXT REFERENCES memories(id),
  fact_hash        TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  superseded_at    TEXT,
  UNIQUE (lineage_id, version),
  CHECK ((origin = 'external') = (source_tag IS NOT NULL)),
  CHECK ((scope = 'project') = (project IS NOT NULL)),
  CHECK (id = lineage_id || '.' || version)
);
CREATE TABLE memory_events (
  seq          INTEGER PRIMARY KEY,
  request_id   TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('mcp', 'ui', 'import')),
  source_ref   TEXT,
  action       TEXT NOT NULL CHECK (action IN ('add', 'update', 'noop')),
  lineage_id   TEXT NOT NULL,
  memory_id    TEXT NOT NULL REFERENCES memories(id),
  previous_id  TEXT REFERENCES memories(id),
  origin       TEXT NOT NULL CHECK (origin IN ('user', 'agent', 'external')),
  source_tag   TEXT CHECK (source_tag IS NULL OR (length(source_tag) BETWEEN 1 AND 32 AND source_tag NOT GLOB '*[^a-z0-9-]*')),
  session_id   TEXT CHECK (session_id IS NULL OR length(session_id) BETWEEN 1 AND 128),
  rationale    TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  CHECK ((source = 'import') = (source_ref IS NOT NULL)),
  CHECK ((origin = 'external') = (source_tag IS NOT NULL))
);
INSERT INTO memories SELECT * FROM mem_new ORDER BY seq;
INSERT INTO memory_events SELECT * FROM ev_new ORDER BY seq;
CREATE TABLE memory_embeddings (
  seq        INTEGER PRIMARY KEY REFERENCES memories(seq),
  model      TEXT NOT NULL,
  vec        BLOB NOT NULL CHECK (length(vec) > 0 AND length(vec) % 4 = 0),
  created_at TEXT NOT NULL
);
INSERT INTO memory_embeddings SELECT seq, model, vec, created_at FROM emb_old;
DROP TABLE mem_new;
DROP TABLE ev_new;
DROP TABLE emb_old;

CREATE UNIQUE INDEX memories_one_current ON memories(lineage_id) WHERE status = 'current';
CREATE INDEX memories_status_created ON memories(status, created_at DESC);
CREATE INDEX memories_current_hash ON memories(fact_hash) WHERE status = 'current';
CREATE INDEX memories_supersedes ON memories(supersedes_id);
CREATE INDEX memories_superseded_by ON memories(superseded_by_id);
CREATE INDEX memories_scope_project ON memories(scope, project) WHERE status = 'current';
CREATE INDEX memory_events_lineage ON memory_events(lineage_id, seq);
CREATE INDEX memory_events_memory ON memory_events(memory_id);
CREATE INDEX memory_events_previous ON memory_events(previous_id);
CREATE INDEX memory_events_source_ref ON memory_events(source_ref) WHERE source_ref IS NOT NULL;

-- Values never change; only status/superseded_* move, and only current -> superseded.
CREATE TRIGGER memories_immutable
BEFORE UPDATE OF id, lineage_id, version, fact, reason, keywords, origin, source_tag, scope, project, session_id,
  fact_hash, created_at, supersedes_id ON memories
BEGIN SELECT RAISE(ABORT, 'memory values are immutable'); END;
CREATE TRIGGER memories_stay_superseded
BEFORE UPDATE OF status ON memories WHEN OLD.status = 'superseded'
BEGIN SELECT RAISE(ABORT, 'a superseded memory stays superseded'); END;
CREATE TRIGGER memories_no_delete
BEFORE DELETE ON memories
BEGIN SELECT RAISE(ABORT, 'memories are never deleted'); END;
CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories
BEGIN INSERT INTO memories_fts(rowid, fact, reason, keywords) VALUES (new.seq, new.fact, new.reason, new.keywords); END;
CREATE TRIGGER memories_bump_revision AFTER INSERT ON memories
BEGIN UPDATE memory_revision SET value = value + 1 WHERE id = 1; END;

-- Old uuids stay resolvable: transcripts and notes may already cite them.
CREATE TABLE memory_legacy_ids (
  legacy_id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id)
);
INSERT INTO memory_legacy_ids (legacy_id, memory_id) SELECT old_id, new_id FROM id_map;
CREATE INDEX memory_legacy_ids_memory ON memory_legacy_ids(memory_id);

CREATE TABLE memory_groups (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('session', 'request', 'task', 'document', 'thread')),
  key        TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 4096),
  title      TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 200),
  created_at INTEGER NOT NULL,
  UNIQUE (kind, key)
);
CREATE TABLE memory_group_members (
  group_id   TEXT NOT NULL REFERENCES memory_groups(id),
  lineage_id TEXT NOT NULL,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (group_id, lineage_id)
);
CREATE INDEX memory_group_members_lineage ON memory_group_members(lineage_id);
CREATE TRIGGER memory_groups_no_update BEFORE UPDATE ON memory_groups
BEGIN SELECT RAISE(ABORT, 'memory groups are append-only'); END;
CREATE TRIGGER memory_groups_no_delete BEFORE DELETE ON memory_groups
BEGIN SELECT RAISE(ABORT, 'memory groups are append-only'); END;
CREATE TRIGGER memory_group_members_no_update BEFORE UPDATE ON memory_group_members
BEGIN SELECT RAISE(ABORT, 'memory groups are append-only'); END;
CREATE TRIGGER memory_group_members_no_delete BEFORE DELETE ON memory_group_members
BEGIN SELECT RAISE(ABORT, 'memory groups are append-only'); END;

-- Group times are unix milliseconds (the ISO strings of the legacy columns convert in place).
-- Backfill: one request group per request id of an add/update event.
CREATE TEMP TABLE group_map (kind TEXT NOT NULL, key TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (kind, key));
INSERT INTO group_map (kind, key, id)
  SELECT 'request', request_id, 'kg_' || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) FROM (SELECT DISTINCT request_id FROM memory_events WHERE action IN ('add', 'update'));
INSERT INTO memory_groups (id, kind, key, title, created_at)
  SELECT g.id, 'request', g.key, '', (SELECT min(COALESCE(CAST(strftime('%s', e.created_at) AS INTEGER) * 1000 + CAST(substr(e.created_at, 21, 3) AS INTEGER), 0)) FROM memory_events e WHERE e.request_id = g.key AND e.action IN ('add', 'update'))
  FROM group_map g WHERE g.kind = 'request';
INSERT OR IGNORE INTO memory_group_members (group_id, lineage_id, added_at)
  SELECT g.id, e.lineage_id, COALESCE(CAST(strftime('%s', e.created_at) AS INTEGER) * 1000 + CAST(substr(e.created_at, 21, 3) AS INTEGER), 0) FROM memory_events e
  JOIN group_map g ON g.kind = 'request' AND g.key = e.request_id
  WHERE e.action IN ('add', 'update');

-- One document group per import file behind import events (the file path; the ref when the row is gone).
CREATE TEMP TABLE doc_events AS
  SELECT e.source_ref AS ref, COALESCE(f.path, e.source_ref) AS key, COALESCE(f.rel_path, '') AS title,
    e.lineage_id, e.created_at
  FROM memory_events e LEFT JOIN import_files f ON f.id = e.source_ref
  WHERE e.source = 'import' AND e.action IN ('add', 'update');
INSERT INTO group_map (kind, key, id)
  SELECT 'document', key, 'kg_' || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) || substr('0123456789abcdefghjkmnpqrstvwxyz', (random() & 31) + 1, 1) FROM (SELECT DISTINCT key FROM doc_events);
INSERT INTO memory_groups (id, kind, key, title, created_at)
  SELECT g.id, 'document', g.key, (SELECT max(d.title) FROM doc_events d WHERE d.key = g.key),
    (SELECT min(COALESCE(CAST(strftime('%s', d.created_at) AS INTEGER) * 1000 + CAST(substr(d.created_at, 21, 3) AS INTEGER), 0)) FROM doc_events d WHERE d.key = g.key)
  FROM group_map g WHERE g.kind = 'document';
INSERT OR IGNORE INTO memory_group_members (group_id, lineage_id, added_at)
  SELECT g.id, d.lineage_id, COALESCE(CAST(strftime('%s', d.created_at) AS INTEGER) * 1000 + CAST(substr(d.created_at, 21, 3) AS INTEGER), 0) FROM doc_events d
  JOIN group_map g ON g.kind = 'document' AND g.key = d.key;

DROP TABLE doc_events;
DROP TABLE group_map;
DROP TABLE id_map;
DROP TABLE lineage_map;
