-- P407: stage handovers. One row per stage move, plus at most one open draft per (task, stage) that
-- sessions write before the move. Names are snapshots so a workflow edit never rewrites history.
CREATE TABLE ade_task_handovers (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ade_tasks (id) ON DELETE CASCADE,
  from_step_id TEXT NOT NULL,
  from_step_name TEXT NOT NULL,
  to_step_id TEXT NOT NULL DEFAULT '',
  to_step_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('agent', 'run', 'user')),
  state TEXT NOT NULL CHECK (state IN ('draft', 'handed')),
  finished INTEGER NOT NULL DEFAULT 0 CHECK (finished IN (0, 1)),
  dismissed INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0, 1)),
  edited INTEGER NOT NULL DEFAULT 0 CHECK (edited IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ade_task_handovers_draft ON ade_task_handovers (task_id, from_step_id) WHERE state = 'draft';
CREATE INDEX ade_task_handovers_task ON ade_task_handovers (task_id, created_at);
