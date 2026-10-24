-- P332: the default app an extension had before Kira Space took it, so turning the switch off can restore it.
CREATE TABLE file_handler_previous (
    ext       TEXT PRIMARY KEY,
    app_path  TEXT NOT NULL,
    bundle_id TEXT NOT NULL,
    saved_at  INTEGER NOT NULL
);
