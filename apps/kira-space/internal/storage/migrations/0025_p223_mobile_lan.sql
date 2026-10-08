-- P223: plain HTTP on the trusted LAN. Phones paired over HTTPS hold a Secure __Host- cookie that
-- plain HTTP never sends, so their rows are revoked; device tokens now expire.
ALTER TABLE mobile_devices ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
UPDATE mobile_devices SET revoked_at = CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE revoked_at IS NULL;
CREATE TABLE mobile_trusted_network (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  subnet      TEXT NOT NULL,
  router_ip   TEXT NOT NULL,
  router_mac  TEXT NOT NULL,
  interface   TEXT NOT NULL,
  trusted_at  INTEGER NOT NULL
);
UPDATE settings SET key = 'mobile.port' WHERE key = 'mobile.httpsPort';
DELETE FROM settings WHERE key = 'mobile.setupPort';
