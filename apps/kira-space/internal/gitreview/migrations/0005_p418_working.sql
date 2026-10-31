CREATE TABLE review_working_file (
  session_id    INTEGER NOT NULL REFERENCES review_session(id) ON DELETE CASCADE,
  path          TEXT    NOT NULL,
  state         TEXT    NOT NULL,   -- 'full' | 'partial'
  head_sha      TEXT    NOT NULL,   -- worktree HEAD at mark time; '' for an unborn HEAD
  reviewed_at   INTEGER NOT NULL,   -- unix millis
  content_hash  TEXT    NOT NULL,   -- sha256 hex of the worktree bytes; '' when absent
  content_kind  TEXT    NOT NULL,   -- 'text' | 'binary' | 'tooLarge' | 'absent'
  content_bytes INTEGER NOT NULL,
  line_count    INTEGER NOT NULL,
  content       BLOB,               -- flate(raw); NULL unless text
  PRIMARY KEY (session_id, path)
);

CREATE TABLE review_working_range (
  session_id INTEGER NOT NULL,
  path       TEXT    NOT NULL,
  start_line INTEGER NOT NULL,
  end_line   INTEGER NOT NULL,
  PRIMARY KEY (session_id, path, start_line),
  FOREIGN KEY (session_id, path) REFERENCES review_working_file(session_id, path) ON DELETE CASCADE
);

ALTER TABLE review_comment ADD COLUMN origin TEXT NOT NULL DEFAULT 'commit' CHECK (origin IN ('commit', 'working'));
ALTER TABLE review_comment ADD COLUMN anchor_content BLOB;
