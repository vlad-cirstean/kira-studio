-- Kira Studio — ClickHouse seed data
-- Run: docker exec -i kira-clickhouse clickhouse-client --multiquery --database kira < scripts/demo-dbs/clickhouse/seed.sql
--
-- The same e-commerce model every other relational demo seeds (P36 D38), generated with
-- ClickHouse's own numbers() table function — one INSERT ... SELECT per table, no chunking and no
-- WITH RECURSIVE depth limit to work around (P34 D28's own problem does not exist here).

TRUNCATE TABLE IF EXISTS reviews;
TRUNCATE TABLE IF EXISTS order_items;
TRUNCATE TABLE IF EXISTS orders;
TRUNCATE TABLE IF EXISTS products;
TRUNCATE TABLE IF EXISTS categories;
TRUNCATE TABLE IF EXISTS customer_addresses;
TRUNCATE TABLE IF EXISTS customers;
TRUNCATE TABLE IF EXISTS data_types_demo;

-- ---------------------------------------------------------------------------
-- customers — 20,000
-- ---------------------------------------------------------------------------
INSERT INTO customers (
    id, email, full_name, nickname, salutation, is_active, balance, loyalty_points,
    discount_rate, lifetime_value, birth_date, signup_dt, signup_ts, last_seen,
    birth_year, avatar, profile, legacy_profile, tags, status, flags, ip,
    raw_bytes, uuid, geo, created_at
)
SELECT
    number + 1,
    concat('user', toString(number + 1), '@example.com'),
    concat('Customer ', toString(number + 1)),
    concat('nick', toString(number + 1)),
    ['Mr.', 'Ms.', 'Dr.', 'Mx.'][(number % 4) + 1],
    (number % 7) <> 0,
    round(rand() / 4294967295.0 * 100000, 2),
    toInt32(rand() % 8388607),
    round(rand() / 4294967295.0 * 30, 2),
    rand() / 4294967295.0 * 100000,
    toDate('1950-01-01') + toIntervalDay(toInt32(rand() % 26000)),
    toDateTime('2015-01-01') + toIntervalSecond(toInt32(rand() % 300000000)),
    toDateTime('2015-01-01') + toIntervalSecond(toInt32(rand() % 300000000)),
    formatDateTime(toDateTime(rand() % 86400), '%H:%i:%S'),
    1950 + (number % 70),
    hex(MD5(toString(number))),
    concat('{"tier":"', ['bronze', 'silver', 'gold', 'platinum'][(number % 4) + 1],
           '","visits":', toString(number % 500), '}'),
    concat('legacy import ', toString(number + 1)),
    [['vip', 'new', 'returning', 'whale'][(number % 4) + 1]],
    ['active', 'suspended', 'deleted'][(number % 3) + 1],
    170,
    toIPv6(concat('2001:db8::', hex(toUInt16(number % 65536)))),
    substring(hex(MD5(toString(number))), 1, 16),
    generateUUIDv4(),
    (round(rand() / 4294967295.0 * 180 - 90, 4), round(rand() / 4294967295.0 * 360 - 180, 4)),
    toDateTime64(toDateTime('2015-01-01') + toIntervalSecond(toInt32(rand() % 300000000)), 6)
FROM numbers(20000);

-- ---------------------------------------------------------------------------
-- customer_addresses — 20,000
-- ---------------------------------------------------------------------------
INSERT INTO customer_addresses (
    id, customer_id, label, street, city, region, postal_code, country, is_default, phone,
    created_at
)
SELECT
    number + 1,
    number + 1,
    ['Home', 'Work', 'Other'][(number % 3) + 1],
    concat(toString((number % 9000) + 100), ' Main St'),
    ['Springfield', 'Riverside', 'Fairview', 'Georgetown', 'Madison'][(number % 5) + 1],
    ['North', 'South', 'East', 'West'][(number % 4) + 1],
    lpad(toString((number % 90000) + 10000), 5, '0'),
    ['US', 'CA', 'GB', 'DE', 'FR'][(number % 5) + 1],
    (number % 5) = 0,
    concat('+1', toString(2000000000 + (number % 999999999))),
    toDateTime('2015-01-01') + toIntervalSecond(toInt32(rand() % 300000000))
FROM numbers(20000);

-- ---------------------------------------------------------------------------
-- categories — 20,000 (self-referencing, no real FK, F17)
-- ---------------------------------------------------------------------------
INSERT INTO categories (id, parent_id, name, slug, description, sort_order, created_at)
SELECT
    number + 1,
    if(number < 20, NULL, ((number % 20) + 1)),
    concat('Category ', toString(number + 1)),
    concat('category-', toString(number + 1)),
    concat('Description for category ', toString(number + 1)),
    toInt32(number % 100),
    toDateTime('2015-01-01') + toIntervalSecond(toInt32(rand() % 300000000))
FROM numbers(20000);

-- ---------------------------------------------------------------------------
-- products — 20,000
-- ---------------------------------------------------------------------------
INSERT INTO products (
    id, category_id, sku, name, description, long_desc, price, old_price, cost, weight_grams,
    volume_ml, weight_lbs, stock, reorder_level, rating, review_count, is_featured, is_published,
    available_from, available_at, lead_time_days, attributes, options, images, geo
)
SELECT
    number + 1,
    (number % 20000) + 1,
    concat('SKU-', lpad(toString(number + 1), 6, '0')),
    concat('Product ', toString(number + 1)),
    concat('Short description ', toString(number + 1)),
    concat('Long description for product ', toString(number + 1)),
    round(rand() / 4294967295.0 * 5000 + 1, 2),
    round(rand() / 4294967295.0 * 5500 + 1, 2),
    round(rand() / 4294967295.0 * 3000 + 1, 2),
    toInt32(rand() % 20000),
    toInt16(rand() % 5000),
    round(rand() / 4294967295.0 * 40, 2),
    toInt32(rand() % 1000),
    10,
    round(rand() / 4294967295.0 * 5, 2),
    toInt32(rand() % 500),
    (number % 10) = 0,
    (number % 20) <> 0,
    toDate('2020-01-01') + toIntervalDay(toInt32(rand() % 1800)),
    toDateTime('2020-01-01') + toIntervalSecond(toInt32(rand() % 300000000)),
    toInt16((number % 30) + 1),
    concat('{"color":"', ['red', 'green', 'blue', 'black'][(number % 4) + 1], '"}'),
    concat('opt-', toString(number + 1)),
    concat('img-', toString(number + 1)),
    [(round(rand() / 4294967295.0 * 180 - 90, 4), round(rand() / 4294967295.0 * 360 - 180, 4))]
FROM numbers(20000);

-- ---------------------------------------------------------------------------
-- orders — 20,000
-- ---------------------------------------------------------------------------
INSERT INTO orders (
    id, customer_id, address_id, reference, status, total, discount, tax, placed_at, updated_at,
    shipped_at, notes
)
SELECT
    number + 1,
    ((number * 7919) % 20000) + 1,
    ((number * 7919) % 20000) + 1,
    generateUUIDv4(),
    ['pending', 'paid', 'shipped', 'delivered', 'cancelled'][(number % 5) + 1],
    round(rand() / 4294967295.0 * 2000 + 10, 2),
    round(rand() / 4294967295.0 * 100, 2),
    round(rand() / 4294967295.0 * 150, 2),
    toDateTime64(toDateTime('2018-01-01') + toIntervalSecond(toInt32(rand() % 250000000)), 6),
    toDateTime64(toDateTime('2018-01-01') + toIntervalSecond(toInt32(rand() % 250000000)), 6),
    toDateTime('2018-01-01') + toIntervalSecond(toInt32(rand() % 250000000)),
    concat('Order notes ', toString(number + 1))
FROM numbers(20000);

-- ---------------------------------------------------------------------------
-- order_items — 80,000
-- ---------------------------------------------------------------------------
INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, line_total, sku_snapshot)
SELECT
    number + 1,
    (number % 20000) + 1,
    ((number * 7919) % 20000) + 1,
    (number % 5) + 1,
    round(rand() / 4294967295.0 * 5000 + 1, 2),
    round(rand() / 4294967295.0 * 1000 + 10, 2),
    concat('SKU-', lpad(toString(((number * 7919) % 20000) + 1), 6, '0'))
FROM numbers(80000);

-- ---------------------------------------------------------------------------
-- reviews — 20,000
-- ---------------------------------------------------------------------------
INSERT INTO reviews (id, product_id, customer_id, rating, title, body, helpful, created_at)
SELECT
    number + 1,
    number + 1,
    ((number * 7919) % 20000) + 1,
    ['1', '2', '3', '4', '5'][(number % 5) + 1],
    concat('Review ', toString(number + 1)),
    concat('This is the body of review ', toString(number + 1)),
    toInt32(rand() % 1000),
    toDateTime('2022-01-01') + toIntervalSecond(toInt32(rand() % 100000000))
FROM numbers(20000);

-- ---------------------------------------------------------------------------
-- data_types_demo — a single row exercising ClickHouse's own type family
-- ---------------------------------------------------------------------------
INSERT INTO data_types_demo (
    id, a_uint8, a_uint16, a_uint32, a_uint64, a_int8, a_int16, a_int32, a_int64, a_float32,
    a_float64, a_decimal, a_string, a_fixedstring, a_bool, a_date, a_date32, a_datetime,
    a_datetime64, a_uuid, a_ipv4, a_ipv6, a_enum, a_array, a_tuple, a_map, a_lowcard, a_nullable,
    a_point, a_ring, a_polygon
) VALUES (
    1, 255, 65535, 4294967295, 18446744073709551615, -128, -32768, -2147483648, -9223372036854775808,
    3.14159, 2.718281828459045, 123456789.0123, 'hello world', 'fixedstr10', true,
    '2024-06-15', '2024-06-15', '2024-06-15 13:45:30', '2024-06-15 13:45:30.123456',
    generateUUIDv4(), toIPv4('192.168.1.1'), toIPv6('2001:db8::1'), 'b',
    ['one', 'two', 'three'], (7, 'seven'), map('k1', 1, 'k2', 2), 'low-card-value', NULL,
    (1.0, 2.0), [(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0), (0.0, 0.0)],
    [[(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0), (0.0, 0.0)]]
);

SELECT 'customers' AS tbl, count() AS n FROM customers
UNION ALL SELECT 'customer_addresses', count() FROM customer_addresses
UNION ALL SELECT 'categories', count() FROM categories
UNION ALL SELECT 'products', count() FROM products
UNION ALL SELECT 'orders', count() FROM orders
UNION ALL SELECT 'order_items', count() FROM order_items
UNION ALL SELECT 'reviews', count() FROM reviews
UNION ALL SELECT 'data_types_demo', count() FROM data_types_demo;
