-- P318: ADE link and viewed-sync storage lose their GitHub names; the ledger records its provider.
ALTER TABLE ade_tasks RENAME COLUMN github_url TO host_url;
ALTER TABLE ade_backlog RENAME COLUMN github_url TO host_url;
ALTER TABLE ade_gh_synced RENAME TO ade_viewed_sync;
ALTER TABLE ade_viewed_sync RENAME COLUMN pr_number TO change_number;
ALTER TABLE ade_viewed_sync ADD COLUMN provider TEXT NOT NULL DEFAULT 'github';
