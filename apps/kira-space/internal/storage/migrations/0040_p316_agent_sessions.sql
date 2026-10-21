-- P316: sessions and script runs remember the agent provider that ran them.
ALTER TABLE ade_sessions RENAME COLUMN claude_session_id TO agent_session_id;
ALTER TABLE ade_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';
ALTER TABLE script_runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';
