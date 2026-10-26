-- Last write of the state row: idle pruning must not drop a repository mid-backfill.
ALTER TABLE git_host_sync_state ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE git_host_sync_state SET updated_at = max(last_full_sync_at, last_delta_at, last_checks_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
