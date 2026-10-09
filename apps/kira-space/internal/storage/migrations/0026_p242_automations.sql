-- P242 Part 1: stored run outcome for ADE runs.
ALTER TABLE ade_runs ADD COLUMN outcome_json TEXT NOT NULL DEFAULT '';
