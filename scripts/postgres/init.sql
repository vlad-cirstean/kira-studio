-- Kira Studio — PostgreSQL seed schema
-- Database: kira  (user: kira / password: kira)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Custom types
-- ---------------------------------------------------------------------------
CREATE TYPE order_status AS ENUM ('pending', 'paid', 'shipped', 'delivered', 'cancelled');
CREATE TYPE review_rating AS ENUM ('1', '2', '3', '4', '5');

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
    id            BIGSERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    full_name     TEXT NOT NULL,
    nickname      VARCHAR(64),
    salutation    CHAR(5),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    balance       NUMERIC(14, 2) NOT NULL DEFAULT 0,
    credit_limit  MONEY,
    loyalty_points INTEGER DEFAULT 0,
    discount_rate REAL DEFAULT 0,
    lifetime_value DOUBLE PRECISION DEFAULT 0,
    birth_date    DATE,
    signup_time   TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
    signup_tz     TIMESTAMPTZ DEFAULT now(),
    last_seen     TIME WITHOUT TIME ZONE,
    membership_interval INTERVAL,
    avatar        BYTEA,
    profile       JSONB,
    legacy_profile JSON,
    tags          TEXT[],
    lucky_numbers INTEGER[],
    home_ip       INET,
    home_net      CIDR,
    wifi_mac      MACADDR,
    bt_mac        MACADDR8,
    uuid          UUID DEFAULT gen_random_uuid(),
    coordinates   POINT,
    bounding_box  BOX,
    travel_path   PATH,
    home_polygon  POLYGON,
    fav_circle    CIRCLE,
    drawing_line  LINE,
    data_bits     BIT(8),
    data_varbits  BIT VARYING(16),
    age_range     INT4RANGE,
    price_range   NUMRANGE,
    active_period TSRANGE,
    doc_vector    TSVECTOR
);

CREATE INDEX idx_customers_full_name ON customers (full_name);
CREATE INDEX idx_customers_signup_tz ON customers (signup_tz DESC);
CREATE INDEX idx_customers_balance ON customers (balance);
CREATE INDEX idx_customers_tags ON customers USING GIN (tags);
CREATE INDEX idx_customers_profile ON customers USING GIN (profile);
CREATE INDEX idx_customers_doc_vector ON customers USING GIN (doc_vector);
CREATE INDEX idx_customers_birth_date ON customers (birth_date);

-- ---------------------------------------------------------------------------
-- customer_addresses
-- ---------------------------------------------------------------------------
CREATE TABLE customer_addresses (
    id          BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
    label       VARCHAR(32) NOT NULL,
    street      TEXT NOT NULL,
    city        VARCHAR(128) NOT NULL,
    region      VARCHAR(128),
    postal_code VARCHAR(16),
    country     CHAR(2) NOT NULL,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    phone       VARCHAR(32),
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_addresses_customer ON customer_addresses (customer_id);
CREATE INDEX idx_addresses_city ON customer_addresses (city);
CREATE UNIQUE INDEX idx_addresses_default ON customer_addresses (customer_id) WHERE is_default;

-- ---------------------------------------------------------------------------
-- categories (self-referencing)
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
    id          BIGSERIAL PRIMARY KEY,
    parent_id   BIGINT REFERENCES categories (id) ON DELETE SET NULL,
    name        VARCHAR(128) NOT NULL,
    slug        VARCHAR(128) NOT NULL,
    description TEXT,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_categories_slug ON categories (slug);
CREATE INDEX idx_categories_parent ON categories (parent_id);
CREATE INDEX idx_categories_sort ON categories (parent_id, sort_order);

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
CREATE TABLE products (
    id            BIGSERIAL PRIMARY KEY,
    category_id   BIGINT REFERENCES categories (id) ON DELETE SET NULL,
    sku           VARCHAR(64) NOT NULL UNIQUE,
    name          VARCHAR(255) NOT NULL,
    description   TEXT,
    long_desc     TEXT,
    price         NUMERIC(12, 2) NOT NULL,
    old_price     NUMERIC(12, 2),
    cost          NUMERIC(12, 2),
    weight_grams  INTEGER,
    volume_ml     SMALLINT,
    weight_lbs    REAL,
    dims          NUMERIC[],
    stock         INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER DEFAULT 10,
    rating        DOUBLE PRECISION DEFAULT 0,
    review_count  INTEGER DEFAULT 0,
    is_featured   BOOLEAN DEFAULT FALSE,
    is_published  BOOLEAN DEFAULT TRUE,
    available_from DATE,
    available_at  TIMESTAMPTZ,
    lead_time     INTERVAL,
    attributes    JSONB,
    options       JSON,
    images        TEXT[],
    search_doc    TSVECTOR
);

CREATE INDEX idx_products_category ON products (category_id);
CREATE INDEX idx_products_name ON products (name);
CREATE INDEX idx_products_price ON products (price);
CREATE INDEX idx_products_rating ON products (rating DESC);
CREATE INDEX idx_products_attributes ON products USING GIN (attributes);
CREATE INDEX idx_products_images ON products USING GIN (images);
CREATE INDEX idx_products_search_doc ON products USING GIN (search_doc);
CREATE INDEX idx_products_featured ON products (is_featured) WHERE is_featured;
CREATE INDEX idx_products_stock ON products (stock) WHERE stock < reorder_level;

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
    id            BIGSERIAL PRIMARY KEY,
    customer_id   BIGINT NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
    address_id    BIGINT REFERENCES customer_addresses (id) ON DELETE SET NULL,
    reference     UUID DEFAULT gen_random_uuid(),
    status        order_status NOT NULL DEFAULT 'pending',
    total         NUMERIC(14, 2) NOT NULL,
    discount      NUMERIC(14, 2) DEFAULT 0,
    tax           NUMERIC(14, 2) DEFAULT 0,
    placed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    shipped_at    TIMESTAMPTZ,
    notes         TEXT
);

CREATE INDEX idx_orders_customer ON orders (customer_id);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_placed_at ON orders (placed_at DESC);
CREATE INDEX idx_orders_reference ON orders (reference);
CREATE INDEX idx_orders_customer_status ON orders (customer_id, status);

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
CREATE TABLE order_items (
    id          BIGSERIAL PRIMARY KEY,
    order_id    BIGINT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id  BIGINT NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    unit_price  NUMERIC(12, 2) NOT NULL,
    line_total  NUMERIC(14, 2) NOT NULL,
    sku_snapshot VARCHAR(64)
);

CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_order_items_product ON order_items (product_id);
CREATE INDEX idx_order_items_order_product ON order_items (order_id, product_id);

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------
CREATE TABLE reviews (
    id          BIGSERIAL PRIMARY KEY,
    product_id  BIGINT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    customer_id BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
    rating      review_rating NOT NULL,
    title       VARCHAR(255),
    body        TEXT,
    helpful     INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (product_id, customer_id)
);

CREATE INDEX idx_reviews_product ON reviews (product_id);
CREATE INDEX idx_reviews_customer ON reviews (customer_id);
CREATE INDEX idx_reviews_rating ON reviews (rating);
CREATE INDEX idx_reviews_created ON reviews (created_at DESC);

-- ---------------------------------------------------------------------------
-- data_types_demo — one row of every PostgreSQL type
-- ---------------------------------------------------------------------------
CREATE TABLE data_types_demo (
    id         BIGSERIAL PRIMARY KEY,
    a_smallint SMALLINT,
    a_int      INTEGER,
    a_bigint   BIGINT,
    a_numeric  NUMERIC(20, 4),
    a_decimal  DECIMAL(10, 2),
    a_real     REAL,
    a_double   DOUBLE PRECISION,
    a_money    MONEY,
    a_varchar  VARCHAR(100),
    a_char     CHAR(10),
    a_text     TEXT,
    a_bytea    BYTEA,
    a_bool     BOOLEAN,
    a_date     DATE,
    a_time     TIME,
    a_timetz   TIMETZ,
    a_ts       TIMESTAMP,
    a_tstz     TIMESTAMPTZ,
    a_interval INTERVAL,
    a_uuid     UUID,
    a_json     JSON,
    a_jsonb    JSONB,
    a_arr_int  INTEGER[],
    a_arr_text TEXT[],
    a_inet     INET,
    a_cidr     CIDR,
    a_mac      MACADDR,
    a_mac8     MACADDR8,
    a_point    POINT,
    a_line     LINE,
    a_lseg     LSEG,
    a_box      BOX,
    a_path     PATH,
    a_polygon  POLYGON,
    a_circle   CIRCLE,
    a_bit      BIT(8),
    a_varbit   BIT VARYING(8),
    a_int4rng  INT4RANGE,
    a_numrng   NUMRANGE,
    a_tsrng    TSRANGE,
    a_tsvec    TSVECTOR,
    a_tsquery  TSQUERY,
    a_xml      XML
);
