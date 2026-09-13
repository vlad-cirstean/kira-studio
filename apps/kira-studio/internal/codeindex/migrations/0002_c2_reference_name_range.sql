DELETE FROM file;            -- derived cache; the next Sync rebuilds it. Cascades to blocks,
                             -- symbols and references.
DROP TABLE reference;
CREATE TABLE reference (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id    INTEGER NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  repo_id    TEXT    NOT NULL,
  block_id   INTEGER REFERENCES file_block(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,   -- 'call' | 'type' | 'implementation' | 'import' | 'class'
  name       TEXT    NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte   INTEGER NOT NULL,
  start_row  INTEGER NOT NULL,
  start_column INTEGER NOT NULL,
  name_start_byte INTEGER NOT NULL,
  name_end_byte   INTEGER NOT NULL,
  name_start_row  INTEGER NOT NULL,
  name_start_column INTEGER NOT NULL
);
CREATE INDEX reference_file ON reference (file_id, start_byte);
CREATE INDEX reference_name ON reference (repo_id, name);
