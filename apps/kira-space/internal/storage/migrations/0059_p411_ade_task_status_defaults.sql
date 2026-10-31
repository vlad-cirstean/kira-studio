-- P411: a status is a label (id, name, color, position). The four automatic changes name their status
-- in ade_task_status_defaults; an absent row keeps the current status.
CREATE TABLE ade_task_status_defaults (
  slot TEXT PRIMARY KEY CHECK (slot IN ('new','step','review','finished')),
  status_id TEXT NOT NULL
);
-- Seed with the status the category rule picked: lowest position of the matching category.
INSERT INTO ade_task_status_defaults (slot, status_id)
SELECT 'new', (SELECT id FROM ade_task_statuses WHERE category = 'todo' ORDER BY position, id LIMIT 1)
WHERE EXISTS (SELECT 1 FROM ade_task_statuses WHERE category = 'todo');
INSERT INTO ade_task_status_defaults (slot, status_id)
SELECT 'step', (SELECT id FROM ade_task_statuses WHERE category = 'active' ORDER BY position, id LIMIT 1)
WHERE EXISTS (SELECT 1 FROM ade_task_statuses WHERE category = 'active');
INSERT INTO ade_task_status_defaults (slot, status_id)
SELECT 'review', (SELECT id FROM ade_task_statuses WHERE category = 'review' ORDER BY position, id LIMIT 1)
WHERE EXISTS (SELECT 1 FROM ade_task_statuses WHERE category = 'review');
INSERT INTO ade_task_status_defaults (slot, status_id)
SELECT 'finished', (SELECT id FROM ade_task_statuses WHERE category = 'done' ORDER BY position, id LIMIT 1)
WHERE EXISTS (SELECT 1 FROM ade_task_statuses WHERE category = 'done');

-- SQLite cannot alter a CHECK: rebuild without category, tone becomes color.
CREATE TABLE ade_task_statuses_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  color TEXT NOT NULL CHECK (color IN ('grey','brown','red','orange','amber','yellow','lime','green','teal','cyan','sky','blue','indigo','violet','purple','pink')),
  position INTEGER NOT NULL
);
INSERT INTO ade_task_statuses_new (id, name, color, position) SELECT id, name, tone, position FROM ade_task_statuses;
DROP TABLE ade_task_statuses;
ALTER TABLE ade_task_statuses_new RENAME TO ade_task_statuses;
