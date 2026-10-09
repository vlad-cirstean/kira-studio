-- P241: task branch base stacking and pending-rebase mark, rebase runs.
ALTER TABLE ade_task_branches ADD COLUMN base_branch_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ade_task_branches ADD COLUMN base_pending_from TEXT NOT NULL DEFAULT '';
ALTER TABLE ade_runs ADD COLUMN purpose TEXT NOT NULL DEFAULT '' CHECK (purpose IN ('', 'rebase'));
ALTER TABLE ade_runs ADD COLUMN spec_json TEXT NOT NULL DEFAULT '';
CREATE INDEX ade_runs_branch_purpose ON ade_runs (branch_id, purpose);
