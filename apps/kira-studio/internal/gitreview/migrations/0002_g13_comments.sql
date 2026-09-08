CREATE TABLE review_comment (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES review_session(id) ON DELETE CASCADE,
  path            TEXT    NOT NULL,   -- repository-relative, exactly the bytes git reported
  start_line      INTEGER NOT NULL,   -- 1-based, inclusive, in anchor_sha's own coordinates
  end_line        INTEGER NOT NULL,   -- inclusive; == start_line for a single-line comment
  body            TEXT    NOT NULL,   -- LF-normalised, trimmed, never empty (D15)
  anchor_sha      TEXT    NOT NULL,   -- the commit whose content the reviewer was reading
  anchor_blob_oid TEXT    NOT NULL,   -- git's own oid for anchor_sha:path — tier 0's comparand
  created_at      INTEGER NOT NULL    -- unix millis
);

-- list/export read one session's comments and sort them; remove reads one id. This index serves
-- the first and the FK cascade's own delete; the primary key serves the second.
CREATE INDEX review_comment_session_path ON review_comment (session_id, path, start_line);
