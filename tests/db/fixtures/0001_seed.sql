-- P1 §9.1 dataset. Two schemas so the tree lists more than one; every NodeKind the Postgres
-- adapter emits; identifier-quoting landmines ("weird""name", "Order Items"); a multi-hop FK graph;
-- a 60-column wide table; a 1M-row table (populated + ANALYZEd by the harness, not here).

CREATE SCHEMA app;
CREATE SCHEMA analytics;

-- 60 columns spanning the type families the UI must icon/type correctly.
CREATE TABLE app.wide_table (
  c01 int NOT NULL,
  c02 bigint,
  c03 smallint,
  c04 numeric(20,6),
  c05 real,
  c06 double precision,
  c07 text,
  c08 varchar(50),
  c09 char(10),
  c10 boolean NOT NULL DEFAULT false,
  c11 date,
  c12 time,
  c13 timestamp,
  c14 timestamptz,
  c15 interval,
  c16 uuid,
  c17 jsonb,
  c18 json,
  c19 bytea,
  c20 integer[],
  c21 text[],
  c22 inet,
  c23 cidr,
  c24 macaddr,
  c25 money,
  c26 integer NOT NULL DEFAULT 0,
  c27 bigint,
  c28 text NOT NULL DEFAULT ''::text,
  c29 varchar(255),
  c30 boolean,
  c31 date NOT NULL DEFAULT CURRENT_DATE,
  c32 timestamptz NOT NULL DEFAULT now(),
  c33 numeric(10,2),
  c34 real,
  c35 uuid NOT NULL DEFAULT gen_random_uuid(),
  c36 jsonb,
  c37 bytea,
  c38 integer[],
  c39 text,
  c40 varchar(100),
  c41 integer,
  c42 bigint,
  c43 smallint,
  c44 numeric(30,10),
  c45 real,
  c46 double precision,
  c47 text,
  c48 varchar(30),
  c49 boolean,
  c50 date,
  c51 time,
  c52 timestamp,
  c53 timestamptz,
  c54 interval,
  c55 uuid,
  c56 jsonb,
  c57 json,
  c58 bytea,
  c59 integer[],
  c60 text NOT NULL DEFAULT 'z'::text
);
COMMENT ON COLUMN app.wide_table.c01 IS 'surrogate id';
COMMENT ON COLUMN app.wide_table.c04 IS 'high-precision amount';
COMMENT ON COLUMN app.wide_table.c10 IS 'soft-delete flag';
COMMENT ON COLUMN app.wide_table.c16 IS 'external uuid';
COMMENT ON COLUMN app.wide_table.c17 IS 'document payload';

CREATE TABLE app.nulls_and_unicode (
  id serial PRIMARY KEY,
  nullable_text text,
  nullable_int int,
  empty_text text,
  emoji text,
  cjk text,
  rtl text,
  combining text,
  big_text text,
  big_bin bytea
);
INSERT INTO app.nulls_and_unicode
  (nullable_text, nullable_int, empty_text, emoji, cjk, rtl, combining, big_text, big_bin)
VALUES
  (NULL, NULL, '', '🐘🚀', '中文测试', 'مرحبا', U&'e\0301', repeat('x', 1048576), decode(repeat('ab', 262144), 'hex'));

CREATE TABLE app.nested_json (id serial PRIMARY KEY, doc jsonb);
INSERT INTO app.nested_json (doc)
VALUES (
  jsonb_build_object(
    'a', jsonb_build_object('b', jsonb_build_object('c', jsonb_build_object('d', jsonb_build_object('e', jsonb_build_array(1, 2, 3))))),
    'arr', (SELECT jsonb_agg(i) FROM generate_series(1, 200) i)
  )
);

CREATE TABLE app.composite_pk (
  tenant_id int NOT NULL,
  entity_id int NOT NULL,
  value text,
  PRIMARY KEY (tenant_id, entity_id)
);

CREATE TABLE app.employees (
  id int PRIMARY KEY,
  manager_id int REFERENCES app.employees(id),
  name text
);
INSERT INTO app.employees VALUES (1, NULL, 'alice'), (2, 1, 'bob');

CREATE TABLE app.regions (id int PRIMARY KEY, name text);
INSERT INTO app.regions VALUES (1, 'west'), (2, 'east');

CREATE TABLE app.customers (id int PRIMARY KEY, region_id int REFERENCES app.regions(id), name text);
INSERT INTO app.customers VALUES (1, 1, 'acme'), (2, 2, 'globex');

CREATE TABLE app.products (id int PRIMARY KEY, sku text);
INSERT INTO app.products VALUES (1, 'SKU-1'), (2, 'SKU-2');

CREATE TABLE app.orders (id int PRIMARY KEY, customer_id int NOT NULL REFERENCES app.customers(id));
INSERT INTO app.orders VALUES (1, 1), (2, 2);

CREATE TABLE app.order_items (
  id int PRIMARY KEY,
  order_id int NOT NULL REFERENCES app.orders(id),
  product_id int NOT NULL REFERENCES app.products(id),
  qty int NOT NULL DEFAULT 1
);
CREATE INDEX order_items_order_idx ON app.order_items (order_id);
INSERT INTO app.order_items VALUES (1, 1, 1, 2), (2, 1, 2, 1), (3, 2, 1, 5);

CREATE TABLE app.big_rows (id bigint PRIMARY KEY, hash text);

CREATE VIEW app.customer_names AS SELECT id, name FROM app.customers;
CREATE MATERIALIZED VIEW app.region_stats AS SELECT region_id, count(*) AS n FROM app.customers GROUP BY region_id;
CREATE SEQUENCE app.order_seq START 1;
CREATE FUNCTION app.add(a int, b int) RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT a + b $$;
CREATE PROCEDURE app.touch_table() LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END $$;

CREATE TABLE app."weird""name" (id int PRIMARY KEY, "col one" text);
CREATE TABLE app."Order Items" (id int PRIMARY KEY, item_name text);

CREATE TABLE analytics.events (id bigserial PRIMARY KEY, payload jsonb);
