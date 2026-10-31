-- P405: backlog items become repo-less tasks on the Backlog shelf, in their old order.
INSERT INTO ade_tasks (id, kind, title, owner, jira_key, jira_url, host_url, workflow_id, entry_step_id, since_json, est, notes, color, created_at, archived_at, status_id, status_by, status_step)
SELECT b.id, 'task', b.text, '', b.jira_key, b.jira_url, b.host_url, '', '', NULL, '', b.notes,
  (ROW_NUMBER() OVER (ORDER BY b.position, b.id) - 1) % 20, b.added_at, NULL,
  COALESCE((SELECT s.id FROM ade_task_statuses s WHERE s.category = 'todo' ORDER BY s.position LIMIT 1), 'todo'),
  'auto', ''
FROM ade_backlog b;

INSERT INTO ade_task_plan (task_id, day, position, backlog)
SELECT b.id, NULL,
  COALESCE((SELECT MAX(position) FROM ade_task_plan), -1) + ROW_NUMBER() OVER (ORDER BY b.position, b.id),
  1
FROM ade_backlog b;

DROP TABLE ade_backlog;
