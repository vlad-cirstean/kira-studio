CREATE TABLE meta (
  repo_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (repo_id, key)
);

CREATE TABLE file (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       TEXT    NOT NULL,
  path          TEXT    NOT NULL,
  language      TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL,
  mtime_unix_ns INTEGER NOT NULL,
  content_sha   BLOB    NOT NULL,
  parse_status  TEXT    NOT NULL,
  has_error     INTEGER NOT NULL,
  line_count    INTEGER NOT NULL,
  parsed_at     INTEGER NOT NULL,
  UNIQUE (repo_id, path)
);
CREATE INDEX file_repo ON file (repo_id);

CREATE TABLE file_block (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id    INTEGER NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,
  language   TEXT    NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte   INTEGER NOT NULL,
  start_row  INTEGER NOT NULL,
  start_column INTEGER NOT NULL
);
CREATE INDEX file_block_file ON file_block (file_id, start_byte);

CREATE TABLE symbol (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id    INTEGER NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  repo_id    TEXT    NOT NULL,
  block_id   INTEGER REFERENCES file_block(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES symbol(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte   INTEGER NOT NULL,
  start_row  INTEGER NOT NULL,
  start_column INTEGER NOT NULL,
  end_row    INTEGER NOT NULL,
  end_column INTEGER NOT NULL,
  name_start_byte INTEGER NOT NULL,
  name_end_byte   INTEGER NOT NULL,
  name_start_row  INTEGER NOT NULL,
  name_start_column INTEGER NOT NULL
);
CREATE INDEX symbol_file ON symbol (file_id, start_byte);
CREATE INDEX symbol_name ON symbol (repo_id, name);

CREATE TABLE reference (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id    INTEGER NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  repo_id    TEXT    NOT NULL,
  block_id   INTEGER REFERENCES file_block(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte   INTEGER NOT NULL,
  start_row  INTEGER NOT NULL,
  start_column INTEGER NOT NULL
);
CREATE INDEX reference_file ON reference (file_id, start_byte);
CREATE INDEX reference_name ON reference (repo_id, name);
