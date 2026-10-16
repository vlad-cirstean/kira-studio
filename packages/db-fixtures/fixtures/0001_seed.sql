-- §9.1 dataset for packages/db-fixtures/postgres.spec.ts. Two schemas (so the tree has more than one to
-- list): `app` carries the bulk of the object-kind and catalog-edge-case coverage, `analytics`
-- exists purely so schema enumeration has something else to find.
--
-- Nothing here calls ANALYZE except big_rows at the very end — every other table is left with
-- Postgres's default "never analysed" reltuples = -1, which is exactly what scenario 6 in
-- postgres.spec.ts needs to assert (the adapter must surface that as `rowEstimate: null`, never
-- the raw -1).

-- Postgres creates a default, empty `public` schema in every new database. Drop it so schema
-- enumeration has exactly the two schemas this fixture actually populates — the plan's own
-- description of scenario 3 ("the database lists app and analytics") is exact, not "app,
-- analytics, and whatever else happens to exist by default".
DROP SCHEMA public;

CREATE SCHEMA app;
CREATE SCHEMA analytics;

-- ---------------------------------------------------------------------------------------------
-- wide_table — 60 columns spanning the type list the catalog code must format correctly.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.wide_table (
  id            bigserial PRIMARY KEY,
  int_a         int NOT NULL,
  int_b         int,
  int_c         int DEFAULT 0,
  int_d         int,
  int_e         int NOT NULL DEFAULT 1,
  int_f         int,
  int_g         int,
  bigint_a      bigint NOT NULL,
  bigint_b      bigint,
  bigint_c      bigint DEFAULT 0,
  numeric_a     numeric(20, 6) NOT NULL,
  numeric_b     numeric(20, 6),
  numeric_c     numeric(20, 6) DEFAULT 0,
  numeric_d     numeric(20, 6),
  text_a        text NOT NULL,
  text_b        text,
  text_c        text DEFAULT 'default value',
  text_d        text,
  text_e        text,
  text_f        text,
  text_g        text,
  text_h        text,
  text_i        text,
  varchar_a     varchar(50) NOT NULL,
  varchar_b     varchar(50),
  varchar_c     varchar(50) DEFAULT 'default',
  varchar_d     varchar(50),
  varchar_e     varchar(50),
  varchar_f     varchar(50),
  varchar_g     varchar(50),
  varchar_h     varchar(50),
  bool_a        bool NOT NULL DEFAULT false,
  bool_b        bool,
  bool_c        bool DEFAULT true,
  bool_d        bool,
  date_a        date NOT NULL DEFAULT CURRENT_DATE,
  date_b        date,
  date_c        date,
  date_d        date,
  ts_a          timestamptz NOT NULL DEFAULT now(),
  ts_b          timestamptz,
  ts_c          timestamptz,
  ts_d          timestamptz,
  ts_e          timestamptz,
  ts_f          timestamptz,
  uuid_a        uuid NOT NULL DEFAULT gen_random_uuid(),
  uuid_b        uuid,
  uuid_c        uuid,
  uuid_d        uuid,
  jsonb_a       jsonb,
  jsonb_b       jsonb,
  jsonb_c       jsonb,
  jsonb_d       jsonb,
  -- Defaulted like ts_a/uuid_a above so every row gets a real value without touching the INSERT
  -- column list — cell-editor.spec.ts's scenario 3 needs a non-NULL bytea_a to detect as hex.
  bytea_a       bytea DEFAULT '\xcafebabedeadbeef',
  bytea_b       bytea,
  bytea_c       bytea,
  intarray_a    int[],
  inet_a        inet,
  interval_a    interval
);

COMMENT ON COLUMN app.wide_table.id IS 'surrogate primary key';
COMMENT ON COLUMN app.wide_table.int_a IS 'a required integer with no default';
COMMENT ON COLUMN app.wide_table.text_c IS 'has a literal default';
COMMENT ON COLUMN app.wide_table.jsonb_a IS 'arbitrary JSON payload';
COMMENT ON TABLE app.wide_table IS 'covers every scalar type the catalog code must format';

INSERT INTO app.wide_table (
  int_a, bigint_a, numeric_a, text_a, varchar_a
) VALUES
  (1, 10, 1.5, 'row one', 'v1'),
  (2, 20, 2.5, 'row two', 'v2');

-- ---------------------------------------------------------------------------------------------
-- nulls_and_unicode — NULL vs empty-string distinction, unicode edge cases, oversized values.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.nulls_and_unicode (
  id       serial PRIMARY KEY,
  label    text,
  note     text,
  big_text text,
  big_blob bytea
);

-- Every nullable column NULL.
INSERT INTO app.nulls_and_unicode (label, note, big_text, big_blob) VALUES (NULL, NULL, NULL, NULL);
-- Empty strings — must render distinctly from NULL.
INSERT INTO app.nulls_and_unicode (label, note, big_text, big_blob) VALUES ('', '', '', ''::bytea);
-- Emoji, CJK, RTL, combining characters.
INSERT INTO app.nulls_and_unicode (label, note) VALUES (
  '😀🎉👍 emoji',
  '中文测试 日本語テスト 한국어 테스트 العربية עברית e' || chr(769) || ' combining acute'
);
-- 1 MB text value and a 256 KB bytea value.
INSERT INTO app.nulls_and_unicode (label, big_text, big_blob) VALUES (
  'oversized values',
  repeat('a', 1048576),
  decode(repeat('41', 262144), 'hex')
);

-- ---------------------------------------------------------------------------------------------
-- nested_json — 5-level nested jsonb with a 200-element array at the bottom.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.nested_json (
  id   serial PRIMARY KEY,
  data jsonb NOT NULL
);

INSERT INTO app.nested_json (id, data) VALUES (
  1,
  jsonb_build_object(
    'level1', jsonb_build_object(
      'level2', jsonb_build_object(
        'level3', jsonb_build_object(
          'level4', jsonb_build_object(
            'level5', jsonb_build_object(
              'value', 'deep',
              'items', (SELECT jsonb_agg(x) FROM generate_series(1, 200) AS x)
            )
          )
        )
      )
    )
  )
);

-- ---------------------------------------------------------------------------------------------
-- formats — one row per §8.6 autodetect format, all in a plain `text` column so the detector
-- has to work from the value alone (typeClass 'text' enables every detector, §5a). `kind` names
-- the expected detection and is asserted by tests/e2e/cell-editor.spec.ts, which looks rows up
-- by that value rather than by insertion order (P3 D20).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.formats (
  id     serial PRIMARY KEY,
  kind   text NOT NULL,
  sample text NOT NULL
);

INSERT INTO app.formats (kind, sample) VALUES
  -- A 20-digit integer literal — the lossless-roundtrip proof (P3 D10): it must survive
  -- Indented/Compact byte-for-byte.
  ('json', $${"id": 12345678901234567890, "name": "sample", "tags": ["a", "b"]}$$),
  ('xml', $$<?xml version="1.0"?><root attr="a value"><!-- a comment --><![CDATA[raw data]]></root>$$),
  ('sql', 'SELECT id, name FROM app.formats WHERE kind = ''json'' ORDER BY id'),
  -- base64 of "Hello, World!" — 13 bytes decoded (P3 D9's worked example).
  ('base64', 'SGVsbG8sIFdvcmxkIQ=='),
  ('hex', '0xcafebabedeadbeef'),
  ('epochSeconds', '1705315425'),
  ('epochMillis', '1705315425123'),
  ('iso8601', '2024-01-15T10:23:45.123Z'),
  ('uuid', '00000000-0000-0000-0000-000000000001'),
  ('url', 'https://example.com/path?q=1'),
  ('csv', $$a,b,c
1,2,3
4,5,6$$),
  ('text', 'The quick brown fox jumps over the lazy dog, a plain sentence of prose.'),
  -- Cut mid-string — §5b's 0.35 "looks like JSON, invalid at offset N" case.
  ('json-invalid', $${"a": "value truncated mid-string$$);

-- ---------------------------------------------------------------------------------------------
-- composite_pk — a two-column primary key.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.composite_pk (
  tenant_id int NOT NULL,
  entity_id int NOT NULL,
  name      text,
  PRIMARY KEY (tenant_id, entity_id)
);

INSERT INTO app.composite_pk (tenant_id, entity_id, name) VALUES
  (1, 1, 'tenant 1 / entity 1'),
  (1, 2, 'tenant 1 / entity 2'),
  (2, 1, 'tenant 2 / entity 1');

-- ---------------------------------------------------------------------------------------------
-- employees — self-referencing FK (D17's referencedBy-pointing-at-itself case).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.employees (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  manager_id int REFERENCES app.employees (id)
);

INSERT INTO app.employees (id, name, manager_id) VALUES
  (1, 'Ada', NULL),
  (2, 'Grace', 1),
  (3, 'Alan', 1);
SELECT setval('app.employees_id_seq', 3);

-- ---------------------------------------------------------------------------------------------
-- regions -> customers -> orders -> order_items <- products — a multi-hop FK graph so both
-- foreignKeys and referencedBy (D17) have something to assert.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.regions (
  id   serial PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE app.customers (
  id        serial PRIMARY KEY,
  name      text NOT NULL,
  region_id int REFERENCES app.regions (id)
);

CREATE TABLE app.products (
  id    serial PRIMARY KEY,
  name  text NOT NULL,
  price numeric(10, 2) NOT NULL
);

CREATE TABLE app.orders (
  id          serial PRIMARY KEY,
  customer_id int NOT NULL REFERENCES app.customers (id),
  ordered_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.order_items (
  id         serial PRIMARY KEY,
  order_id   int NOT NULL REFERENCES app.orders (id),
  product_id int NOT NULL REFERENCES app.products (id),
  quantity   int NOT NULL DEFAULT 1,
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0)
);

-- A second index on order_items besides its PK, so scenario 5's "one index per created index"
-- has more than the implicit one to assert against.
CREATE UNIQUE INDEX order_items_order_product_idx ON app.order_items (order_id, product_id);

INSERT INTO app.regions (id, name) VALUES (1, 'EMEA'), (2, 'APAC');
SELECT setval('app.regions_id_seq', 2);

INSERT INTO app.customers (id, name, region_id) VALUES (1, 'Acme Co', 1), (2, 'Globex', 2);
SELECT setval('app.customers_id_seq', 2);

INSERT INTO app.products (id, name, price) VALUES (1, 'Widget', 9.99), (2, 'Gadget', 19.99);
SELECT setval('app.products_id_seq', 2);

INSERT INTO app.orders (id, customer_id) VALUES (1, 1), (2, 2);
SELECT setval('app.orders_id_seq', 2);

INSERT INTO app.order_items (order_id, product_id, quantity) VALUES
  (1, 1, 2),
  (1, 2, 1),
  (2, 1, 5);

-- ---------------------------------------------------------------------------------------------
-- big_rows — 1,000,000 rows, ANALYZEd so reltuples is populated (the tree's ~N rows detail).
-- Row insertion + ANALYZE is done here rather than gated in support/postgres.ts so the table
-- itself always exists; startPostgres's seedBigTable option only skips the (slow) population.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app.big_rows (
  id   int PRIMARY KEY,
  hash text NOT NULL
);

-- ---------------------------------------------------------------------------------------------
-- One view, one materialized view, one sequence, one function, one procedure — every NodeKind
-- the adapter emits besides table/column (procedures share NodeKind 'function' by design, see
-- src/engine/adapters/postgres/catalog.ts's prokind IN ('f', 'p') query).
-- ---------------------------------------------------------------------------------------------
CREATE VIEW app.order_summary AS
  SELECT o.id AS order_id, c.name AS customer_name, count(oi.id) AS item_count
  FROM app.orders o
  JOIN app.customers c ON c.id = o.customer_id
  LEFT JOIN app.order_items oi ON oi.order_id = o.id
  GROUP BY o.id, c.name;

CREATE MATERIALIZED VIEW app.customer_totals AS
  SELECT c.id AS customer_id, c.name, count(o.id) AS order_count
  FROM app.customers c
  LEFT JOIN app.orders o ON o.customer_id = c.id
  GROUP BY c.id, c.name;

CREATE SEQUENCE app.invoice_number_seq START 1000;

CREATE FUNCTION app.full_name(first_name text, last_name text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT first_name || ' ' || last_name $$;

CREATE PROCEDURE app.noop_procedure() LANGUAGE plpgsql AS $$
BEGIN
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Identifier-quoting edge cases — a double-quote inside a table name, and a name with a space.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE app."weird""name" (
  id    serial PRIMARY KEY,
  value text
);
INSERT INTO app."weird""name" (value) VALUES ('quoting works');

CREATE TABLE app."Order Items" (
  id   serial PRIMARY KEY,
  note text
);
INSERT INTO app."Order Items" (note) VALUES ('space in identifier');

-- ---------------------------------------------------------------------------------------------
-- analytics — a second schema, so schema enumeration has more than one entry.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE analytics.events (
  id          serial PRIMARY KEY,
  event_name  text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO analytics.events (event_name) VALUES ('signup'), ('login');
