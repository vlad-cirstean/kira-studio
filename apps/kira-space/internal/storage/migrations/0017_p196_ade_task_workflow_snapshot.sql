-- P196: the whole workflow a started task began with. NULL = not started, follows the live file.
ALTER TABLE ade_tasks ADD COLUMN workflow_json TEXT;
ALTER TABLE ade_tasks ADD COLUMN workflow_hash TEXT NOT NULL DEFAULT '';
