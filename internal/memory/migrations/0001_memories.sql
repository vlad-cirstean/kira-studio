CREATE TABLE memories (
  seq              INTEGER PRIMARY KEY,
  id               TEXT NOT NULL UNIQUE,
  lineage_id       TEXT NOT NULL,
  version          INTEGER NOT NULL CHECK (version >= 1),
  fact             TEXT NOT NULL CHECK (length(fact) BETWEEN 1 AND 1000),
  reason           TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  keywords         TEXT NOT NULL DEFAULT '',
  author           TEXT NOT NULL CHECK (author IN ('user', 'agent')),
  status           TEXT NOT NULL CHECK (status IN ('current', 'superseded')),
  supersedes_id    TEXT REFERENCES memories(id),
  superseded_by_id TEXT REFERENCES memories(id),
  fact_hash        TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  superseded_at    TEXT,
  UNIQUE (lineage_id, version)
);
CREATE UNIQUE INDEX memories_one_current ON memories(lineage_id) WHERE status = 'current';
CREATE INDEX memories_status_created ON memories(status, created_at DESC);
CREATE INDEX memories_current_hash ON memories(fact_hash) WHERE status = 'current';
CREATE INDEX memories_supersedes ON memories(supersedes_id);
CREATE INDEX memories_superseded_by ON memories(superseded_by_id);

-- Values never change; only status/superseded_* move, and only current -> superseded.
CREATE TRIGGER memories_immutable
BEFORE UPDATE OF id, lineage_id, version, fact, reason, keywords, author, fact_hash, created_at, supersedes_id ON memories
BEGIN SELECT RAISE(ABORT, 'memory values are immutable'); END;
CREATE TRIGGER memories_stay_superseded
BEFORE UPDATE OF status ON memories WHEN OLD.status = 'superseded'
BEGIN SELECT RAISE(ABORT, 'a superseded memory stays superseded'); END;
CREATE TRIGGER memories_no_delete
BEFORE DELETE ON memories
BEGIN SELECT RAISE(ABORT, 'memories are never deleted'); END;

CREATE VIRTUAL TABLE memories_fts USING fts5(
  fact, reason, keywords,
  content = 'memories', content_rowid = 'seq',
  tokenize = 'porter unicode61 remove_diacritics 2',
  prefix = '2 3'
);
CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories
BEGIN INSERT INTO memories_fts(rowid, fact, reason, keywords) VALUES (new.seq, new.fact, new.reason, new.keywords); END;

CREATE TABLE memory_revision (id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL);
INSERT INTO memory_revision (id, value) VALUES (1, 0);
CREATE TRIGGER memories_bump_revision AFTER INSERT ON memories
BEGIN UPDATE memory_revision SET value = value + 1 WHERE id = 1; END;

CREATE TABLE memory_events (
  seq          INTEGER PRIMARY KEY,
  request_id   TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('mcp', 'ui')),
  action       TEXT NOT NULL CHECK (action IN ('add', 'update', 'noop')),
  lineage_id   TEXT NOT NULL,
  memory_id    TEXT NOT NULL REFERENCES memories(id),
  previous_id  TEXT REFERENCES memories(id),
  author       TEXT NOT NULL CHECK (author IN ('user', 'agent')),
  rationale    TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE INDEX memory_events_lineage ON memory_events(lineage_id, seq);
CREATE INDEX memory_events_memory ON memory_events(memory_id);
CREATE INDEX memory_events_previous ON memory_events(previous_id);
