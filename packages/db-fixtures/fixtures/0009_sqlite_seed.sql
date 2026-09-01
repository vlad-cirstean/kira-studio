-- §9.1 dataset for tests/db/sqlite.spec.ts — a port of 0002_mariadb_seed.sql (plan D34), not a
-- copy: the same object graph so the same scenarios assert the same things, with every
-- divergence a documented engine difference rather than a convenience.
--   no CREATE SEQUENCE / FUNCTION / PROCEDURE  -> SQLite has none; their absence is asserted
--   ENGINE=InnoDB / charset clauses            -> dropped; SQLite has neither
--   UUID / ENUM / SET / MEDIUMBLOB             -> CHAR(36), TEXT-with-a-check-free-comment,
--                                                 no SET equivalent, plain BLOB (uncapped, D31)
--   `weird``name` / `Order Items`              -> "weird""name" / "Order Items" (F25)
--
-- Nothing here runs ANALYZE except big_rows (done in support/sqlite.ts after the bulk insert) —
-- every other table is left with no sqlite_stat1 row, which is exactly what scenario 6 in
-- sqlite.spec.ts needs to assert (the adapter must surface that as `rowEstimate: null`).

PRAGMA foreign_keys = ON;

-- -------------------------------------------------------------------------------------------
-- wide_table — columns spanning the type list the catalog code must format correctly.
-- -------------------------------------------------------------------------------------------
CREATE TABLE wide_table (
  id            INTEGER PRIMARY KEY,
  int_a         INTEGER NOT NULL,
  int_b         INTEGER,
  int_c         INTEGER DEFAULT 0,
  int_d         INTEGER,
  int_e         INTEGER NOT NULL DEFAULT 1,
  int_f         INTEGER,
  int_g         INTEGER,
  bigint_a      BIGINT NOT NULL,
  bigint_b      BIGINT,
  bigint_c      BIGINT DEFAULT 0,
  decimal_a     DECIMAL(20, 6) NOT NULL,
  decimal_b     DECIMAL(20, 6),
  decimal_c     DECIMAL(20, 6) DEFAULT 0,
  decimal_d     DECIMAL(20, 6),
  text_a        TEXT NOT NULL,
  text_b        TEXT,
  text_c        TEXT,
  text_d        TEXT,
  text_e        TEXT,
  text_f        TEXT,
  text_g        TEXT,
  text_h        TEXT,
  text_i        TEXT,
  varchar_a     VARCHAR(50) NOT NULL,
  varchar_b     VARCHAR(50),
  varchar_c     VARCHAR(50) DEFAULT 'default',
  varchar_d     VARCHAR(50),
  varchar_e     VARCHAR(50),
  varchar_f     VARCHAR(50),
  varchar_g     VARCHAR(50),
  varchar_h     VARCHAR(50),
  bool_a        BOOLEAN NOT NULL DEFAULT 0,
  bool_b        BOOLEAN,
  bool_c        BOOLEAN DEFAULT 1,
  bool_d        BOOLEAN,
  date_a        DATE NOT NULL DEFAULT (CURRENT_DATE),
  date_b        DATE,
  date_c        DATE,
  date_d        DATE,
  datetime_a    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  datetime_b    DATETIME,
  datetime_c    DATETIME,
  ts_a          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ts_b          TIMESTAMP,
  ts_c          TIMESTAMP,
  -- No native UUID type — a CHAR(36) stand-in, same as the ask's own callout for engines without one.
  uuid_a        CHAR(36) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  uuid_b        CHAR(36),
  uuid_c        CHAR(36),
  uuid_d        CHAR(36),
  json_a        JSON,
  json_b        JSON,
  json_c        JSON,
  json_d        JSON,
  blob_a        BLOB,
  blob_b        BLOB,
  blob_c        BLOB,
  -- No ENUM/SET types — a plain TEXT column stands in for enum_a; there is no SET equivalent at all.
  enum_a        TEXT NOT NULL DEFAULT 'medium'
);

INSERT INTO wide_table (
  int_a, bigint_a, decimal_a, text_a, varchar_a
) VALUES
  (1, 10, 1.5, 'row one', 'v1'),
  (2, 20, 2.5, 'row two', 'v2');

-- -------------------------------------------------------------------------------------------
-- nulls_and_unicode — NULL vs empty-string distinction, unicode edge cases, oversized values.
-- SQLite is UTF-8 throughout — no charset clause needed for the emoji to survive.
-- -------------------------------------------------------------------------------------------
CREATE TABLE nulls_and_unicode (
  id        INTEGER PRIMARY KEY,
  label     TEXT,
  note      TEXT,
  big_text  TEXT,
  big_blob  BLOB
);

-- Every nullable column NULL.
INSERT INTO nulls_and_unicode (label, note, big_text, big_blob) VALUES (NULL, NULL, NULL, NULL);
-- Empty strings — must render distinctly from NULL.
INSERT INTO nulls_and_unicode (label, note, big_text, big_blob) VALUES ('', '', '', '');
-- Emoji, CJK, RTL, combining characters.
INSERT INTO nulls_and_unicode (label, note) VALUES (
  '😀🎉👍 emoji',
  '中文测试 日本語テスト 한국어 테스트 العربية עברית e' || char(0x0301) || ' combining acute'
);
-- 1 MB text value and a 256 KB blob value.
INSERT INTO nulls_and_unicode (label, big_text, big_blob) VALUES (
  'oversized values',
  printf('%.1048576c', 'a'),
  randomblob(262144)
);

-- -------------------------------------------------------------------------------------------
-- nested_json — 5-level nested JSON with a 200-element array at the bottom.
-- -------------------------------------------------------------------------------------------
CREATE TABLE nested_json (
  id   INTEGER PRIMARY KEY,
  data JSON NOT NULL
);

INSERT INTO nested_json (id, data) VALUES (
  1,
  json_object(
    'level1', json_object(
      'level2', json_object(
        'level3', json_object(
          'level4', json_object(
            'level5', json(
              printf(
                '{"value":"deep","items":[%s]}',
                (WITH RECURSIVE seq(n) AS (
                   SELECT 1
                   UNION ALL
                   SELECT n + 1 FROM seq WHERE n < 200
                 )
                 SELECT group_concat(n) FROM seq)
              )
            )
          )
        )
      )
    )
  )
);

-- -------------------------------------------------------------------------------------------
-- composite_pk — a two-column primary key.
-- -------------------------------------------------------------------------------------------
CREATE TABLE composite_pk (
  tenant_id INTEGER NOT NULL,
  entity_id INTEGER NOT NULL,
  name      VARCHAR(255),
  PRIMARY KEY (tenant_id, entity_id)
);

INSERT INTO composite_pk (tenant_id, entity_id, name) VALUES
  (1, 1, 'tenant 1 / entity 1'),
  (1, 2, 'tenant 1 / entity 2'),
  (2, 1, 'tenant 2 / entity 1');

-- -------------------------------------------------------------------------------------------
-- employees — self-referencing FK (D17's referencedBy-pointing-at-itself case).
-- -------------------------------------------------------------------------------------------
CREATE TABLE employees (
  id         INTEGER PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  manager_id INTEGER NULL,
  CONSTRAINT fk_employees_manager FOREIGN KEY (manager_id) REFERENCES employees (id)
);

INSERT INTO employees (id, name, manager_id) VALUES
  (1, 'Ada', NULL),
  (2, 'Grace', 1),
  (3, 'Alan', 1);

-- -------------------------------------------------------------------------------------------
-- regions -> customers -> orders -> order_items <- products — a multi-hop FK graph so both
-- foreignKeys and referencedBy (D17) have something to assert.
-- -------------------------------------------------------------------------------------------
CREATE TABLE regions (
  id   INTEGER PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

CREATE TABLE customers (
  id        INTEGER PRIMARY KEY,
  name      VARCHAR(255) NOT NULL,
  region_id INTEGER NULL,
  CONSTRAINT fk_customers_region FOREIGN KEY (region_id) REFERENCES regions (id)
);

CREATE TABLE products (
  id    INTEGER PRIMARY KEY,
  name  VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2) NOT NULL
);

CREATE TABLE orders (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  ordered_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
);

CREATE TABLE order_items (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity   INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
  -- A second index besides the PK, so scenario 5's "one index per created index" has more than
  -- the implicit one to assert against.
  UNIQUE (order_id, product_id)
);

INSERT INTO regions (id, name) VALUES (1, 'EMEA'), (2, 'APAC');
INSERT INTO customers (id, name, region_id) VALUES (1, 'Acme Co', 1), (2, 'Globex', 2);
INSERT INTO products (id, name, price) VALUES (1, 'Widget', 9.99), (2, 'Gadget', 19.99);
INSERT INTO orders (id, customer_id) VALUES (1, 1), (2, 2);
INSERT INTO order_items (order_id, product_id, quantity) VALUES
  (1, 1, 2),
  (1, 2, 1),
  (2, 1, 5);

-- -------------------------------------------------------------------------------------------
-- big_rows — the table only; support/sqlite.ts inserts the 1,000,000 rows (via one plain
-- WITH RECURSIVE CTE — no chunking needed, unlike MariaDB/MySQL's SEQUENCE-engine or
-- cross-join workarounds) and runs ANALYZE, gated by its own seedBigTable option — the table
-- itself always exists regardless of that gate.
-- -------------------------------------------------------------------------------------------
CREATE TABLE big_rows (
  id      INTEGER PRIMARY KEY,
  payload CHAR(32) NOT NULL
);

-- -------------------------------------------------------------------------------------------
-- One view. No sequence, function or procedure — SQLite has none; their absence from the tree
-- (byKind('sequence') / byKind('function') both []) is asserted rather than pretended.
-- -------------------------------------------------------------------------------------------
CREATE VIEW order_summary AS
  SELECT o.id AS order_id, c.name AS customer_name, COUNT(oi.id) AS item_count
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN order_items oi ON oi.order_id = o.id
  GROUP BY o.id, c.name;

-- -------------------------------------------------------------------------------------------
-- Identifier-quoting edge cases — a double quote inside a table name, and a name with a space.
-- -------------------------------------------------------------------------------------------
CREATE TABLE "weird""name" (
  id    INTEGER PRIMARY KEY,
  value VARCHAR(255)
);
INSERT INTO "weird""name" (value) VALUES ('quoting works');

CREATE TABLE "Order Items" (
  id   INTEGER PRIMARY KEY,
  note VARCHAR(255)
);
INSERT INTO "Order Items" (note) VALUES ('space in identifier');

-- -------------------------------------------------------------------------------------------
-- Four SQLite-only tables — findings with no analogue on any other engine (plan D34).
-- -------------------------------------------------------------------------------------------

-- no_pk_rowid — no PRIMARY KEY at all, so it is a plain rowid table (D22's rowid keyset path,
-- and the table scenario 26 asserts `mutate()` refuses with E_UNSUPPORTED against).
CREATE TABLE no_pk_rowid (
  label VARCHAR(255) NOT NULL,
  value INTEGER
);
INSERT INTO no_pk_rowid (label, value) VALUES
  ('alpha', 1),
  ('beta', 2),
  ('gamma', 3),
  ('delta', 4),
  ('epsilon', 5);

-- without_rowid — WITHOUT ROWID, TEXT PK. Pages by its declared PK, never by rowid (F23/D22).
CREATE TABLE without_rowid (
  code  TEXT PRIMARY KEY,
  label VARCHAR(255) NOT NULL
) WITHOUT ROWID;
INSERT INTO without_rowid (code, label) VALUES
  ('a1', 'first'),
  ('a2', 'second'),
  ('a3', 'third');

-- generated_cols — a stored and a virtual generated column (F18: table_xinfo, not table_info,
-- is what surfaces both to the catalog code, since SELECT * returns them).
CREATE TABLE generated_cols (
  id INTEGER PRIMARY KEY,
  a  INTEGER NOT NULL,
  b  INTEGER GENERATED ALWAYS AS (a * 2) VIRTUAL,
  c  INTEGER GENERATED ALWAYS AS (a * 3) STORED
);
INSERT INTO generated_cols (id, a) VALUES (1, 5), (2, 10);

-- fts_docs — a full-text virtual table (F17/F24: brings five shadow tables that the tree must
-- filter out, and the sqlite_-prefixed catalog rows those shadow tables carry).
CREATE VIRTUAL TABLE fts_docs USING fts5(title, body);
INSERT INTO fts_docs (title, body) VALUES
  ('First document', 'The quick brown fox jumps over the lazy dog'),
  ('Second document', 'SQLite is a self-contained, serverless SQL database engine');
