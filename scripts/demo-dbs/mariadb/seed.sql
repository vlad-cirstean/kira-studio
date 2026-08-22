-- Kira Studio — MariaDB seed data (idempotent)
-- Run: docker exec -i kira-mariadb mariadb -ukira -pkira kira < scripts/mariadb/seed.sql
-- Uses the built-in sequence engine (seq_1_to_N) to generate rows fast.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE reviews;
TRUNCATE order_items;
TRUNCATE orders;
TRUNCATE products;
TRUNCATE categories;
TRUNCATE customer_addresses;
TRUNCATE customers;
TRUNCATE data_types_demo;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------
-- customers — 20,000
-- ---------------------------------------------------------------------------
INSERT INTO customers (
    email, full_name, nickname, salutation, is_active, balance, loyalty_points,
    discount_rate, lifetime_value, birth_date, signup_dt, signup_ts, last_seen,
    birth_year, avatar, profile, legacy_profile, tags, status, flags, ip,
    raw_bytes, uuid, geo, created_at
)
SELECT
    CONCAT('user', seq, '@example.com'),
    CONCAT('Customer ', seq),
    CONCAT('nick', seq),
    LEFT(ELT((seq % 4) + 1, 'Mr.', 'Ms.', 'Dr.', 'Mx.'), 5),
    (seq % 7) <> 0,
    ROUND(RAND() * 100000, 2),
    FLOOR(RAND() * 10000000) % 8388607,
    ROUND(RAND() * 30, 2),
    RAND() * 100000,
    DATE_ADD('1950-01-01', INTERVAL FLOOR(RAND() * 26000) DAY),
    DATE_ADD('2015-01-01', INTERVAL FLOOR(RAND() * 300000000) SECOND),
    DATE_ADD('2015-01-01', INTERVAL FLOOR(RAND() * 300000000) SECOND),
    SEC_TO_TIME(FLOOR(RAND() * 86399)),
    1950 + (seq % 70),
    UNHEX(MD5(seq)),
    JSON_OBJECT('tier', ELT((seq % 4) + 1, 'bronze', 'silver', 'gold', 'platinum'),
                'visits', FLOOR(RAND() * 500)),
    CONCAT('legacy import ', seq),
    ELT((seq % 4) + 1, 'vip', 'new', 'returning', 'whale'),
    ELT((seq % 3) + 1, 'active', 'suspended', 'deleted'),
    b'10101010',
    UNHEX(LPAD(HEX(seq), 32, '0')),
    UNHEX(LPAD(HEX(seq * 13), 32, '0')),
    UUID(),
    POINT((CAST(seq AS SIGNED) % 180) - 90, (CAST(seq AS SIGNED) % 360) - 180),
    DATE_ADD('2015-01-01', INTERVAL FLOOR(RAND() * 300000000) MICROSECOND)
FROM seq_1_to_20000;

-- ---------------------------------------------------------------------------
-- customer_addresses — 20,000
-- ---------------------------------------------------------------------------
INSERT INTO customer_addresses (
    customer_id, label, street, city, region, postal_code, country,
    is_default, phone, created_at
)
SELECT
    seq,
    ELT((seq % 4) + 1, 'home', 'work', 'billing', 'shipping'),
    CONCAT((seq % 9999), ' Main St'),
    ELT((seq % 8) + 1, 'Berlin', 'London', 'Paris', 'Tokyo', 'New York', 'Sydney', 'Toronto', 'Madrid'),
    ELT((seq % 8) + 1, 'CA', 'NY', 'TX', 'BW', 'ENG', 'IDF', 'NSW', 'ON'),
    LPAD((seq % 99999), 5, '0'),
    ELT((seq % 8) + 1, 'US', 'DE', 'GB', 'FR', 'JP', 'AU', 'CA', 'ES'),
    (seq % 5) = 0,
    CONCAT('+1-555-', LPAD((seq % 10000), 4, '0')),
    DATE_ADD('2015-01-01', INTERVAL FLOOR(RAND() * 300000000) SECOND)
FROM seq_1_to_20000;

-- ---------------------------------------------------------------------------
-- categories — 20,000
-- ---------------------------------------------------------------------------
INSERT INTO categories (parent_id, name, slug, description, sort_order, created_at)
SELECT
    CASE WHEN seq <= 16 OR seq % 17 = 0 THEN NULL ELSE seq - ((seq % 16) + 1) END,
    CONCAT('Category ', seq),
    CONCAT('category-', seq),
    CONCAT('Description for category ', seq),
    seq % 100,
    DATE_ADD('2015-01-01', INTERVAL FLOOR(RAND() * 300000000) SECOND)
FROM seq_1_to_20000;

-- ---------------------------------------------------------------------------
-- products — 20,000
-- ---------------------------------------------------------------------------
INSERT INTO products (
    category_id, sku, name, description, long_desc, price, old_price, cost,
    weight_grams, volume_ml, weight_lbs, stock, reorder_level, rating,
    review_count, is_featured, is_published, available_from, available_at,
    lead_time_days, attributes, options, images, geo
)
SELECT
    CASE WHEN seq % 20 = 0 THEN NULL ELSE ((seq * 37) % 20000) + 1 END,
    CONCAT('SKU-', LPAD(seq, 6, '0')),
    CONCAT('Product ', seq),
    CONCAT('Short description for product ', seq),
    REPEAT(CONCAT('Long description for product ', seq, '. '), 5),
    ROUND(RAND() * 5000 + 1, 2),
    ROUND(RAND() * 6000 + 1, 2),
    ROUND(RAND() * 3000 + 1, 2),
    FLOOR(RAND() * 50000),
    FLOOR(RAND() * 2000),
    ROUND(RAND() * 50, 2),
    FLOOR(RAND() * 10000),
    FLOOR(RAND() * 50),
    ROUND(RAND() * 5, 2),
    FLOOR(RAND() * 5000),
    (seq % 10) = 0,
    (seq % 50) <> 0,
    DATE_ADD('2020-01-01', INTERVAL FLOOR(RAND() * 2000) DAY),
    DATE_ADD('2020-01-01', INTERVAL FLOOR(RAND() * 200000000) SECOND),
    FLOOR(RAND() * 30),
    JSON_OBJECT('color', ELT((seq % 5) + 1, 'red', 'blue', 'green', 'black', 'white'),
                'size', ELT((seq % 4) + 1, 'S', 'M', 'L', 'XL')),
    UNHEX(MD5(CONCAT('options-', seq))),
    UNHEX(MD5(CONCAT('img-', seq))),
    ST_GeomFromText(CONCAT('LINESTRING(0 0, ', (seq % 100), ' ', (seq % 100), ')'))
FROM seq_1_to_20000;

-- ---------------------------------------------------------------------------
-- orders — 20,000
-- ---------------------------------------------------------------------------
INSERT INTO orders (
    customer_id, address_id, reference, status, total, discount, tax,
    placed_at, shipped_at, notes
)
SELECT
    ((seq * 37) % 20000) + 1,
    ((seq * 17) % 20000) + 1,
    UUID(),
    ELT((seq % 5) + 1, 'pending', 'paid', 'shipped', 'delivered', 'cancelled'),
    ROUND(RAND() * 10000, 2),
    ROUND(RAND() * 500, 2),
    ROUND(RAND() * 1000, 2),
    DATE_ADD('2021-01-01', INTERVAL FLOOR(RAND() * 150000000) SECOND),
    CASE WHEN seq % 3 = 0 THEN NULL
         ELSE DATE_ADD('2021-01-01', INTERVAL FLOOR(RAND() * 150000000) SECOND) END,
    CASE WHEN seq % 4 = 0 THEN CONCAT('note ', seq) ELSE NULL END
FROM seq_1_to_20000;

-- ---------------------------------------------------------------------------
-- order_items — 80,000 (4 per order)
-- ---------------------------------------------------------------------------
INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total, sku_snapshot)
SELECT
    ((seq - 1) % 20000) + 1,
    ((seq * 7919) % 20000) + 1,
    (seq % 5) + 1,
    ROUND(RAND() * 5000 + 1, 2),
    ROUND(RAND() * 1000 + 10, 2),
    CONCAT('SKU-', LPAD((((seq * 7919) % 20000) + 1), 6, '0'))
FROM seq_1_to_80000;

-- ---------------------------------------------------------------------------
-- reviews — 20,000 (unique product/customer pairs)
-- ---------------------------------------------------------------------------
INSERT INTO reviews (product_id, customer_id, rating, title, body, helpful, created_at)
SELECT
    seq,
    ((seq * 7919) % 20000) + 1,
    ELT((seq % 5) + 1, '1', '2', '3', '4', '5'),
    CONCAT('Review ', seq),
    CONCAT('This is the body of review ', seq),
    FLOOR(RAND() * 1000),
    DATE_ADD('2022-01-01', INTERVAL FLOOR(RAND() * 100000000) SECOND)
FROM seq_1_to_20000;

-- ---------------------------------------------------------------------------
-- data_types_demo — a single row exercising every type
-- ---------------------------------------------------------------------------
INSERT INTO data_types_demo (
    a_tinyint, a_smallint, a_mediumint, a_int, a_bigint, a_decimal, a_numeric,
    a_float, a_double, a_char, a_varchar, a_tinytext, a_text, a_mediumtext,
    a_longtext, a_binary, a_varbinary, a_tinyblob, a_blob, a_mediumblob,
    a_longblob, a_boolean, a_bit, a_date, a_time, a_datetime, a_timestamp,
    a_year, a_enum, a_set, a_json, a_uuid, a_point, a_linestring, a_polygon
) VALUES (
    127, 32767, 8388607, 2147483647, 9007199254740993,
    123456.7890, 987654.32, 3.14159, 2.718281828459045,
    'char', 'hello world', 'tiny text', 'some text', 'medium text',
    'long text', UNHEX('CAFEBABECAFEBABECAFEBABECAFEBABE'), UNHEX('DEADBEEF'),
    'tiny blob', 'blob data', 'medium blob', 'long blob',
    TRUE, b'10101010', '2024-06-15', '13:45:30', '2024-06-15 13:45:30.123456',
    '2024-06-15 13:45:30', 2024, 'b', 'x,z',
    '{"a": 1, "b": [1,2,3]}', UUID(),
    POINT(1, 2), ST_GeomFromText('LINESTRING(0 0, 1 1, 2 0)'),
    ST_GeomFromText('POLYGON((0 0, 4 0, 4 4, 0 4, 0 0))')
);

SELECT 'customers' AS tbl, COUNT(*) AS n FROM customers
UNION ALL SELECT 'customer_addresses', COUNT(*) FROM customer_addresses
UNION ALL SELECT 'categories', COUNT(*) FROM categories
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL SELECT 'data_types_demo', COUNT(*) FROM data_types_demo;
