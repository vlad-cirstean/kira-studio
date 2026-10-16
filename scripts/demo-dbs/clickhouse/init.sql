-- Kira Studio — ClickHouse seed schema
-- Database: kira  (user: kira / password: kira)
--
-- The same e-commerce model every other relational demo uses, re-expressed in MergeTree terms
-- (P36 D38): PRIMARY KEY/FOREIGN KEY/UNIQUE/AUTO_INCREMENT all become an explicit id column plus
-- ORDER BY — ClickHouse has none of the first three (F16/F17), and every id below is a
-- hand-assigned value, not a generated one. data_types_demo shows ClickHouse's own type
-- vocabulary rather than a literal port of the others' columns, the same call
-- scripts/demo-dbs/sqlite/seed.ts already makes for its own engine's types.
--
-- USE kira below is required: the official image's docker-entrypoint-initdb.d runner builds its
-- clickhouse-client invocation with no --database flag (CLICKHOUSE_DB only creates the database,
-- it does not select it for init scripts), so every CREATE TABLE without this landed in `default`
-- — leaving `kira` empty and seed.sh's `--database kira` failing with UNKNOWN_TABLE.
USE kira;

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
    id             UInt64,
    email          String,
    full_name      String,
    nickname       Nullable(String),
    salutation     Nullable(String),
    is_active      Bool DEFAULT true,
    balance        Decimal(14, 2) DEFAULT 0,
    loyalty_points Nullable(Int32) DEFAULT 0,
    discount_rate  Nullable(Float32) DEFAULT 0,
    lifetime_value Nullable(Float64) DEFAULT 0,
    birth_date     Nullable(Date),
    signup_dt      DateTime DEFAULT now(),
    signup_ts      Nullable(DateTime),
    last_seen      Nullable(String),
    birth_year     Nullable(UInt16),
    avatar         Nullable(String),
    profile        Nullable(String) COMMENT 'JSON payload, stored as text',
    legacy_profile Nullable(String),
    tags           Array(LowCardinality(String)),
    status         Enum8('active' = 1, 'suspended' = 2, 'deleted' = 3),
    flags          UInt8,
    ip             Nullable(IPv6),
    raw_bytes      Nullable(String),
    uuid           UUID DEFAULT generateUUIDv4(),
    geo            Tuple(Float64, Float64),
    created_at     DateTime64(6) DEFAULT now64(6)
) ENGINE = MergeTree ORDER BY id
COMMENT 'customer accounts';

-- ---------------------------------------------------------------------------
-- customer_addresses
-- ---------------------------------------------------------------------------
CREATE TABLE customer_addresses (
    id          UInt64,
    customer_id UInt64,
    label       String,
    street      String,
    city        String,
    region      Nullable(String),
    postal_code Nullable(String),
    country     FixedString(2),
    is_default  Bool DEFAULT false,
    phone       Nullable(String),
    created_at  DateTime DEFAULT now()
) ENGINE = MergeTree ORDER BY id;

-- ---------------------------------------------------------------------------
-- categories (self-referencing — no real FK, F17)
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
    id          UInt64,
    parent_id   Nullable(UInt64),
    name        String,
    slug        String,
    description Nullable(String),
    sort_order  Int32 DEFAULT 0,
    created_at  DateTime DEFAULT now()
) ENGINE = MergeTree ORDER BY id;

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
CREATE TABLE products (
    id             UInt64,
    category_id    Nullable(UInt64),
    sku            String,
    name           String,
    description    Nullable(String),
    long_desc      Nullable(String),
    price          Decimal(12, 2),
    old_price      Nullable(Decimal(12, 2)),
    cost           Nullable(Decimal(12, 2)),
    weight_grams   Nullable(Int32),
    volume_ml      Nullable(Int16),
    weight_lbs     Nullable(Float32),
    stock          Int32 DEFAULT 0,
    reorder_level  Nullable(Int32) DEFAULT 10,
    rating         Nullable(Float64) DEFAULT 0,
    review_count   Nullable(Int32) DEFAULT 0,
    is_featured    Bool DEFAULT false,
    is_published   Bool DEFAULT true,
    available_from Nullable(Date),
    available_at   Nullable(DateTime),
    lead_time_days Nullable(Int16),
    attributes     Nullable(String) COMMENT 'JSON payload, stored as text',
    options        Nullable(String),
    images         Nullable(String),
    geo            Array(Tuple(Float64, Float64))
) ENGINE = MergeTree ORDER BY id;

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
    id          UInt64,
    customer_id UInt64,
    address_id  Nullable(UInt64),
    reference   Nullable(UUID),
    status      Enum8('pending' = 1, 'paid' = 2, 'shipped' = 3, 'delivered' = 4, 'cancelled' = 5)
                DEFAULT 'pending',
    total       Decimal(14, 2),
    discount    Nullable(Decimal(14, 2)) DEFAULT 0,
    tax         Nullable(Decimal(14, 2)) DEFAULT 0,
    placed_at   DateTime64(6) DEFAULT now64(6),
    updated_at  Nullable(DateTime64(6)) DEFAULT now64(6),
    shipped_at  Nullable(DateTime),
    notes       Nullable(String)
) ENGINE = MergeTree ORDER BY id;

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
CREATE TABLE order_items (
    id           UInt64,
    order_id     UInt64,
    product_id   UInt64,
    quantity     Int32,
    unit_price   Decimal(12, 2),
    line_total   Decimal(14, 2),
    sku_snapshot Nullable(String),
    -- F18: ClickHouse's own CHECK catalog (system.constraints) — unlike SQLite, this one round
    -- trips through the definition view's Constraints section for real.
    CONSTRAINT chk_order_items_qty CHECK quantity > 0
) ENGINE = MergeTree ORDER BY id;

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------
CREATE TABLE reviews (
    id          UInt64,
    product_id  UInt64,
    customer_id UInt64,
    rating      Enum8('1' = 1, '2' = 2, '3' = 3, '4' = 4, '5' = 5),
    title       Nullable(String),
    body        Nullable(String),
    helpful     Nullable(Int32) DEFAULT 0,
    created_at  DateTime DEFAULT now()
) ENGINE = MergeTree ORDER BY id;

-- ---------------------------------------------------------------------------
-- order_summary — a view, and a materialized view, so the tree's Views/Materialized views
-- folders both have something in this demo too (mirrors packages/db-fixtures/fixtures/0010's own pair).
-- ---------------------------------------------------------------------------
CREATE VIEW order_summary AS
    SELECT o.id AS order_id, o.customer_id, count(oi.id) AS item_count, sum(oi.line_total) AS total
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    GROUP BY o.id, o.customer_id;

CREATE MATERIALIZED VIEW order_summary_mv
ENGINE = MergeTree ORDER BY id
POPULATE
AS SELECT id, customer_id, status FROM orders;

-- ---------------------------------------------------------------------------
-- data_types_demo — one row of ClickHouse's own type family (Array/Tuple/Map/Enum8/UUID/IPv4/
-- IPv6/Decimal/DateTime64/FixedString/LowCardinality/the geo types), not a literal port of the
-- others' MySQL-shaped columns — there is nothing to port TINYINT/SET/BIT/YEAR into that would
-- be honest rather than invented.
-- ---------------------------------------------------------------------------
CREATE TABLE data_types_demo (
    id            UInt64,
    a_uint8       UInt8,
    a_uint16      UInt16,
    a_uint32      UInt32,
    a_uint64      UInt64,
    a_int8        Int8,
    a_int16       Int16,
    a_int32       Int32,
    a_int64       Int64,
    a_float32     Float32,
    a_float64     Float64,
    a_decimal     Decimal(20, 4),
    a_string      String,
    a_fixedstring FixedString(10),
    a_bool        Bool,
    a_date        Date,
    a_date32      Date32,
    a_datetime    DateTime,
    a_datetime64  DateTime64(6),
    a_uuid        UUID,
    a_ipv4        IPv4,
    a_ipv6        IPv6,
    a_enum        Enum8('a' = 1, 'b' = 2, 'c' = 3),
    a_array       Array(String),
    a_tuple       Tuple(UInt8, String),
    a_map         Map(String, UInt64),
    a_lowcard     LowCardinality(String),
    a_nullable    Nullable(String),
    a_point       Point,
    a_ring        Ring,
    a_polygon     Polygon
) ENGINE = MergeTree ORDER BY id;
