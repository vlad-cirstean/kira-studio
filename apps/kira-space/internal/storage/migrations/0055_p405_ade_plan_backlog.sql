-- P405: a plan row can sit on the Backlog shelf (day stays NULL).
ALTER TABLE ade_task_plan ADD COLUMN backlog INTEGER NOT NULL DEFAULT 0 CHECK (backlog IN (0, 1));
