-- §9.1 dataset for tests/db/clickhouse.spec.ts — a port of 0008_mysql_seed.sql (P36 D36), not a
-- copy: the same object graph, translated into ClickHouse's own grammar, so the same scenarios
-- assert the same things wherever the two engines can agree. Every divergence is a documented
-- engine difference, not an oversight:
--   PRIMARY KEY / FOREIGN KEY / UNIQUE / AUTO_INCREMENT -> ORDER BY, and no FK at all (F16/F17:
--     ClickHouse has neither concept — every id column below is an explicit, hand-assigned value)
--   ENGINE = InnoDB                                      -> ENGINE = MergeTree (or a named variant)
--   CREATE SEQUENCE / FUNCTION / PROCEDURE                -> removed entirely; clickhouse.spec.ts's
--     tree scenario asserts byKind('sequence') and byKind('function') are both []
--   VARCHAR/TEXT/BLOB                                     -> String (F24: ClickHouse's own docs
--     describe String as replacing all three)
--   `weird``name` / `Order Items`                         -> unchanged; ClickHouse backtick-quotes
--     identifiers the same way (F28)
--
-- Executed by tests/db/support/clickhouse.ts one statement at a time (splitSqlStatements) against
-- a client scoped to `database: kira_test` — every unqualified name below resolves against that
-- client-level default, so there is no leading `USE` statement to write (the ClickHouse HTTP
-- interface has no session state to `USE` into in the first place, D13).
--
-- Six tables exist only here, each earning its own clickhouse.spec.ts scenario (D36):
--   dup_keys        (34) — ReplacingMergeTree, two rows sharing one ORDER BY tuple: F16's proof
--   wide_types       (35/36/37) — the type-diversity table, plus the big-integer and NULL/"null"/NaN cases
--   generated_cols  (39) — a DEFAULT, a MATERIALIZED and an ALIAS column
--   commented       (44) — a table comment and per-column comments
--   no_sorting_key  (38) — ENGINE = Memory: no sorting key (total_rows is still reported)
--   big_rows        (6/38/45) — 1,000,000 rows from numbers(1000000), one statement, no chunking

-- -------------------------------------------------------------------------------------------
-- wide_table — a representative slice of 0008's 59-column table: nullable/default/comment
-- coverage across ClickHouse's own major scalar families, minus the exhaustive width (wide_types
-- below carries the exotic/composite types instead, so this table stays a readable size).
-- -------------------------------------------------------------------------------------------
CREATE TABLE wide_table (
  id          UInt64,
  int_a       Int32,
  int_b       Nullable(Int32),
  int_c       Int32 DEFAULT 0,
  bigint_a    Int64,
  decimal_a   Decimal(20, 6),
  decimal_b   Nullable(Decimal(20, 6)),
  text_a      String,
  text_b      Nullable(String),
  varchar_a   String,
  varchar_c   String DEFAULT 'default',
  bool_a      Bool DEFAULT false,
  date_a      Date DEFAULT today(),
  datetime_a  DateTime64(6) DEFAULT now64(6),
  ts_a        DateTime DEFAULT now(),
  uuid_a      UUID DEFAULT generateUUIDv4(),
  json_a      Nullable(String)
) ENGINE = MergeTree ORDER BY id
COMMENT 'covers every scalar type family the catalog code must format';

ALTER TABLE wide_table MODIFY COLUMN id UInt64 COMMENT 'surrogate primary key';
ALTER TABLE wide_table MODIFY COLUMN int_a Int32 COMMENT 'a required integer with no default';
ALTER TABLE wide_table MODIFY COLUMN varchar_c String DEFAULT 'default' COMMENT 'has a literal default';
ALTER TABLE wide_table MODIFY COLUMN json_a Nullable(String) COMMENT 'arbitrary JSON payload, stored as text';

INSERT INTO wide_table (id, int_a, bigint_a, decimal_a, text_a, varchar_a) VALUES
  (1, 1, 10, 1.5, 'row one', 'v1'),
  (2, 2, 20, 2.5, 'row two', 'v2');

-- -------------------------------------------------------------------------------------------
-- nulls_and_unicode — NULL vs empty-string distinction, unicode edge cases, an oversized value.
-- -------------------------------------------------------------------------------------------
CREATE TABLE nulls_and_unicode (
  id        UInt32,
  label     Nullable(String),
  note      Nullable(String),
  big_text  Nullable(String),
  big_blob  Nullable(String)
) ENGINE = MergeTree ORDER BY id;

-- Every nullable column NULL.
INSERT INTO nulls_and_unicode (id, label, note, big_text, big_blob) VALUES (1, NULL, NULL, NULL, NULL);
-- Empty strings — must render distinctly from NULL.
INSERT INTO nulls_and_unicode (id, label, note, big_text, big_blob) VALUES (2, '', '', '', '');
-- Emoji, CJK, RTL, combining characters.
INSERT INTO nulls_and_unicode (id, label, note) VALUES (
  3,
  '😀🎉👍 emoji',
  concat('中文测试 日本語テスト 한국어 테스트 العربية עברית e', '́', ' combining acute')
);
-- A ~1 MB text value and a 256 KB "blob" value (plain bytes stored in a String column —
-- ClickHouse has no separate blob type, F24). repeat()'s count is capped at 1,000,000 server-side,
-- so this lands just under a full MB rather than exactly at one.
INSERT INTO nulls_and_unicode (id, label, big_text, big_blob) VALUES (
  4,
  'oversized values',
  repeat('a', 1000000),
  repeat('A', 262144)
);

-- -------------------------------------------------------------------------------------------
-- nested_json — 5-level nested JSON with a 200-element array at the bottom, stored as text
-- (F24: no experimental JSON type dependency needed to build or read this fixture).
-- -------------------------------------------------------------------------------------------
CREATE TABLE nested_json (
  id   UInt32,
  data String
) ENGINE = MergeTree ORDER BY id;

INSERT INTO nested_json (id, data)
SELECT
  1,
  concat(
    '{"level1":{"level2":{"level3":{"level4":{"level5":{"value":"deep","items":[',
    arrayStringConcat(arrayMap(x -> toString(x), range(1, 201)), ','),
    ']}}}}}}'
  );

-- -------------------------------------------------------------------------------------------
-- composite_key — a two-column ORDER BY, the closest ClickHouse analog to 0008's composite_pk
-- (F16: still not unique — three rows here happen not to collide, unlike dup_keys below).
-- -------------------------------------------------------------------------------------------
CREATE TABLE composite_key (
  tenant_id UInt32,
  entity_id UInt32,
  name      Nullable(String)
) ENGINE = MergeTree ORDER BY (tenant_id, entity_id);

INSERT INTO composite_key (tenant_id, entity_id, name) VALUES
  (1, 1, 'tenant 1 / entity 1'),
  (1, 2, 'tenant 1 / entity 2'),
  (2, 1, 'tenant 2 / entity 1');

-- -------------------------------------------------------------------------------------------
-- employees — self-referencing (no real FK — F17 — but the same object shape, for describe()'s
-- own sake).
-- -------------------------------------------------------------------------------------------
CREATE TABLE employees (
  id         UInt32,
  name       String,
  manager_id Nullable(UInt32)
) ENGINE = MergeTree ORDER BY id;

INSERT INTO employees (id, name, manager_id) VALUES
  (1, 'Ada', NULL),
  (2, 'Grace', 1),
  (3, 'Alan', 1);

-- -------------------------------------------------------------------------------------------
-- regions -> customers -> orders -> order_items <- products — the same multi-hop object graph
-- 0008 uses, minus any real foreign key (F17): describe().foreignKeys/referencedBy are always []
-- here regardless of this shape, so these tables exist purely to give the read/browse scenarios
-- real, joined-looking data to work with.
-- -------------------------------------------------------------------------------------------
CREATE TABLE regions (
  id   UInt32,
  name String
) ENGINE = MergeTree ORDER BY id;

CREATE TABLE customers (
  id        UInt32,
  name      String,
  region_id Nullable(UInt32)
) ENGINE = MergeTree ORDER BY id;

CREATE TABLE products (
  id    UInt32,
  name  String,
  price Decimal(10, 2)
) ENGINE = MergeTree ORDER BY id;

CREATE TABLE orders (
  id          UInt32,
  customer_id UInt32,
  ordered_at  DateTime DEFAULT now()
) ENGINE = MergeTree ORDER BY id;

CREATE TABLE order_items (
  id         UInt32,
  order_id   UInt32,
  product_id UInt32,
  quantity   UInt32 DEFAULT 1,
  -- F18: ClickHouse does have a CHECK catalog (system.constraints), unlike SQLite's own gap
  -- (P35 D24) — this is the row definition.ts's constraints section round-trips (scenario 40).
  CONSTRAINT order_items_quantity_positive CHECK quantity > 0
) ENGINE = MergeTree ORDER BY id;

INSERT INTO regions (id, name) VALUES (1, 'EMEA'), (2, 'APAC');
INSERT INTO customers (id, name, region_id) VALUES (1, 'Acme Co', 1), (2, 'Globex', 2);
INSERT INTO products (id, name, price) VALUES (1, 'Widget', 9.99), (2, 'Gadget', 19.99);
INSERT INTO orders (id, customer_id) VALUES (1, 1), (2, 2);
INSERT INTO order_items (id, order_id, product_id, quantity) VALUES
  (1, 1, 1, 2),
  (2, 1, 2, 1),
  (3, 2, 1, 5);

-- -------------------------------------------------------------------------------------------
-- dup_keys (34) — ReplacingMergeTree, two rows sharing an identical ORDER BY tuple, inserted as
-- two separate statements so they land in two separate parts and are never merged (no OPTIMIZE
-- runs here) — both are still readable, which is F16 turned directly into an assertion: a
-- MergeTree PRIMARY KEY is a sparse index, not a uniqueness constraint, even under the one engine
-- variant whose name suggests otherwise.
-- -------------------------------------------------------------------------------------------
CREATE TABLE dup_keys (
  id   UInt32,
  note String
) ENGINE = ReplacingMergeTree ORDER BY id;

INSERT INTO dup_keys (id, note) VALUES (1, 'first');
INSERT INTO dup_keys (id, note) VALUES (1, 'second');

-- -------------------------------------------------------------------------------------------
-- wide_types (35/36/37) — Array/Tuple/Map/Enum8/UUID/IPv4/IPv6/Decimal128/DateTime64/FixedString/
-- LowCardinality(String)/LowCardinality(Nullable(String)), plus the big-integer and NULL-vs-"null"
-- vs-NaN cases folded into the same table rather than a seventh one.
-- -------------------------------------------------------------------------------------------
CREATE TABLE wide_types (
  id            UInt32,
  arr           Array(String),
  tup           Tuple(UInt8, String),
  mp            Map(String, UInt64),
  en            Enum8('red' = 1, 'green' = 2, 'blue' = 3),
  uid           UUID,
  ip4           IPv4,
  ip6           IPv6,
  -- Decimal128(20): scale 20, so up to 18 integer digits — 38 significant digits total, the exact
  -- width scenario 36 asserts keeps every digit.
  dec           Decimal128(20),
  dt64          DateTime64(3, 'UTC'),
  fixed         FixedString(8),
  lc            LowCardinality(String),
  lc_nullable   LowCardinality(Nullable(String)),
  -- Scenario 36: the maximum UInt64 value — the width no JS number can hold exactly.
  big_uint      UInt64,
  -- Scenario 37: NULL (row 1) vs the literal text "null" (row 2) must render distinctly.
  nullable_val  Nullable(String),
  -- Scenario 37: NaN (row 2) must not come back as NULL.
  float_val     Float64
) ENGINE = MergeTree ORDER BY id;

INSERT INTO wide_types (
  id, arr, tup, mp, en, uid, ip4, ip6, dec, dt64, fixed, lc, lc_nullable, big_uint, nullable_val, float_val
) VALUES (
  1,
  ['a', 'b', 'c'],
  (7, 'seven'),
  map('k1', 1, 'k2', 2),
  'green',
  toUUID('61f0c404-5cb3-11e7-907b-a6006ad3dba0'),
  toIPv4('192.168.1.1'),
  toIPv6('2001:db8::1'),
  toDecimal128('123456789012345678.12345678901234567890', 20),
  toDateTime64('2024-06-01 12:00:00.123', 3, 'UTC'),
  'abcdefgh',
  'low',
  'low',
  18446744073709551615,
  NULL,
  1.5
);
INSERT INTO wide_types (
  id, arr, tup, mp, en, uid, ip4, ip6, dec, dt64, fixed, lc, lc_nullable, big_uint, nullable_val, float_val
) VALUES (
  2,
  [],
  (0, ''),
  map(),
  'red',
  toUUID('00000000-0000-0000-0000-000000000000'),
  toIPv4('0.0.0.0'),
  toIPv6('::'),
  toDecimal128('0', 20),
  toDateTime64('2024-01-01 00:00:00.000', 3, 'UTC'),
  'xxxxxxxx',
  'low',
  NULL,
  0,
  'null',
  nan
);

-- -------------------------------------------------------------------------------------------
-- generated_cols (39) — a DEFAULT column (`a`, still insertable) beside a MATERIALIZED column
-- (`b`) and an ALIAS column (`c`) — neither of the latter two is insertable (F15).
-- -------------------------------------------------------------------------------------------
CREATE TABLE generated_cols (
  id UInt32,
  a  UInt32 DEFAULT 0,
  b  UInt32 MATERIALIZED a * 2,
  c  UInt32 ALIAS a * 3
) ENGINE = MergeTree ORDER BY id;

INSERT INTO generated_cols (id, a) VALUES (1, 5), (2, 10);

-- -------------------------------------------------------------------------------------------
-- commented (44) — a table comment and per-column comments. `regions` above has neither, and is
-- what scenario 44's "no comment reports null, not ''" case reads.
-- -------------------------------------------------------------------------------------------
CREATE TABLE commented (
  id   UInt32 COMMENT 'the identifying key',
  name String COMMENT 'a short label'
) ENGINE = MergeTree ORDER BY id
COMMENT 'a table with its own comment';

INSERT INTO commented (id, name) VALUES (1, 'first'), (2, 'second');

-- -------------------------------------------------------------------------------------------
-- no_sorting_key (38) — the Memory engine has no ORDER BY, no PARTITION BY and no part metadata:
-- system.tables.sorting_key is '' here (D17/D21's null path). total_rows is NOT null though —
-- checked against clickhouse-server 26.3.21.7, Memory keeps every row in an in-process array, so
-- system.tables reports a real count (2) the same trivial way it would for any other engine.
-- -------------------------------------------------------------------------------------------
CREATE TABLE no_sorting_key (
  id    UInt32,
  value String
) ENGINE = Memory;

INSERT INTO no_sorting_key (id, value) VALUES (1, 'a'), (2, 'b');

-- -------------------------------------------------------------------------------------------
-- big_rows (6/38/45) — the table only; the 1,000,000 rows are inserted right here, as one
-- statement fed by ClickHouse's own numbers() table function — no client-side chunking, unlike
-- MariaDB's seq_1_to_N or MySQL's six-way digit cross join (P34 D28).
-- -------------------------------------------------------------------------------------------
CREATE TABLE big_rows (
  id      UInt32,
  payload String
) ENGINE = MergeTree ORDER BY id;

INSERT INTO big_rows SELECT number AS id, hex(MD5(toString(number))) AS payload FROM numbers(1000000);

-- -------------------------------------------------------------------------------------------
-- One view and one materialized view — every NodeKind the adapter can emit besides table/column
-- (D15): no sequence, no function, no procedure kind exists for ClickHouse at all, so
-- clickhouse.spec.ts's tree scenario asserts byKind('sequence') and byKind('function') are both
-- [] rather than seeding rows for either.
-- -------------------------------------------------------------------------------------------
CREATE VIEW order_summary AS
  SELECT o.id AS order_id, c.name AS customer_name, count(oi.id) AS item_count
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN order_items oi ON oi.order_id = o.id
  GROUP BY o.id, c.name;

CREATE MATERIALIZED VIEW order_summary_mv
ENGINE = MergeTree ORDER BY id
POPULATE
AS SELECT id, customer_id FROM orders;

-- -------------------------------------------------------------------------------------------
-- Identifier-quoting edge cases — a backtick inside a table name, and a name with a space.
-- ClickHouse backtick-quotes identifiers the same way MariaDB/MySQL do (F28).
-- -------------------------------------------------------------------------------------------
CREATE TABLE `weird``name` (
  id    UInt32,
  value String
) ENGINE = MergeTree ORDER BY id;
INSERT INTO `weird``name` (id, value) VALUES (1, 'quoting works');

CREATE TABLE `Order Items` (
  id   UInt32,
  note String
) ENGINE = MergeTree ORDER BY id;
INSERT INTO `Order Items` (id, note) VALUES (1, 'space in identifier');

-- P2 R1: a trailing backslash — unlike a backtick, ClickHouse's identifier lexer reads a raw
-- backslash as an escape introducer (the same rules as a string literal), so quoteIdent must
-- double it too; `\\` written here is the correctly-escaped form of the one-character name
-- `trail\`.
CREATE TABLE `trail\\` (
  id    UInt32,
  value String
) ENGINE = MergeTree ORDER BY id;
INSERT INTO `trail\\` (id, value) VALUES (1, 'backslash quoting works');
