-- P399: change request recorded when a task is archived, so the archived view shows it offline.
ALTER TABLE ade_task_branches ADD COLUMN cr_number INTEGER;
ALTER TABLE ade_task_branches ADD COLUMN cr_title TEXT;
ALTER TABLE ade_task_branches ADD COLUMN cr_state TEXT;
ALTER TABLE ade_task_branches ADD COLUMN cr_url TEXT;
