-- P287: the sandbox policy and profile a headless run started with, and the denials it hit.
CREATE TABLE ade_run_sandbox (
  run_id TEXT PRIMARY KEY REFERENCES ade_runs (id) ON DELETE CASCADE,
  access TEXT NOT NULL CHECK (access IN ('write', 'read', 'off')),
  enforced INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  policy_json TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '',
  denial_count INTEGER NOT NULL DEFAULT 0,
  denials_json TEXT NOT NULL DEFAULT '[]'
);
