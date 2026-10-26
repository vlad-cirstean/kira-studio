-- P352: persistent per-repo index of code host change requests, and the state of its sync.
-- Times are Unix milliseconds. repo_key is provider|host|owner/name, lower-cased.
CREATE TABLE git_host_change_requests (
    repo_key        TEXT    NOT NULL,
    number          INTEGER NOT NULL,
    node_id         TEXT    NOT NULL DEFAULT '',
    head_ref        TEXT    NOT NULL,
    head_owner      TEXT    NOT NULL COLLATE NOCASE,
    head_sha        TEXT    NOT NULL,
    base_ref        TEXT    NOT NULL,
    state           TEXT    NOT NULL,
    draft           INTEGER NOT NULL DEFAULT 0,
    title           TEXT    NOT NULL,
    url             TEXT    NOT NULL,
    review_decision TEXT    NOT NULL DEFAULT '',
    checks_state    TEXT    NOT NULL DEFAULT '',
    updated_at      INTEGER NOT NULL,
    synced_at       INTEGER NOT NULL,
    PRIMARY KEY (repo_key, number)
);
CREATE INDEX git_host_change_requests_head ON git_host_change_requests (repo_key, head_owner, head_ref);

CREATE TABLE git_host_sync_state (
    repo_key             TEXT PRIMARY KEY,
    account              TEXT    NOT NULL,
    watermark_updated_at INTEGER NOT NULL DEFAULT 0,
    etag                 TEXT    NOT NULL DEFAULT '',
    last_full_sync_at    INTEGER NOT NULL DEFAULT 0,
    last_delta_at        INTEGER NOT NULL DEFAULT 0,
    last_checks_at       INTEGER NOT NULL DEFAULT 0,
    backfill_cursor      TEXT    NOT NULL DEFAULT '',
    backfill_complete    INTEGER NOT NULL DEFAULT 0,
    schema_version       INTEGER NOT NULL DEFAULT 1
);
