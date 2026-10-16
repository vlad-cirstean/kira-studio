-- P156: a held run's launch spec (send-back resume) persists until the run launches.
ALTER TABLE ade_runs ADD COLUMN launch_note TEXT NOT NULL DEFAULT '';
ALTER TABLE ade_runs ADD COLUMN launch_resume_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ade_runs ADD COLUMN launch_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE ade_runs ADD COLUMN launch_extra TEXT NOT NULL DEFAULT '';
