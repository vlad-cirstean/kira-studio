CREATE TABLE review_session (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id      TEXT    NOT NULL,
  branch       TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,          -- unix millis
  last_used_at INTEGER NOT NULL,          -- unix millis; the reaper's own clock (D11)
  UNIQUE (repo_id, branch)
);

-- The reaper's whole query is `WHERE last_used_at < ?`, so it gets its own index rather than a
-- full scan of a table that grows one row per reviewed branch.
CREATE INDEX review_session_last_used ON review_session (last_used_at);

CREATE TABLE review_file (
  session_id      INTEGER NOT NULL REFERENCES review_session(id) ON DELETE CASCADE,
  path            TEXT    NOT NULL,
  state           TEXT    NOT NULL,       -- 'full' | 'partial'
  reviewed_at_sha TEXT    NOT NULL,       -- the commit the snapshot was taken at
  reviewed_at     INTEGER NOT NULL,       -- unix millis
  blob_oid        TEXT    NOT NULL,       -- git's own oid; '' when content_kind = 'absent'
  content_kind    TEXT    NOT NULL,       -- 'text' | 'binary' | 'tooLarge' | 'absent'
  content_bytes   INTEGER NOT NULL,       -- UNCOMPRESSED length; the decoder's own length check
  line_count      INTEGER NOT NULL,       -- text only; 0 otherwise
  content         BLOB,                   -- flate(raw); NULL unless content_kind = 'text'
  PRIMARY KEY (session_id, path)
);

CREATE TABLE review_range (
  session_id INTEGER NOT NULL,
  path       TEXT    NOT NULL,
  start_line INTEGER NOT NULL,            -- 1-based, inclusive, in the SNAPSHOT's coordinates
  end_line   INTEGER NOT NULL,            -- inclusive
  PRIMARY KEY (session_id, path, start_line),
  FOREIGN KEY (session_id, path) REFERENCES review_file(session_id, path) ON DELETE CASCADE
);
