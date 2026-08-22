-- §9.1 dataset for tests/db/mariadb.spec.ts, deliberately kept in parity with 0001_seed.sql so
-- the two spec files can assert the same things. Run against `kira_test`, which MARIADB_DATABASE
-- already created — no CREATE DATABASE / DROP SCHEMA dance needed (MariaDB has no schema level;
-- kira_analytics, the second database, is created by support/mariadb.ts instead).
--
-- Nothing here runs ANALYZE except big_rows (done in support/mariadb.ts after the bulk insert) —
-- every other table is left with TABLE_ROWS unpopulated, which is exactly what scenario 6 in
-- mariadb.spec.ts needs to assert (the adapter must surface that as `rowEstimate: null`).

USE `kira_test`;

-- The default 1024-byte GROUP_CONCAT cap would silently truncate nested_json's 200-element
-- array below; raised generously rather than cut it close.
SET SESSION group_concat_max_len = 100000;

-- -------------------------------------------------------------------------------------------
-- wide_table — 60 columns spanning the type list the catalog code must format correctly.
-- -------------------------------------------------------------------------------------------
CREATE TABLE wide_table (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  int_a         INT NOT NULL,
  int_b         INT,
  int_c         INT DEFAULT 0,
  int_d         INT,
  int_e         INT NOT NULL DEFAULT 1,
  int_f         INT,
  int_g         INT,
  bigint_a      BIGINT NOT NULL,
  bigint_b      BIGINT,
  bigint_c      BIGINT DEFAULT 0,
  decimal_a     DECIMAL(20, 6) NOT NULL,
  decimal_b     DECIMAL(20, 6),
  decimal_c     DECIMAL(20, 6) DEFAULT 0,
  decimal_d     DECIMAL(20, 6),
  text_a        TEXT NOT NULL,
  text_b        TEXT,
  text_c        TEXT,
  text_d        TEXT,
  text_e        TEXT,
  text_f        TEXT,
  text_g        TEXT,
  text_h        TEXT,
  text_i        TEXT,
  varchar_a     VARCHAR(50) NOT NULL,
  varchar_b     VARCHAR(50),
  varchar_c     VARCHAR(50) DEFAULT 'default',
  varchar_d     VARCHAR(50),
  varchar_e     VARCHAR(50),
  varchar_f     VARCHAR(50),
  varchar_g     VARCHAR(50),
  varchar_h     VARCHAR(50),
  bool_a        TINYINT(1) NOT NULL DEFAULT 0,
  bool_b        TINYINT(1),
  bool_c        TINYINT(1) DEFAULT 1,
  bool_d        TINYINT(1),
  date_a        DATE NOT NULL DEFAULT (CURRENT_DATE),
  date_b        DATE,
  date_c        DATE,
  date_d        DATE,
  datetime_a    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  datetime_b    DATETIME(6),
  datetime_c    DATETIME(6),
  ts_a          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ts_b          TIMESTAMP NULL,
  ts_c          TIMESTAMP NULL,
  -- Native UUID type (MariaDB 10.7+; this fixture pins 11.4) rather than a CHAR(36) stand-in.
  uuid_a        UUID NOT NULL DEFAULT (UUID()),
  uuid_b        UUID,
  uuid_c        UUID,
  uuid_d        UUID,
  json_a        JSON,
  json_b        JSON,
  json_c        JSON,
  json_d        JSON,
  blob_a        BLOB,
  blob_b        BLOB,
  blob_c        BLOB,
  enum_a        ENUM('small', 'medium', 'large') NOT NULL DEFAULT 'medium',
  set_a         SET('read', 'write', 'admin')
) ENGINE = InnoDB;

ALTER TABLE wide_table COMMENT = 'covers every scalar type the catalog code must format';
ALTER TABLE wide_table MODIFY id BIGINT AUTO_INCREMENT COMMENT 'surrogate primary key';
ALTER TABLE wide_table MODIFY int_a INT NOT NULL COMMENT 'a required integer with no default';
ALTER TABLE wide_table MODIFY varchar_c VARCHAR(50) DEFAULT 'default' COMMENT 'has a literal default';
ALTER TABLE wide_table MODIFY json_a JSON COMMENT 'arbitrary JSON payload';

INSERT INTO wide_table (
  int_a, bigint_a, decimal_a, text_a, varchar_a
) VALUES
  (1, 10, 1.5, 'row one', 'v1'),
  (2, 20, 2.5, 'row two', 'v2');

-- -------------------------------------------------------------------------------------------
-- nulls_and_unicode — NULL vs empty-string distinction, unicode edge cases, oversized values.
-- Explicit utf8mb4 on the table, not just the connection — otherwise the emoji silently become
-- '?'.
-- -------------------------------------------------------------------------------------------
CREATE TABLE nulls_and_unicode (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  label     TEXT,
  note      TEXT,
  big_text  LONGTEXT,
  -- Plain BLOB caps out at 64 KB — too small for the 256 KB oversized value below.
  big_blob  MEDIUMBLOB
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Every nullable column NULL.
INSERT INTO nulls_and_unicode (label, note, big_text, big_blob) VALUES (NULL, NULL, NULL, NULL);
-- Empty strings — must render distinctly from NULL.
INSERT INTO nulls_and_unicode (label, note, big_text, big_blob) VALUES ('', '', '', '');
-- Emoji, CJK, RTL, combining characters.
INSERT INTO nulls_and_unicode (label, note) VALUES (
  '😀🎉👍 emoji',
  CONCAT('中文测试 日本語テスト 한국어 테스트 العربية עברית e', CHAR(0x0301 USING utf8mb4), ' combining acute')
);
-- 1 MB text value and a 256 KB blob value.
INSERT INTO nulls_and_unicode (label, big_text, big_blob) VALUES (
  'oversized values',
  REPEAT('a', 1048576),
  UNHEX(REPEAT('41', 262144))
);

-- -------------------------------------------------------------------------------------------
-- nested_json — 5-level nested JSON with a 200-element array at the bottom.
-- -------------------------------------------------------------------------------------------
CREATE TABLE nested_json (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  data JSON NOT NULL
) ENGINE = InnoDB;

INSERT INTO nested_json (id, data) VALUES (
  1,
  JSON_OBJECT(
    'level1', JSON_OBJECT(
      'level2', JSON_OBJECT(
        'level3', JSON_OBJECT(
          'level4', JSON_OBJECT(
            'level5', JSON_OBJECT(
              'value', 'deep',
              -- MariaDB has no CAST(... AS JSON) (JSON isn't a cast target type — it's a LONGTEXT
              -- alias); JSON_ARRAYAGG is a genuine JSON-producing aggregate, so JSON_OBJECT embeds
              -- its result as an array rather than quoting it as a string.
              'items', (SELECT JSON_ARRAYAGG(seq) FROM seq_1_to_200)
            )
          )
        )
      )
    )
  )
);

-- -------------------------------------------------------------------------------------------
-- composite_pk — a two-column primary key.
-- -------------------------------------------------------------------------------------------
CREATE TABLE composite_pk (
  tenant_id INT NOT NULL,
  entity_id INT NOT NULL,
  name      VARCHAR(255),
  PRIMARY KEY (tenant_id, entity_id)
) ENGINE = InnoDB;

INSERT INTO composite_pk (tenant_id, entity_id, name) VALUES
  (1, 1, 'tenant 1 / entity 1'),
  (1, 2, 'tenant 1 / entity 2'),
  (2, 1, 'tenant 2 / entity 1');

-- -------------------------------------------------------------------------------------------
-- employees — self-referencing FK (D17's referencedBy-pointing-at-itself case).
-- -------------------------------------------------------------------------------------------
CREATE TABLE employees (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  manager_id INT NULL,
  CONSTRAINT fk_employees_manager FOREIGN KEY (manager_id) REFERENCES employees (id)
) ENGINE = InnoDB;

INSERT INTO employees (id, name, manager_id) VALUES
  (1, 'Ada', NULL),
  (2, 'Grace', 1),
  (3, 'Alan', 1);
ALTER TABLE employees AUTO_INCREMENT = 4;

-- -------------------------------------------------------------------------------------------
-- regions -> customers -> orders -> order_items <- products — a multi-hop FK graph so both
-- foreignKeys and referencedBy (D17) have something to assert. InnoDB throughout (FKs require
-- it).
-- -------------------------------------------------------------------------------------------
CREATE TABLE regions (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL
) ENGINE = InnoDB;

CREATE TABLE customers (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(255) NOT NULL,
  region_id INT NULL,
  CONSTRAINT fk_customers_region FOREIGN KEY (region_id) REFERENCES regions (id)
) ENGINE = InnoDB;

CREATE TABLE products (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  name  VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2) NOT NULL
) ENGINE = InnoDB;

CREATE TABLE orders (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  ordered_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id)
) ENGINE = InnoDB;

CREATE TABLE order_items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  order_id   INT NOT NULL,
  product_id INT NOT NULL,
  quantity   INT NOT NULL DEFAULT 1,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products (id),
  -- A second index besides the PK, so scenario 5's "one index per created index" has more than
  -- the implicit one to assert against.
  UNIQUE KEY order_items_order_product_idx (order_id, product_id)
) ENGINE = InnoDB;

INSERT INTO regions (id, name) VALUES (1, 'EMEA'), (2, 'APAC');
ALTER TABLE regions AUTO_INCREMENT = 3;

INSERT INTO customers (id, name, region_id) VALUES (1, 'Acme Co', 1), (2, 'Globex', 2);
ALTER TABLE customers AUTO_INCREMENT = 3;

INSERT INTO products (id, name, price) VALUES (1, 'Widget', 9.99), (2, 'Gadget', 19.99);
ALTER TABLE products AUTO_INCREMENT = 3;

INSERT INTO orders (id, customer_id) VALUES (1, 1), (2, 2);
ALTER TABLE orders AUTO_INCREMENT = 3;

INSERT INTO order_items (order_id, product_id, quantity) VALUES
  (1, 1, 2),
  (1, 2, 1),
  (2, 1, 5);

-- -------------------------------------------------------------------------------------------
-- big_rows — the table only; support/mariadb.ts inserts the 1,000,000 rows (via the SEQUENCE
-- engine) and runs ANALYZE TABLE, gated by its own seedBigTable option — the table itself
-- always exists regardless of that gate.
-- -------------------------------------------------------------------------------------------
CREATE TABLE big_rows (
  id      INT PRIMARY KEY,
  payload CHAR(32) NOT NULL
) ENGINE = InnoDB;

-- -------------------------------------------------------------------------------------------
-- One view, one sequence, one stored function, one stored procedure — every NodeKind the
-- adapter can emit besides table/column. No materialized view (MariaDB has none) — its absence
-- is asserted rather than pretended.
-- -------------------------------------------------------------------------------------------
CREATE VIEW order_summary AS
  SELECT o.id AS order_id, c.name AS customer_name, COUNT(oi.id) AS item_count
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN order_items oi ON oi.order_id = o.id
  GROUP BY o.id, c.name;

CREATE SEQUENCE invoice_number_seq START WITH 1000;

CREATE FUNCTION full_name(first_name VARCHAR(255), last_name VARCHAR(255)) RETURNS VARCHAR(511)
  DETERMINISTIC
  RETURN CONCAT(first_name, ' ', last_name);

-- A single-statement body (no BEGIN...END) is deliberate: `importFile`'s client-side statement
-- splitter (mariadb.js) has no DELIMITER support and naively splits on every top-level ';', so a
-- compound BEGIN...END body's internal ';' breaks it into two bogus statements. This fixture only
-- needs a procedure to exist for the NodeKind coverage, not a compound body.
CREATE PROCEDURE noop_procedure() SELECT 1;

-- -------------------------------------------------------------------------------------------
-- Identifier-quoting edge cases — a backtick inside a table name, and a name with a space.
-- -------------------------------------------------------------------------------------------
CREATE TABLE `weird``name` (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  value VARCHAR(255)
) ENGINE = InnoDB;
INSERT INTO `weird``name` (value) VALUES ('quoting works');

CREATE TABLE `Order Items` (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  note VARCHAR(255)
) ENGINE = InnoDB;
INSERT INTO `Order Items` (note) VALUES ('space in identifier');
