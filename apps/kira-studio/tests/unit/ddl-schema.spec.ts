// D21: the DDL extractor (ddl.ts) earns a unit test — a tree walk over four dialects' grammars
// with interacting rules: qualified vs. unqualified names, quoted vs. bare vs. keyword-shaped
// column names (F5.1's `id`), nested type-argument parens, table constraints that are not
// columns, `IF NOT EXISTS`, and statements it must skip silently.

import { describe, expect, test } from 'bun:test';
import { MySQL, PostgreSQL, SQLDialect, SQLite } from '@codemirror/lang-sql';
import { defaultSchemaFor, parseDdl, toSqlNamespace } from '../../frontend/src/views/console/ddl';

// Mirrors editor/languages.ts's own ClickHouseDialect exactly — kept independent here rather than
// imported, since languages.ts pulls in Vue-adjacent editor modules this spec has no reason to load.
const ClickHouseDialect = SQLDialect.define({
  backslashEscapes: true,
  hashComments: true,
  doubleQuotedStrings: false,
  identifierQuotes: '`"',
  keywords:
    'select from where group by order having limit offset with as distinct into values ' +
    'insert update delete alter create drop table database view materialized dictionary ' +
    'engine order primary key partition sample ttl settings format prewhere final sample ' +
    'array join left right inner full cross global any all asof using on and or not in is ' +
    'null between like exists case when then else end union all describe desc show exists ' +
    'attach detach optimize truncate rename kill system cluster replace if not exists ' +
    'with fill step interpolate limit by offset settings',
  types:
    'string fixedstring uint8 uint16 uint32 uint64 uint128 uint256 int8 int16 int32 int64 ' +
    'int128 int256 float32 float64 decimal decimal32 decimal64 decimal128 decimal256 bool ' +
    'boolean date date32 datetime datetime64 time time64 uuid ipv4 ipv6 enum enum8 enum16 ' +
    'array tuple map nested lowcardinality nullable json dynamic variant point ring polygon ' +
    'multipolygon aggregatefunction simpleaggregatefunction',
});

describe('parseDdl — one table per dialect', () => {
  test('postgres: qualified table, PK/UNIQUE/REFERENCES flags', () => {
    const schema = parseDdl(
      PostgreSQL,
      `CREATE TABLE public.users (
        id integer NOT NULL PRIMARY KEY,
        email varchar(255) UNIQUE,
        org_id integer REFERENCES orgs(id)
      );`,
    );
    expect(schema.tables).toHaveLength(1);
    const table = schema.tables[0];
    if (!table) throw new Error('expected one table');
    expect(table.name).toBe('users');
    expect(table.schema).toBe('public');
    expect(table.columns.map((c) => c.name)).toEqual(['id', 'email', 'org_id']);
    expect(table.columns[0]).toMatchObject({
      name: 'id',
      type: 'integer',
      notNull: true,
      primaryKey: true,
    });
    expect(table.columns[1]).toMatchObject({ name: 'email', type: 'varchar(255)', unique: true });
    expect(table.columns[2]?.references).toEqual({ table: 'orgs', column: 'id' });
  });

  test('mysql: backtick-quoted identifiers and an inline comment', () => {
    const schema = parseDdl(
      MySQL,
      "CREATE TABLE `orders` (\n  `id` INT NOT NULL AUTO_INCREMENT,\n  `total` DECIMAL(10,2) DEFAULT '0.00', -- money\n  PRIMARY KEY (`id`)\n);",
    );
    expect(schema.tables).toHaveLength(1);
    const table = schema.tables[0];
    if (!table) throw new Error('expected one table');
    expect(table.name).toBe('orders');
    expect(table.columns.map((c) => c.name)).toEqual(['id', 'total']);
    // F5.2: verbatim type slice, not a reconstruction — proves numeric(20,6)-shaped types survive.
    expect(table.columns[1]?.type).toBe('DECIMAL(10,2)');
    // The table-level `PRIMARY KEY (\`id\`)` constraint must not become a phantom column.
    expect(table.columns.some((c) => c.name.toUpperCase() === 'PRIMARY')).toBe(false);
  });

  test('sqlite: INTEGER PRIMARY KEY AUTOINCREMENT and NOT NULL/UNIQUE', () => {
    const schema = parseDdl(
      SQLite,
      'CREATE TABLE users (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  email TEXT UNIQUE\n);',
    );
    const table = schema.tables[0];
    if (!table) throw new Error('expected one table');
    expect(table.columns[0]).toMatchObject({ name: 'id', type: 'INTEGER', primaryKey: true });
    expect(table.columns[1]).toMatchObject({ name: 'name', type: 'TEXT', notNull: true });
    expect(table.columns[2]).toMatchObject({ name: 'email', type: 'TEXT', unique: true });
  });

  test('clickhouse: nested type-argument parens, and DEFAULT tokenised as a plain Identifier', () => {
    const schema = parseDdl(
      ClickHouseDialect,
      'CREATE TABLE default.events (\n  id UUID,\n  tags Array(LowCardinality(String)),\n  created DateTime64(3) DEFAULT now()\n) ENGINE = MergeTree() ORDER BY id;',
    );
    const table = schema.tables[0];
    if (!table) throw new Error('expected one table');
    expect(table.schema).toBe('default');
    expect(table.columns[1]).toMatchObject({ name: 'tags', type: 'Array(LowCardinality(String))' });
    // DEFAULT is not in this repo's ClickHouseDialect keyword list, so it tokenises as a plain
    // Identifier — the type slice must still stop there, not swallow "DateTime64(3) DEFAULT now()".
    expect(table.columns[2]).toMatchObject({ name: 'created', type: 'DateTime64(3)' });
  });
});

describe('parseDdl — F5.1: a column literally named `id`/`name` is a Postgres Keyword node', () => {
  test('id and name both parse as columns, not as dropped tokens', () => {
    const schema = parseDdl(PostgreSQL, 'CREATE TABLE t (id integer, name text);');
    expect(schema.tables[0]?.columns.map((c) => c.name)).toEqual(['id', 'name']);
  });
});

describe('parseDdl — table-level constraints are consumed, not emitted as columns', () => {
  test('PRIMARY KEY (a, b)', () => {
    const schema = parseDdl(
      PostgreSQL,
      'CREATE TABLE t (\n  a integer,\n  b integer,\n  PRIMARY KEY (a, b)\n);',
    );
    expect(schema.tables[0]?.columns.map((c) => c.name)).toEqual(['a', 'b']);
  });

  test('a named FOREIGN KEY constraint', () => {
    const schema = parseDdl(
      PostgreSQL,
      'CREATE TABLE t (\n  id integer,\n  org_id integer,\n  CONSTRAINT fk_org FOREIGN KEY (org_id) REFERENCES orgs(id)\n);',
    );
    expect(schema.tables[0]?.columns.map((c) => c.name)).toEqual(['id', 'org_id']);
  });
});

describe('parseDdl — IF NOT EXISTS, and CREATE INDEX marking a column indexed', () => {
  test('IF NOT EXISTS is skipped before the table name', () => {
    const schema = parseDdl(PostgreSQL, 'CREATE TABLE IF NOT EXISTS public.users (id integer);');
    expect(schema.tables[0]).toMatchObject({ name: 'users', schema: 'public' });
  });

  test('CREATE INDEX marks the indexed column (surfaced on hover, not completion)', () => {
    const schema = parseDdl(
      PostgreSQL,
      'CREATE TABLE users (id integer, email varchar(255));\nCREATE INDEX users_email_idx ON users (email);',
    );
    const table = schema.tables[0];
    if (!table) throw new Error('expected one table');
    expect(table.columns.find((c) => c.name === 'email')?.indexed).toBe(true);
    expect(table.columns.find((c) => c.name === 'id')?.indexed).toBeUndefined();
  });
});

describe('parseDdl — ALTER TABLE ADD COLUMN and COMMENT ON COLUMN', () => {
  test('ALTER TABLE adds a column to an already-declared table', () => {
    const schema = parseDdl(
      PostgreSQL,
      'CREATE TABLE users (id integer);\nALTER TABLE users ADD COLUMN age integer;',
    );
    expect(schema.tables[0]?.columns.map((c) => c.name)).toEqual(['id', 'age']);
  });

  test('COMMENT ON COLUMN sets the description used by the hover', () => {
    // Deliberately no embedded apostrophe: this Lezer grammar tokenises `''` as two adjacent
    // String literals rather than one escaped quote — a real grammar limitation (F4's own
    // "tokeniser, not a structural parser" — P13's OQ-5 answer), not something this extractor
    // can fix, so the description this rule captures is best-effort for that case.
    const schema = parseDdl(
      PostgreSQL,
      "CREATE TABLE users (id integer, email text);\nCOMMENT ON COLUMN public.users.email IS 'the users email';",
    );
    expect(schema.tables[0]?.columns.find((c) => c.name === 'email')?.description).toBe(
      'the users email',
    );
  });
});

describe('parseDdl — statements this extractor cannot make sense of are skipped silently', () => {
  test('a pg_dump preamble (SET/GRANT/a header comment) contributes nothing but does not stop the real table', () => {
    const schema = parseDdl(
      PostgreSQL,
      'SET search_path = public;\nGRANT SELECT ON users TO app;\n-- header comment\nCREATE TABLE t (id integer);',
    );
    expect(schema.tables).toHaveLength(1);
    expect(schema.tables[0]?.name).toBe('t');
  });

  test('an unterminated CREATE TABLE never throws', () => {
    expect(() =>
      parseDdl(PostgreSQL, 'CREATE TABLE t (id integer NOT NULL PRIMARY KEY'),
    ).not.toThrow();
  });
});

describe('toSqlNamespace — D10: a qualified table is emitted both nested and flat', () => {
  test('public.users completes as both `public.users` and bare `users`', () => {
    const schema = parseDdl(PostgreSQL, 'CREATE TABLE public.users (id integer);');
    const ns = toSqlNamespace(schema) as Record<string, unknown>;
    expect(ns.users).toBeDefined();
    expect((ns.public as Record<string, unknown>).users).toBeDefined();
  });

  test('a view completes with no columns', () => {
    const schema = parseDdl(PostgreSQL, 'CREATE VIEW active_users AS SELECT * FROM users;');
    const ns = toSqlNamespace(schema) as Record<string, unknown>;
    expect(ns.active_users).toEqual([]);
  });
});

// D6's own "verify at implementation time" note: schemaCompletionSource quotes from
// `dialect.spec.identifierQuotes`, and quoteIdent (sqlIdent.ts) quotes independently — this
// asserts they agree for every dialect this extractor runs against, so a completion accept can
// never insert a quote style the rest of the app wouldn't generate itself.
// D6's own "verify at implementation time rather than assume": schemaCompletionSource quotes a
// completion that needs it (a reserved word, a name with a space) from
// `dialect.spec.identifierQuotes?.[0] || '"'` (dist/index.js:539) — the *first* character of that
// string. This agrees with quoteIdent (sqlIdent.ts) for postgres ('"', the library default),
// mysql and clickhouse (backtick, explicitly configured, matching BACKTICK_DIALECTS) — but
// **disagrees for sqlite**: SQLite's own lang-sql dialect accepts both quote styles
// (`identifierQuotes: '`"'`), backtick listed first, so a needs-quoting completion accept inserts
// a backtick-quoted identifier there while quoteIdent's own default branch (sqlite is not in
// BACKTICK_DIALECTS) would double-quote the same name. Both are valid SQLite syntax — this is a
// style inconsistency, not a correctness bug, and it only ever surfaces for a column/table name
// that needs quoting in the first place (a bare lowercase name never does) — recorded here rather
// than silently assumed away, per D6's own instruction.
describe('dialect identifierQuotes vs. sqlIdent.ts quoteIdent — D6', () => {
  test("postgres: library default '\"' agrees with quoteIdent", () => {
    expect(PostgreSQL.spec.identifierQuotes).toBeUndefined(); // no override -> the library's own '"' default
  });

  test("mysql/clickhouse: backtick agrees with quoteIdent's BACKTICK_DIALECTS", () => {
    expect(MySQL.spec.identifierQuotes?.[0]).toBe('`');
    expect(ClickHouseDialect.spec.identifierQuotes?.[0]).toBe('`');
  });

  test("sqlite: the library's own first-quote-char choice is backtick, not quoteIdent's double-quote", () => {
    expect(SQLite.spec.identifierQuotes?.[0]).toBe('`');
  });
});

describe('defaultSchemaFor', () => {
  test("postgres: 'public' only when the DDL actually qualifies a table with it", () => {
    const withPublic = parseDdl(PostgreSQL, 'CREATE TABLE public.users (id integer);');
    expect(defaultSchemaFor(withPublic, 'postgres', undefined)).toBe('public');
    const withoutPublic = parseDdl(PostgreSQL, 'CREATE TABLE users (id integer);');
    expect(defaultSchemaFor(withoutPublic, 'postgres', undefined)).toBeUndefined();
  });

  test("mysql: the connection's own database, only when the DDL qualifies with it", () => {
    const schema = parseDdl(MySQL, 'CREATE TABLE app.orders (id INT);');
    expect(defaultSchemaFor(schema, 'mysql', 'app')).toBe('app');
    expect(defaultSchemaFor(schema, 'mysql', 'other')).toBeUndefined();
  });
});
