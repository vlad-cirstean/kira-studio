-- P158: todo progress dropped (user decision); SQLite cannot DROP COLUMN under the table CHECK.
CREATE TABLE ade_runs_new (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ade_tasks (id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL, step_id TEXT NOT NULL, branch_id TEXT NOT NULL DEFAULT '',
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  state TEXT NOT NULL CHECK (state IN ('pending','running','stuck','failed','back','done')),
  loops INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '', exit_code INTEGER,
  started_at INTEGER, finished_at INTEGER,
  launch_note TEXT NOT NULL DEFAULT '', launch_resume_id TEXT NOT NULL DEFAULT '',
  launch_prompt TEXT NOT NULL DEFAULT '', launch_extra TEXT NOT NULL DEFAULT ''
);
INSERT INTO ade_runs_new (id, task_id, stage_id, step_id, branch_id, attempt, state, loops, note,
  summary, session_id, exit_code, started_at, finished_at, launch_note, launch_resume_id,
  launch_prompt, launch_extra)
  SELECT id, task_id, stage_id, step_id, branch_id, attempt, state, loops, note, summary,
    session_id, exit_code, started_at, finished_at, launch_note, launch_resume_id,
    launch_prompt, launch_extra FROM ade_runs;
DROP TABLE ade_runs;
ALTER TABLE ade_runs_new RENAME TO ade_runs;
CREATE INDEX ade_runs_task ON ade_runs (task_id);
CREATE INDEX ade_runs_state ON ade_runs (state);
