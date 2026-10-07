-- P199: '' = user-made, 'agent' = declared or named by an agent through the Kira Space MCP.
ALTER TABLE ade_task_branches ADD COLUMN origin TEXT NOT NULL DEFAULT '' CHECK (origin IN ('', 'agent'));
