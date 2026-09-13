-- Kira Studio — PostgreSQL seed data (idempotent)
-- Run: docker exec -i kira-postgres psql -U kira -d kira < scripts/postgres/seed.sql
-- ~20k rows per table. Child tables scale accordingly.

\set ON_ERROR_STOP on
BEGIN;

TRUNCATE reviews, order_items, orders, products, categories,
         customer_addresses, customers, data_types_demo
         RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------------
-- customers — 20,000
-- ---------------------------------------------------------------------------
INSERT INTO customers (
    email, full_name, nickname, salutation, is_active, balance, credit_limit,
    loyalty_points, discount_rate, lifetime_value, birth_date, signup_time,
    signup_tz, last_seen, membership_interval, avatar, profile, legacy_profile,
    tags, lucky_numbers, home_ip, home_net, wifi_mac, bt_mac, uuid,
    coordinates, bounding_box, travel_path, home_polygon, fav_circle,
    drawing_line, data_bits, data_varbits, age_range, price_range,
    active_period, doc_vector
)
SELECT
    'user' || gs || '@example.com',
    'Customer ' || gs,
    'nick' || gs,
    LEFT((ARRAY['Mr.','Ms.','Dr.','Mx.'])[(gs % 4) + 1] || repeat(' ', 5), 5),
    (gs % 7) <> 0,
    round((random() * 100000)::numeric, 2),
    round((random() * 5000)::numeric, 2)::numeric::money,
    (random() * 10000)::int,
    round((random() * 30)::numeric, 2)::real,
    (random() * 100000),
    date '1950-01-01' + (random() * 26000)::int,
    timestamp '2015-01-01' + (random() * 300000000)::int * interval '1 second',
    timestamptz '2015-01-01' + (random() * 300000000)::int * interval '1 second',
    time '00:00:00' + (random() * 86399)::int * interval '1 second',
    (random() * 3650)::int * interval '1 day',
    decode(md5(gs::text), 'hex'),
    jsonb_build_object(
        'tier', (ARRAY['bronze','silver','gold','platinum'])[(gs % 4) + 1],
        'prefs', jsonb_build_object('newsletter', (gs % 2) = 0),
        'visits', (random() * 500)::int
    ),
    json_build_object('legacy', true, 'source', 'import-' || gs),
    ARRAY[(ARRAY['vip','new','returning','whale'])[(gs % 4) + 1],
          (ARRAY['eu','us','apac'])[(gs % 3) + 1]],
    ARRAY[gs % 100, (gs * 3) % 100, (gs * 7) % 100],
    ('10.0.' || (gs % 255) || '.' || (gs % 250))::inet,
    ('192.168.' || (gs % 255) || '.0/24')::cidr,
    ('08:00:27:' || lpad(to_hex((gs * 13) % 256), 2, '0') || ':'
        || lpad(to_hex((gs * 29) % 256), 2, '0') || ':'
        || lpad(to_hex((gs * 41) % 256), 2, '0'))::macaddr,
    ('08:00:27:00:00:00:' || lpad(to_hex(gs % 256), 2, '0') || ':'
        || lpad(to_hex((gs * 3) % 256), 2, '0'))::macaddr8,
    gen_random_uuid(),
    point(gs % 180 - 90, gs % 360 - 180),
    box(point(gs % 90, gs % 90), point(gs % 90 + 1, gs % 90 + 1)),
    path '[(0,0),(1,1),(2,0)]',
    polygon '((0,0),(1,0),(1,1),(0,1))',
    circle '<(0,0),5>',
    line '{1,1,0}',
    B'10101010',
    B'1010101010101010',
    int4range(gs % 10, gs % 10 + 40),
    numrange(round((random() * 100)::numeric, 2), round((random() * 500 + 500)::numeric, 2)),
    tsrange(now()::timestamp - interval '30 days', now()::timestamp + interval '90 days'),
    to_tsvector('english', 'Customer ' || gs || ' ' ||
        (ARRAY['vip','new','returning','whale'])[(gs % 4) + 1])
FROM generate_series(1, 20000) AS gs;

-- ---------------------------------------------------------------------------
-- customer_addresses — 20,000 (one per customer)
-- ---------------------------------------------------------------------------
INSERT INTO customer_addresses (
    customer_id, label, street, city, region, postal_code, country,
    is_default, phone, created_at
)
SELECT
    gs,
    (ARRAY['home','work','billing','shipping'])[(gs % 4) + 1],
    (gs % 9999) || ' Main St',
    (ARRAY['Berlin','London','Paris','Tokyo','New York','Sydney','Toronto','Madrid'])[(gs % 8) + 1],
    (ARRAY['CA','NY','TX','BW','ENG','IDF','NSW','ON'])[(gs % 8) + 1],
    lpad((gs % 99999)::text, 5, '0'),
    (ARRAY['US','DE','GB','FR','JP','AU','CA','ES'])[(gs % 8) + 1],
    (gs % 5) = 0,
    '+1-555-' || lpad((gs % 10000)::text, 4, '0'),
    timestamptz '2015-01-01' + (random() * 300000000)::int * interval '1 second'
FROM generate_series(1, 20000) AS gs;

-- ---------------------------------------------------------------------------
-- categories — 20,000 (self-referencing)
-- ---------------------------------------------------------------------------
INSERT INTO categories (parent_id, name, slug, description, sort_order, created_at)
SELECT
    CASE WHEN gs <= 16 OR gs % 17 = 0 THEN NULL ELSE gs - ((gs % 16) + 1) END,
    'Category ' || gs,
    'category-' || gs,
    'Description for category ' || gs,
    gs % 100,
    timestamptz '2015-01-01' + (random() * 300000000)::int * interval '1 second'
FROM generate_series(1, 20000) AS gs;

-- ---------------------------------------------------------------------------
-- products — 20,000
-- ---------------------------------------------------------------------------
INSERT INTO products (
    category_id, sku, name, description, long_desc, price, old_price, cost,
    weight_grams, volume_ml, weight_lbs, dims, stock, reorder_level, rating,
    review_count, is_featured, is_published, available_from, available_at,
    lead_time, attributes, options, images, search_doc
)
SELECT
    CASE WHEN gs % 20 = 0 THEN NULL ELSE ((gs * 37) % 20000) + 1 END,
    'SKU-' || lpad(gs::text, 6, '0'),
    'Product ' || gs,
    'Short description for product ' || gs,
    repeat('Long description for product ' || gs || '. ', 5),
    round((random() * 5000 + 1)::numeric, 2),
    round((random() * 6000 + 1)::numeric, 2),
    round((random() * 3000 + 1)::numeric, 2),
    (random() * 50000)::int,
    (random() * 2000)::smallint,
    round((random() * 50)::numeric, 2)::real,
    ARRAY[round((random() * 100)::numeric, 1), round((random() * 100)::numeric, 1),
          round((random() * 100)::numeric, 1)],
    (random() * 10000)::int,
    (random() * 50)::int,
    round((random() * 5)::numeric, 2),
    (random() * 5000)::int,
    (gs % 10) = 0,
    (gs % 50) <> 0,
    date '2020-01-01' + (random() * 2000)::int,
    timestamptz '2020-01-01' + (random() * 200000000)::int * interval '1 second',
    (random() * 30)::int * interval '1 day',
    jsonb_build_object(
        'color', (ARRAY['red','blue','green','black','white'])[(gs % 5) + 1],
        'size', (ARRAY['S','M','L','XL'])[(gs % 4) + 1],
        'material', (ARRAY['cotton','steel','wood','glass'])[(gs % 4) + 1]
    ),
    json_build_object('variant', gs % 100),
    ARRAY['img/' || gs || '-1.jpg', 'img/' || gs || '-2.jpg'],
    to_tsvector('english', 'Product ' || gs || ' ' ||
        (ARRAY['red','blue','green','black','white'])[(gs % 5) + 1])
FROM generate_series(1, 20000) AS gs;

-- ---------------------------------------------------------------------------
-- orders — 20,000
-- ---------------------------------------------------------------------------
INSERT INTO orders (
    customer_id, address_id, reference, status, total, discount, tax,
    placed_at, updated_at, shipped_at, notes
)
SELECT
    ((gs * 37) % 20000) + 1,
    ((gs * 17) % 20000) + 1,
    gen_random_uuid(),
    (ARRAY['pending','paid','shipped','delivered','cancelled'])[(gs % 5) + 1]::order_status,
    round((random() * 10000)::numeric, 2),
    round((random() * 500)::numeric, 2),
    round((random() * 1000)::numeric, 2),
    timestamptz '2021-01-01' + (random() * 150000000)::int * interval '1 second',
    timestamptz '2021-01-01' + (random() * 150000000)::int * interval '1 second',
    CASE WHEN gs % 3 = 0 THEN NULL
         ELSE timestamptz '2021-01-01' + (random() * 150000000)::int * interval '1 second' END,
    CASE WHEN gs % 4 = 0 THEN 'note ' || gs ELSE NULL END
FROM generate_series(1, 20000) AS gs;

-- ---------------------------------------------------------------------------
-- order_items — 80,000 (4 per order)
-- ---------------------------------------------------------------------------
INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total, sku_snapshot)
SELECT
    ((gs - 1) % 20000) + 1,
    ((gs * 7919) % 20000) + 1,
    (gs % 5) + 1,
    round((random() * 5000 + 1)::numeric, 2),
    round((random() * 1000 + 10)::numeric, 2),
    'SKU-' || lpad((((gs * 7919) % 20000) + 1)::text, 6, '0')
FROM generate_series(1, 80000) AS gs;

-- ---------------------------------------------------------------------------
-- reviews — 20,000 (unique product/customer pairs)
-- ---------------------------------------------------------------------------
INSERT INTO reviews (product_id, customer_id, rating, title, body, helpful, created_at)
SELECT
    gs,
    ((gs * 7919) % 20000) + 1,
    (ARRAY['1','2','3','4','5'])[(gs % 5) + 1]::review_rating,
    'Review ' || gs,
    'This is the body of review ' || gs,
    (random() * 1000)::int,
    timestamptz '2022-01-01' + (random() * 100000000)::int * interval '1 second'
FROM generate_series(1, 20000) AS gs;

-- ---------------------------------------------------------------------------
-- data_types_demo — a single row exercising every type
-- ---------------------------------------------------------------------------
INSERT INTO data_types_demo (
    a_smallint, a_int, a_bigint, a_numeric, a_decimal, a_real, a_double, a_money,
    a_varchar, a_char, a_text, a_bytea, a_bool, a_date, a_time, a_timetz, a_ts,
    a_tstz, a_interval, a_uuid, a_json, a_jsonb, a_arr_int, a_arr_text, a_inet,
    a_cidr, a_mac, a_mac8, a_point, a_line, a_lseg, a_box, a_path, a_polygon,
    a_circle, a_bit, a_varbit, a_int4rng, a_numrng, a_tsrng, a_tsvec, a_tsquery, a_xml
) VALUES (
    42, 123456, 9007199254740993, 123456.7890, 987654.32, 3.14159, 2.718281828459045,
    12.34::numeric::money, 'hello world', 'char      ', 'some text', decode('cafebabe', 'hex'),
    TRUE, DATE '2024-06-15', TIME '13:45:30', TIMETZ '13:45:30+02',
    TIMESTAMP '2024-06-15 13:45:30', TIMESTAMPTZ '2024-06-15 13:45:30+02',
    INTERVAL '1 year 2 months 3 days 04:05:06', gen_random_uuid(),
    '{"a": 1, "b": [1,2,3]}'::json,
    '{"a": 1, "b": [1,2,3]}'::jsonb,
    ARRAY[1,2,3,4,5], ARRAY['x','y','z'],
    '192.168.1.100'::inet, '10.0.0.0/8'::cidr,
    '08:00:2b:01:02:03'::macaddr, '08:00:2b:01:02:03:04:05'::macaddr8,
    POINT(1, 2), LINE '{1,-1,0}', LSEG '[(0,0),(1,1)]', BOX '((0,0),(1,1))',
    PATH '[(0,0),(1,0),(1,1)]', POLYGON '((0,0),(1,0),(1,1),(0,1))',
    CIRCLE '<(0,0),5>', B'10101010', B'10101010',
    '[1,10)'::int4range, '[1.5,99.9)'::numrange, '[2024-01-01,2024-12-31)'::tsrange,
    to_tsvector('english', 'the quick brown fox'),
    to_tsquery('english', 'quick & fox'),
    '<root><item>value</item></root>'::xml
);

COMMIT;

SELECT 'customers' AS tbl, count(*) FROM customers
UNION ALL SELECT 'customer_addresses', count(*) FROM customer_addresses
UNION ALL SELECT 'categories', count(*) FROM categories
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'order_items', count(*) FROM order_items
UNION ALL SELECT 'reviews', count(*) FROM reviews
UNION ALL SELECT 'data_types_demo', count(*) FROM data_types_demo;
