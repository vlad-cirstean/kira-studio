-- Questionable facts without a verdict per extracted file; -1 means not computed yet. Claims read it
-- instead of reloading every extracted file each scheduler tick.
ALTER TABLE import_files ADD COLUMN verify_pending INTEGER NOT NULL DEFAULT -1;
