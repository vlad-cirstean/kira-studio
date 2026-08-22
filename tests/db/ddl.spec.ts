import { splitSqlStatements } from '../../src/shared/ddl';
import type { Adapter, OpCtx } from '../../src/engine/adapters/adapter';
import { createAdapter } from '../../src/engine/adapters/registry';
import { type NodeKind, type NodePath } from '../../src/shared/tree';
import { isDockerAvailable } from './support/docker';
import { afterAll, describe, expect, test } from './support/harness';
import { type PgFixture, startPostgres } from './support/postgres';

// P4 splitter tests (D4). Pure — no Docker. The splitter must find top-level statement boundaries
// without being fooled by `;` inside quoted strings, comments, or (postgres) dollar-quoted bodies.

function labels(text: string, dialect: 'postgres' | 'mariadb' = 'postgres'): string[] {
  return splitSqlStatements(text, dialect).map((s) => s.label);
}

describe('splitSqlStatements', () => {
  test('a semicolon inside a single-quoted string does not split', () => {
    const text = `INSERT INTO t VALUES ('a;b');\nSELECT 1;`;
    const parts = splitSqlStatements(text, 'postgres');
    expect(parts).toHaveLength(2);
    expect(parts[0].label).toBe('INSERT INTO');
    expect(parts[1].label).toBe('SELECT 1');
  });

  test('a semicolon inside a double-quoted identifier does not split', () => {
    const text = `CREATE TABLE "a;b" (id int);`;
    const parts = splitSqlStatements(text, 'postgres');
    expect(parts).toHaveLength(1);
    expect(parts[0].label).toBe('CREATE TABLE');
  });

  test('a postgres function body with $$ ... ; ... END $$ is ONE statement', () => {
    const body = `CREATE OR REPLACE FUNCTION f() RETURNS void AS $fn$
BEGIN
  RAISE NOTICE ';';
  PERFORM 1;
END;
$fn$ LANGUAGE plpgsql;`;
    const parts = splitSqlStatements(body, 'postgres');
    expect(parts).toHaveLength(1);
    expect(parts[0].label).toBe('CREATE OR');
  });

  test('the dialect flag is load-bearing: the same body is MULTIPLE statements for mariadb', () => {
    const body = `CREATE OR REPLACE FUNCTION f() RETURNS void AS $fn$
BEGIN
  PERFORM 1;
END;
$fn$ LANGUAGE plpgsql;`;
    const pg = splitSqlStatements(body, 'postgres');
    const maria = splitSqlStatements(body, 'mariadb');
    expect(pg).toHaveLength(1);
    expect(maria.length).toBeGreaterThan(1);
  });

  test('-- line comments swallow a semicolon', () => {
    const text = `SELECT 1; -- ;\nSELECT 2;`;
    const parts = splitSqlStatements(text, 'postgres');
    expect(parts).toHaveLength(2);
  });

  test('/* block */ comments swallow a semicolon, and nest', () => {
    const text = `SELECT 1 /* a ; b /* nested ; */ still */ + 2;`;
    const parts = splitSqlStatements(text, 'postgres');
    expect(parts).toHaveLength(1);
  });

  test(';; and a trailing ; produce no empty statements', () => {
    const parts = splitSqlStatements('SELECT 1;;\nSELECT 2;\n', 'postgres');
    expect(parts).toHaveLength(2);
  });

  test('startLine/endLine are correct across a multi-line statement', () => {
    const text = `CREATE TABLE t (\n  id int,\n  name text\n);`;
    const parts = splitSqlStatements(text, 'postgres');
    expect(parts).toHaveLength(1);
    expect(parts[0].startLine).toBe(0);
    expect(parts[0].endLine).toBe(3);
  });

  test('mariadb backtick identifiers swallow a semicolon', () => {
    const text = 'CREATE TABLE `a;b` (id int);';
    const parts = splitSqlStatements(text, 'mariadb');
    expect(parts).toHaveLength(1);
  });

  test('postgres treats backticks as identifiers too', () => {
    const text = 'CREATE TABLE `a;b` (id int);';
    const parts = splitSqlStatements(text, 'postgres');
    expect(parts).toHaveLength(1);
  });

  test('$1 is not a dollar-quote opener', () => {
    const text = `SELECT $1;`;
    const parts = splitSqlStatements(text, 'postgres');
    expect(parts).toHaveLength(1);
    expect(parts[0].label).toBe('SELECT $1');
  });

  test('escaped single quotes do not close the string', () => {
    const text = `INSERT INTO t VALUES ('it''s; ok');SELECT 1;`;
    const parts = splitSqlStatements(text, 'postgres');
    expect(parts).toHaveLength(2);
  });
});

// ---- adapter DDL against the Postgres container (needs Colima; skipped when unavailable) ----

const dockerAvailable = await isDockerAvailable();
let pg: PgFixture | null = null;
if (dockerAvailable) {
  pg = await startPostgres();
}
afterAll(async () => {
  await pg?.stop();
});

function pgFixture(): PgFixture {
  if (!pg) throw new Error('postgres fixture not started');
  return pg;
}

function makeCtx(): OpCtx {
  return { opId: crypto.randomUUID(), signal: new AbortController().signal, setCommand: () => {} };
}

async function connectAdapter(): Promise<Adapter> {
  const adapter = createAdapter('postgres', { log: () => {} });
  await adapter.connect(pgFixture().config, makeCtx());
  return adapter;
}

function objectPath(schema: string, kind: NodeKind, name: string): NodePath {
  return {
    connectionId: 'test-pg',
    segments: [
      { kind: 'database', name: 'kira_test' },
      { kind: 'schema', name: schema },
      { kind, name },
    ],
  };
}

test.skipIf(!dockerAvailable)('ddl: view is exact via pg_get_viewdef', async () => {
  const adapter = await connectAdapter();
  const ddl = await adapter.ddl(objectPath('app', 'view', 'customer_names'), makeCtx());
  expect(ddl.objectKind).toBe('view');
  expect(ddl.qualifiedName).toBe('app.customer_names');
  expect(ddl.text).toContain('CREATE OR REPLACE VIEW "app"."customer_names" AS');
  // exact: the view body is pg_get_viewdef output, not reconstructed
  expect(ddl.text).toContain('SELECT');
  expect(ddl.statements[0].label).toContain('CREATE');
  await adapter.disconnect();
});

test.skipIf(!dockerAvailable)('ddl: function is exact via pg_get_functiondef', async () => {
  const adapter = await connectAdapter();
  const ddl = await adapter.ddl(objectPath('app', 'function', 'add'), makeCtx());
  expect(ddl.text).toContain('CREATE OR REPLACE FUNCTION');
  expect(ddl.statements[0].label).toContain('CREATE');
  await adapter.disconnect();
});

test.skipIf(!dockerAvailable)('ddl: a missing function errors E_NOT_FOUND', async () => {
  const adapter = await connectAdapter();
  await expect(
    adapter.ddl(objectPath('app', 'function', 'does_not_exist'), makeCtx()),
  ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  await adapter.disconnect();
});

test.skipIf(!dockerAvailable)('ddl: sequence is reconstructed and CREATE-able', async () => {
  const adapter = await connectAdapter();
  const ddl = await adapter.ddl(objectPath('app', 'sequence', 'order_seq'), makeCtx());
  expect(ddl.text).toContain('CREATE SEQUENCE');
  expect(ddl.text).toContain('INCREMENT BY');
  expect(ddl.text).toContain('MINVALUE');
  expect(ddl.text).toContain('MAXVALUE');
  await adapter.disconnect();
});

test.skipIf(!dockerAvailable)('ddl: table reconstruction contains PK, FK, and indexes, and re-CREATEs', async () => {
  const adapter = await connectAdapter();
  const ddl = await adapter.ddl(objectPath('app', 'table', 'order_items'), makeCtx());
  expect(ddl.text).toContain('CREATE TABLE "app"."order_items"');
  expect(ddl.text).toContain('PRIMARY KEY');
  expect(ddl.text).toContain('REFERENCES');
  expect(ddl.text).toContain('order_items_order_idx');
  expect(ddl.statements[0].label).toBe('CREATE TABLE');

  // Round-trip: the DDL re-CREATEs against a scratch schema. Only the target table's qualified name
  // is rewritten (CREATE/ALTER/index statements all reference `"app"."order_items"`); FK references
  // to OTHER tables (`"app"."customers"` etc.) keep pointing at the originals, which exist.
  const client = new (await import('pg')).Client({
    host: pgFixture().config.host ?? 'localhost',
    port: pgFixture().config.port ?? 5432,
    database: pgFixture().config.database ?? 'kira_test',
    user: pgFixture().config.username ?? 'postgres',
    password: pgFixture().config.password ?? 'kira',
  });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS scratch_ddl CASCADE; CREATE SCHEMA scratch_ddl;');
    await client.query(`SET search_path TO app, public`);
    const recreated = ddl.text
      .replaceAll('"app"."order_items"', '"scratch_ddl"."order_items"')
      // pg_get_indexdef emits the unquoted form for valid lowercase names: `ON app.order_items`.
      .replaceAll('ON app.order_items USING', 'ON scratch_ddl.order_items USING');
    await client.query(recreated);
    const check = await client.query(
      'SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = $1',
      ['scratch_ddl'],
    );
    expect(Number(check.rows[0].n)).toBe(1);
  } finally {
    await client.end();
  }
  await adapter.disconnect();
});

