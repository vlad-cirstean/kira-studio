#!/usr/bin/env bun

// Kira Studio — SQLite demo database.
// Run: bun scripts/demo-dbs/sqlite/seed.ts
//
// Unlike every other engine's demo (a container + init.sql/seed.sql pair applied through a
// client), SQLite has no server and no compose service to give it one (D36) — the artefact a
// SQLite connection needs is a file on disk, so this script builds one directly with the same
// module (`node:sqlite`) the app's own adapter uses. A port of ../mysql/init.sql +
// ../mysql/seed.sql, not a copy: the same customers/customer_addresses/categories/products/
// orders/order_items/reviews/data_types_demo model, substituting SQLite's own type vocabulary for
// MySQL's (no ENUM/SET/geometry/YEAR/BIT types; UUID and JSON stay TEXT-affinity the same way the
// adapter's own fixture ports them) and generating rows in JS rather than a WITH RECURSIVE numbers
// CTE — plain loops read the same either way, and it keeps this file dependency-free.

import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DB_PATH = resolve(import.meta.dirname, 'kira-demo.sqlite');
const CUSTOMERS = 20_000;
const ADDRESSES = 20_000;
const CATEGORIES = 20_000;
const PRODUCTS = 20_000;
const ORDERS = 20_000;
const ORDER_ITEMS = 80_000;
const REVIEWS = 20_000;

const SCHEMA = `
CREATE TABLE customers (
  id             INTEGER PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  full_name      TEXT NOT NULL,
  nickname       TEXT,
  salutation     TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT 1,
  balance        DECIMAL(14, 2) NOT NULL DEFAULT 0,
  loyalty_points INTEGER DEFAULT 0,
  discount_rate  REAL DEFAULT 0,
  lifetime_value REAL DEFAULT 0,
  birth_date     DATE,
  signup_dt      DATETIME DEFAULT CURRENT_TIMESTAMP,
  signup_ts      TIMESTAMP,
  last_seen      TEXT,
  avatar         BLOB,
  profile        JSON,
  legacy_profile TEXT,
  tags           TEXT,
  status         TEXT,
  flags          INTEGER,
  raw_bytes      BLOB,
  uuid           TEXT UNIQUE,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_customers_full_name ON customers (full_name);
CREATE INDEX idx_customers_signup_ts ON customers (signup_ts);
CREATE INDEX idx_customers_balance ON customers (balance);
CREATE INDEX idx_customers_status ON customers (status);

CREATE TABLE customer_addresses (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  street      TEXT NOT NULL,
  city        TEXT NOT NULL,
  region      TEXT,
  postal_code TEXT,
  country     TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT 0,
  phone       TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_addresses_customer ON customer_addresses (customer_id);
CREATE INDEX idx_addresses_city ON customer_addresses (city);

CREATE TABLE categories (
  id          INTEGER PRIMARY KEY,
  parent_id   INTEGER REFERENCES categories (id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_categories_parent ON categories (parent_id);
CREATE INDEX idx_categories_sort ON categories (parent_id, sort_order);

CREATE TABLE products (
  id              INTEGER PRIMARY KEY,
  category_id     INTEGER REFERENCES categories (id) ON DELETE SET NULL,
  sku             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  long_desc       TEXT,
  price           DECIMAL(12, 2) NOT NULL,
  old_price       DECIMAL(12, 2),
  cost            DECIMAL(12, 2),
  weight_grams    INTEGER,
  volume_ml       INTEGER,
  weight_lbs      REAL,
  stock           INTEGER NOT NULL DEFAULT 0,
  reorder_level   INTEGER DEFAULT 10,
  rating          REAL DEFAULT 0,
  review_count    INTEGER DEFAULT 0,
  is_featured     BOOLEAN DEFAULT 0,
  is_published    BOOLEAN DEFAULT 1,
  available_from  DATE,
  available_at    DATETIME,
  lead_time_days  INTEGER,
  attributes      JSON,
  images          BLOB
);
CREATE INDEX idx_products_category ON products (category_id);
CREATE INDEX idx_products_name ON products (name);
CREATE INDEX idx_products_price ON products (price);
CREATE INDEX idx_products_rating ON products (rating);

CREATE TABLE orders (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  address_id  INTEGER REFERENCES customer_addresses (id) ON DELETE SET NULL,
  reference   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  total       DECIMAL(14, 2) NOT NULL,
  discount    DECIMAL(14, 2) DEFAULT 0,
  tax         DECIMAL(14, 2) DEFAULT 0,
  placed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  shipped_at  DATETIME,
  notes       TEXT
);
CREATE INDEX idx_orders_customer ON orders (customer_id);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_placed_at ON orders (placed_at);
CREATE INDEX idx_orders_customer_status ON orders (customer_id, status);

CREATE TABLE order_items (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products (id),
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_price   DECIMAL(12, 2) NOT NULL,
  line_total   DECIMAL(14, 2) NOT NULL,
  sku_snapshot TEXT
);
CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_order_items_product ON order_items (product_id);
CREATE INDEX idx_order_items_order_product ON order_items (order_id, product_id);

CREATE TABLE reviews (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  rating      TEXT NOT NULL,
  title       TEXT,
  body        TEXT,
  helpful     INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id, customer_id)
);
CREATE INDEX idx_reviews_product ON reviews (product_id);
CREATE INDEX idx_reviews_customer ON reviews (customer_id);
CREATE INDEX idx_reviews_created ON reviews (created_at);

-- One row exercising SQLite's own type vocabulary (declared-type spellings across every
-- affinity family, F21) — the SQLite analogue of mysql/init.sql's data_types_demo, not a
-- byte-for-byte type list (SQLite has no ENUM/SET/BIT/YEAR/geometry types to stand in for).
CREATE TABLE data_types_demo (
  id           INTEGER PRIMARY KEY,
  a_tinyint    TINYINT,
  a_smallint   SMALLINT,
  a_int        INT,
  a_bigint     BIGINT,
  a_decimal    DECIMAL(20, 4),
  a_numeric    NUMERIC(10, 2),
  a_real       REAL,
  a_double     DOUBLE,
  a_char       CHAR(10),
  a_varchar    VARCHAR(100),
  a_text       TEXT,
  a_blob       BLOB,
  a_boolean    BOOLEAN,
  a_date       DATE,
  a_time       TEXT,
  a_datetime   DATETIME,
  a_timestamp  TIMESTAMP,
  a_json       JSON,
  a_uuid       CHAR(36),
  -- No declared type at all — SQLite's own "no affinity rule" case (typeClassFor's 'other').
  a_no_type
);
`;

function rand(n: number): number {
  return Math.floor(Math.random() * n);
}

function pick<T>(items: readonly T[]): T {
  return items[rand(items.length)];
}

function randomDate(startMs: number, spanMs: number): string {
  return new Date(startMs + rand(spanMs)).toISOString().replace('T', ' ').replace('Z', '');
}

function fakeUuid(seed: number): string {
  const hex = seed.toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-${(seed * 2654435761).toString(16).padStart(12, '0').slice(0, 12)}`;
}

async function main() {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);

  const cities = ['Berlin', 'London', 'Paris', 'Tokyo', 'New York', 'Sydney', 'Toronto', 'Madrid'];
  const regions = ['CA', 'NY', 'TX', 'BW', 'ENG', 'IDF', 'NSW', 'ON'];
  const countries = ['US', 'DE', 'GB', 'FR', 'JP', 'AU', 'CA', 'ES'];
  const labels = ['home', 'work', 'billing', 'shipping'];
  const salutations = ['Mr.', 'Ms.', 'Dr.', 'Mx.'];
  const tags = ['vip', 'new', 'returning', 'whale'];
  const statuses = ['active', 'suspended', 'deleted'];
  const orderStatuses = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
  const tiers = ['bronze', 'silver', 'gold', 'platinum'];

  db.exec('BEGIN');
  try {
    // --- customers -----------------------------------------------------------------------
    const insertCustomer = db.prepare(`
      INSERT INTO customers (
        email, full_name, nickname, salutation, is_active, balance, loyalty_points,
        discount_rate, lifetime_value, birth_date, signup_dt, signup_ts, last_seen,
        avatar, profile, legacy_profile, tags, status, flags, raw_bytes, uuid, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 1; i <= CUSTOMERS; i++) {
      insertCustomer.run(
        `user${i}@example.com`,
        `Customer ${i}`,
        `nick${i}`,
        pick(salutations),
        i % 7 === 0 ? 0 : 1,
        Math.round(Math.random() * 100000 * 100) / 100,
        rand(10_000_000) % 8_388_607,
        Math.round(Math.random() * 30 * 100) / 100,
        Math.random() * 100000,
        randomDate(Date.UTC(1950, 0, 1), 26_000 * 86_400_000).slice(0, 10),
        randomDate(Date.UTC(2015, 0, 1), 300_000_000_000),
        randomDate(Date.UTC(2015, 0, 1), 300_000_000_000),
        randomDate(0, 86_400_000).slice(11, 19),
        Buffer.from(fakeUuid(i).replace(/-/g, ''), 'hex').subarray(0, 16),
        JSON.stringify({ tier: pick(tiers), visits: rand(500) }),
        `legacy import ${i}`,
        pick(tags),
        pick(statuses),
        0b10101010,
        Buffer.from(i.toString(16).padStart(32, '0'), 'hex'),
        fakeUuid(i),
        randomDate(Date.UTC(2015, 0, 1), 300_000_000_000),
      );
    }

    // --- customer_addresses ----------------------------------------------------------------
    const insertAddress = db.prepare(`
      INSERT INTO customer_addresses (
        customer_id, label, street, city, region, postal_code, country, is_default, phone, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 1; i <= ADDRESSES; i++) {
      insertAddress.run(
        i,
        pick(labels),
        `${i % 9999} Main St`,
        pick(cities),
        pick(regions),
        String(i % 99999).padStart(5, '0'),
        pick(countries),
        i % 5 === 0 ? 1 : 0,
        `+1-555-${String(i % 10000).padStart(4, '0')}`,
        randomDate(Date.UTC(2015, 0, 1), 300_000_000_000),
      );
    }

    // --- categories (self-referencing) -----------------------------------------------------
    const insertCategory = db.prepare(`
      INSERT INTO categories (parent_id, name, slug, description, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (let i = 1; i <= CATEGORIES; i++) {
      const parentId = i <= 16 || i % 17 === 0 ? null : i - ((i % 16) + 1);
      insertCategory.run(
        parentId,
        `Category ${i}`,
        `category-${i}`,
        `Description for category ${i}`,
        i % 100,
        randomDate(Date.UTC(2015, 0, 1), 300_000_000_000),
      );
    }

    // --- products ----------------------------------------------------------------------------
    const insertProduct = db.prepare(`
      INSERT INTO products (
        category_id, sku, name, description, long_desc, price, old_price, cost, weight_grams,
        volume_ml, weight_lbs, stock, reorder_level, rating, review_count, is_featured,
        is_published, available_from, available_at, lead_time_days, attributes, images
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 1; i <= PRODUCTS; i++) {
      insertProduct.run(
        (i % CATEGORIES) + 1,
        `SKU-${String(i).padStart(6, '0')}`,
        `Product ${i}`,
        `Short description for product ${i}`,
        `Long description for product ${i}`.repeat(3),
        Math.round((Math.random() * 5000 + 1) * 100) / 100,
        Math.round((Math.random() * 6000 + 1) * 100) / 100,
        Math.round((Math.random() * 4000 + 1) * 100) / 100,
        rand(5000),
        rand(2000),
        Math.random() * 20,
        rand(1000),
        10,
        Math.round(Math.random() * 5 * 100) / 100,
        rand(500),
        i % 20 === 0 ? 1 : 0,
        i % 50 === 0 ? 0 : 1,
        randomDate(Date.UTC(2015, 0, 1), 300_000_000_000).slice(0, 10),
        randomDate(Date.UTC(2015, 0, 1), 300_000_000_000),
        rand(30),
        JSON.stringify({ color: pick(['red', 'blue', 'green', 'black']), weight: rand(5000) }),
        Buffer.from(`image-bytes-${i}`),
      );
    }

    // --- orders --------------------------------------------------------------------------
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        customer_id, address_id, reference, status, total, discount, tax, placed_at,
        updated_at, shipped_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 1; i <= ORDERS; i++) {
      const placedAt = randomDate(Date.UTC(2020, 0, 1), 150_000_000_000);
      insertOrder.run(
        ((i - 1) % CUSTOMERS) + 1,
        ((i - 1) % ADDRESSES) + 1,
        fakeUuid(i * 31),
        pick(orderStatuses),
        Math.round((Math.random() * 5000 + 10) * 100) / 100,
        Math.round(Math.random() * 100 * 100) / 100,
        Math.round(Math.random() * 200 * 100) / 100,
        placedAt,
        placedAt,
        i % 3 === 0 ? randomDate(Date.UTC(2020, 0, 1), 150_000_000_000) : null,
        i % 10 === 0 ? `Note for order ${i}` : null,
      );
    }

    // --- order_items (deterministic spread, mirrors the mysql seed's own hashing) ----------
    const insertOrderItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total, sku_snapshot)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (let i = 1; i <= ORDER_ITEMS; i++) {
      const orderId = ((i - 1) % ORDERS) + 1;
      const productId = ((i * 7919) % PRODUCTS) + 1;
      const quantity = (i % 5) + 1;
      const unitPrice = Math.round((Math.random() * 1000 + 10) * 100) / 100;
      insertOrderItem.run(
        orderId,
        productId,
        quantity,
        unitPrice,
        Math.round(unitPrice * quantity * 100) / 100,
        `SKU-${String(productId).padStart(6, '0')}`,
      );
    }

    // --- reviews (unique product/customer pairs) --------------------------------------------
    const insertReview = db.prepare(`
      INSERT INTO reviews (product_id, customer_id, rating, title, body, helpful, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 1; i <= REVIEWS; i++) {
      insertReview.run(
        ((i - 1) % PRODUCTS) + 1,
        ((i * 7919) % CUSTOMERS) + 1,
        String((i % 5) + 1),
        `Review ${i}`,
        `This is the body of review ${i}`,
        rand(1000),
        randomDate(Date.UTC(2022, 0, 1), 100_000_000_000),
      );
    }

    // --- data_types_demo — one row -----------------------------------------------------------
    db.prepare(`
      INSERT INTO data_types_demo (
        a_tinyint, a_smallint, a_int, a_bigint, a_decimal, a_numeric, a_real, a_double,
        a_char, a_varchar, a_text, a_blob, a_boolean, a_date, a_time, a_datetime,
        a_timestamp, a_json, a_uuid, a_no_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      127,
      32767,
      2147483647,
      9007199254740993n,
      123456.789,
      987654.32,
      42.5,
      99.75,
      'char',
      'hello world',
      'some text',
      Buffer.from('DEADBEEF', 'hex'),
      1,
      '2024-06-15',
      '13:45:30',
      '2024-06-15 13:45:30',
      '2024-06-15 13:45:30',
      JSON.stringify({ a: 1, b: [1, 2, 3] }),
      fakeUuid(999),
      'no declared type, BLOB affinity',
    );

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  db.exec('ANALYZE');

  const counts = db
    .prepare(
      `SELECT 'customers' AS tbl, count(*) AS n FROM customers
       UNION ALL SELECT 'customer_addresses', count(*) FROM customer_addresses
       UNION ALL SELECT 'categories', count(*) FROM categories
       UNION ALL SELECT 'products', count(*) FROM products
       UNION ALL SELECT 'orders', count(*) FROM orders
       UNION ALL SELECT 'order_items', count(*) FROM order_items
       UNION ALL SELECT 'reviews', count(*) FROM reviews
       UNION ALL SELECT 'data_types_demo', count(*) FROM data_types_demo`,
    )
    .all() as { tbl: string; n: number }[];
  for (const row of counts) console.log(`  ${row.tbl.padEnd(20)} ${row.n}`);

  db.close();
  console.log(`\nSQLite demo database written to:\n  ${DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
