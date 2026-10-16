-- P177: archived-task log purge lookups.
CREATE INDEX ade_logs_task ON ade_logs (task_id);
CREATE INDEX ade_tasks_archived ON ade_tasks (archived_at) WHERE archived_at IS NOT NULL;
