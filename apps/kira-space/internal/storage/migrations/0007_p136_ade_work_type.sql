-- P136: user-chosen work type. kind stays the structural field (merge order, read-only).
ALTER TABLE ade_branches ADD COLUMN work_type TEXT NOT NULL DEFAULT 'work'
  CHECK (work_type IN ('work', 'investigate', 'review', 'test'));
UPDATE ade_branches SET work_type = 'review' WHERE kind = 'review';
ALTER TABLE ade_new_work ADD COLUMN work_type TEXT NOT NULL DEFAULT 'work'
  CHECK (work_type IN ('work', 'investigate'));
