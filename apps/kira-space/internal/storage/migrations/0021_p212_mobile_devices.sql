-- P212: phones paired with the mobile agents web. Same trust shape as git_clients (salted token
-- hash, soft revoke), plus what the pairing prompt showed: user agent and last remote address.
CREATE TABLE mobile_devices (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  user_agent   TEXT NOT NULL,
  token_hash   BLOB NOT NULL,
  token_salt   BLOB NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_ip      TEXT NOT NULL,
  revoked_at   INTEGER
);
