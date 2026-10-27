-- P379: customizable task statuses. The set is a table; tasks store the id of their status.
CREATE TABLE ade_task_statuses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  tone TEXT NOT NULL CHECK (tone IN ('amber','red','green','blue','purple','grey')),
  category TEXT NOT NULL CHECK (category IN ('todo','active','review','done')),
  position INTEGER NOT NULL
);
INSERT INTO ade_task_statuses (id, name, tone, category, position) VALUES
  ('todo', 'To do', 'grey', 'todo', 0),
  ('in-progress', 'In progress', 'amber', 'active', 1),
  ('in-review', 'In review', 'blue', 'review', 2),
  ('done', 'Done', 'green', 'done', 3);

ALTER TABLE ade_tasks ADD COLUMN status_id TEXT NOT NULL DEFAULT 'todo';
ALTER TABLE ade_tasks ADD COLUMN status_by TEXT NOT NULL DEFAULT 'auto' CHECK (status_by IN ('auto','user'));
ALTER TABLE ade_tasks ADD COLUMN status_step TEXT NOT NULL DEFAULT '';

-- Backfill, first match wins. A started task takes its entry step's status; Recover corrects it when
-- the derived current step differs.
UPDATE ade_tasks SET
  status_id = CASE
    WHEN kind = 'review' THEN 'in-review'
    WHEN entry_step_id = 'done' THEN 'done'
    WHEN kind = 'parked' OR workflow_id = '' OR workflow_json IS NULL THEN 'todo'
    WHEN NOT EXISTS (SELECT 1 FROM ade_runs r WHERE r.task_id = ade_tasks.id AND r.purpose = '')
      AND NOT EXISTS (SELECT 1 FROM ade_sessions s WHERE s.task_id = ade_tasks.id) THEN 'todo'
    ELSE COALESCE((
      SELECT CASE json_extract(j.value, '$.status')
        WHEN 'To do' THEN 'todo'
        WHEN 'In progress' THEN 'in-progress'
        WHEN 'In review' THEN 'in-review'
        WHEN 'Done' THEN 'done'
        ELSE NULL END
      FROM json_each(ade_tasks.workflow_json, '$.steps') j
      WHERE json_extract(j.value, '$.id') = ade_tasks.entry_step_id), 'in-progress')
  END,
  status_step = CASE
    WHEN kind = 'review' OR kind = 'parked' OR workflow_id = '' OR workflow_json IS NULL THEN ''
    WHEN entry_step_id = 'done' THEN 'done'
    WHEN NOT EXISTS (SELECT 1 FROM ade_runs r WHERE r.task_id = ade_tasks.id AND r.purpose = '')
      AND NOT EXISTS (SELECT 1 FROM ade_sessions s WHERE s.task_id = ade_tasks.id) THEN ''
    ELSE entry_step_id
  END;
