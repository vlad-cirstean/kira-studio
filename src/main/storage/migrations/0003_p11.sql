-- NULL = no pre-connect script. Deliberately its own column rather than an options_json key:
-- options_json round-trips through the connection URI (and the Copy URI menu item), and a shell
-- command must never be settable by pasting a URI.
ALTER TABLE connections ADD COLUMN preconnect TEXT;
