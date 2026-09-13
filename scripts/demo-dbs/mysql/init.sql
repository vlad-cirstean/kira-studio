-- Kira Studio — MySQL seed schema
-- Database: kira  (user: kira / password: kira, root: root)
--
-- A port of ../mariadb/init.sql, not a copy: every table, column, index and comment below is
-- byte-for-byte parallel to that file except the one construct MySQL doesn't have — a native UUID
-- column type (P34 F13) — stood in for with CHAR(36), same as packages/db-fixtures/fixtures/0008_mysql_seed.sql.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(255) NOT NULL,
    full_name     VARCHAR(255) NOT NULL,
    nickname      VARCHAR(64),
    salutation    CHAR(5),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    balance       DECIMAL(14, 2) NOT NULL DEFAULT 0,
    loyalty_points MEDIUMINT DEFAULT 0,
    discount_rate FLOAT DEFAULT 0,
    lifetime_value DOUBLE DEFAULT 0,
    birth_date    DATE,
    signup_dt     DATETIME DEFAULT CURRENT_TIMESTAMP,
    signup_ts     TIMESTAMP NULL DEFAULT NULL,
    last_seen     TIME,
    birth_year    YEAR,
    avatar        BLOB,
    profile       JSON,
    legacy_profile LONGTEXT,
    tags          SET('vip','new','returning','whale'),
    status        ENUM('active','suspended','deleted'),
    flags         BIT(8),
    ip            VARBINARY(16),
    raw_bytes     BINARY(16),
    uuid          CHAR(36),
    geo           POINT,
    created_at    DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_customers_email (email),
    UNIQUE KEY uq_customers_uuid (uuid),
    KEY idx_customers_full_name (full_name),
    KEY idx_customers_signup_ts (signup_ts),
    KEY idx_customers_balance (balance),
    KEY idx_customers_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- customer_addresses
-- ---------------------------------------------------------------------------
CREATE TABLE customer_addresses (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    customer_id BIGINT UNSIGNED NOT NULL,
    label       VARCHAR(32) NOT NULL,
    street      TEXT NOT NULL,
    city        VARCHAR(128) NOT NULL,
    region      VARCHAR(128),
    postal_code VARCHAR(16),
    country     CHAR(2) NOT NULL,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    phone       VARCHAR(32),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_addresses_customer FOREIGN KEY (customer_id)
        REFERENCES customers (id) ON DELETE CASCADE,
    KEY idx_addresses_customer (customer_id),
    KEY idx_addresses_city (city)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- categories (self-referencing)
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    parent_id   BIGINT UNSIGNED NULL,
    name        VARCHAR(128) NOT NULL,
    slug        VARCHAR(128) NOT NULL,
    description MEDIUMTEXT,
    sort_order  INT DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_categories_slug (slug),
    KEY idx_categories_parent (parent_id),
    KEY idx_categories_sort (parent_id, sort_order),
    CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id)
        REFERENCES categories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
CREATE TABLE products (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    category_id   BIGINT UNSIGNED NULL,
    sku           VARCHAR(64) NOT NULL,
    name          VARCHAR(255) NOT NULL,
    description   TINYTEXT,
    long_desc     LONGTEXT,
    price         DECIMAL(12, 2) NOT NULL,
    old_price     DECIMAL(12, 2),
    cost          DECIMAL(12, 2),
    weight_grams  INT,
    volume_ml     SMALLINT,
    weight_lbs    FLOAT,
    stock         INT NOT NULL DEFAULT 0,
    reorder_level INT DEFAULT 10,
    rating        DOUBLE DEFAULT 0,
    review_count  INT DEFAULT 0,
    is_featured   BOOLEAN DEFAULT FALSE,
    is_published  BOOLEAN DEFAULT TRUE,
    available_from DATE,
    available_at  DATETIME,
    lead_time_days SMALLINT,
    attributes    JSON,
    options       MEDIUMBLOB,
    images        LONGBLOB,
    geo           LINESTRING,
    UNIQUE KEY uq_products_sku (sku),
    KEY idx_products_category (category_id),
    KEY idx_products_name (name),
    KEY idx_products_price (price),
    KEY idx_products_rating (rating),
    CONSTRAINT fk_products_category FOREIGN KEY (category_id)
        REFERENCES categories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    customer_id BIGINT UNSIGNED NOT NULL,
    address_id  BIGINT UNSIGNED NULL,
    reference   CHAR(36),
    status      ENUM('pending','paid','shipped','delivered','cancelled') NOT NULL DEFAULT 'pending',
    total       DECIMAL(14, 2) NOT NULL,
    discount    DECIMAL(14, 2) DEFAULT 0,
    tax         DECIMAL(14, 2) DEFAULT 0,
    placed_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    shipped_at  DATETIME,
    notes       TEXT,
    KEY idx_orders_customer (customer_id),
    KEY idx_orders_status (status),
    KEY idx_orders_placed_at (placed_at),
    KEY idx_orders_customer_status (customer_id, status),
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id)
        REFERENCES customers (id) ON DELETE RESTRICT,
    CONSTRAINT fk_orders_address FOREIGN KEY (address_id)
        REFERENCES customer_addresses (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
CREATE TABLE order_items (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    order_id     BIGINT UNSIGNED NOT NULL,
    product_id   BIGINT UNSIGNED NOT NULL,
    quantity     INT NOT NULL,
    unit_price   DECIMAL(12, 2) NOT NULL,
    line_total   DECIMAL(14, 2) NOT NULL,
    sku_snapshot VARCHAR(64),
    KEY idx_order_items_order (order_id),
    KEY idx_order_items_product (product_id),
    KEY idx_order_items_order_product (order_id, product_id),
    CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
        REFERENCES orders (id) ON DELETE CASCADE,
    CONSTRAINT fk_order_items_product FOREIGN KEY (product_id)
        REFERENCES products (id) ON DELETE RESTRICT,
    CONSTRAINT chk_order_items_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------
CREATE TABLE reviews (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    product_id  BIGINT UNSIGNED NOT NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    rating      ENUM('1','2','3','4','5') NOT NULL,
    title       VARCHAR(255),
    body        TEXT,
    helpful     INT DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_reviews_product_customer (product_id, customer_id),
    KEY idx_reviews_product (product_id),
    KEY idx_reviews_customer (customer_id),
    KEY idx_reviews_created (created_at),
    CONSTRAINT fk_reviews_product FOREIGN KEY (product_id)
        REFERENCES products (id) ON DELETE CASCADE,
    CONSTRAINT fk_reviews_customer FOREIGN KEY (customer_id)
        REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- data_types_demo — one row of every MySQL type
-- ---------------------------------------------------------------------------
CREATE TABLE data_types_demo (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    a_tinyint  TINYINT,
    a_smallint SMALLINT,
    a_mediumint MEDIUMINT,
    a_int      INT,
    a_bigint   BIGINT,
    a_decimal  DECIMAL(20, 4),
    a_numeric  NUMERIC(10, 2),
    a_float    FLOAT,
    a_double   DOUBLE,
    a_char     CHAR(10),
    a_varchar  VARCHAR(100),
    a_tinytext TINYTEXT,
    a_text     TEXT,
    a_mediumtext MEDIUMTEXT,
    a_longtext LONGTEXT,
    a_binary   BINARY(16),
    a_varbinary VARBINARY(16),
    a_tinyblob TINYBLOB,
    a_blob     BLOB,
    a_mediumblob MEDIUMBLOB,
    a_longblob LONGBLOB,
    a_boolean  BOOLEAN,
    a_bit      BIT(8),
    a_date     DATE,
    a_time     TIME,
    a_datetime DATETIME(6),
    a_timestamp TIMESTAMP NULL DEFAULT NULL,
    a_year     YEAR,
    a_enum     ENUM('a','b','c'),
    a_set      SET('x','y','z'),
    a_json     JSON,
    a_uuid     CHAR(36),
    a_point    POINT,
    a_linestring LINESTRING,
    a_polygon  POLYGON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
