-- Misc-fixes: explicit per-connection override of P11/D5's settle-window auto-detection.
-- 0 = "run each time it tries to connect" (default; matches the app's prior behavior for every
-- existing row). 1 = "run once, and disconnect the db when it dies" — always arm() after connect.
ALTER TABLE connections ADD COLUMN preconnect_sidecar INTEGER NOT NULL DEFAULT 0;
