-- P128 §2.2: a window remembers which module (git/terminal/ade) it was closed in and reopens into
-- it, mirroring Kira Studio's own 0014_p22_window_mode.sql. NOT NULL DEFAULT 'git' rather than
-- nullable — every pre-existing window row lands on this app's own default mode
-- (workbench/modes.ts's defaultMode), and SQLite's ALTER TABLE ADD COLUMN with a non-null default
-- is a metadata change, not a table rewrite.
ALTER TABLE windows ADD COLUMN mode TEXT NOT NULL DEFAULT 'git';
