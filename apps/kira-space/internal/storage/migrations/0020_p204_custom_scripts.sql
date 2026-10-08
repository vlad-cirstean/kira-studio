-- P204: quick commands in Kira Space: the same custom_scripts table Kira Studio carries (its 0024
-- plus 0031), shared through internal/quickcommands.
CREATE TABLE custom_scripts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  command     TEXT NOT NULL,
  -- '' means the terminal's default directory. A non-empty value is an absolute path, checked on
  -- write; its existence is checked at launch.
  working_dir TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT 'none',
  collection  TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
