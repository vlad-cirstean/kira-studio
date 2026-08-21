import { Client, type ClientConfig } from 'pg';
import type { Adapter, OpCtx } from '../../src/engine/adapters/adapter';
import { AdapterError } from '../../src/engine/adapters/errors';
import { postgresCaps } from '../../src/engine/adapters/postgres/caps';
import { buildClientConfig, cancelBackend } from '../../src/engine/adapters/postgres/client';
import { runQuery } from '../../src/engine/adapters/postgres/query';
import { createAdapter } from '../../src/engine/adapters/registry';
import { abortOp, runOp } from '../../src/engine/ops';
import { encodePath } from '../../src/shared/tree';
import { isDockerAvailable } from './support/docker';
import { afterAll, expect, test } from './support/harness';
import { type PgFixture, startPostgres } from './support/postgres';

// P1 §9.1 scenarios, restricted to what P1 implements. Each adapter call goes straight through the
// adapter (no main/engine process), which is what D21 (adapters import nothing from electron)
// exists to allow.

const dockerAvailable = await isDockerAvailable();

let pg: PgFixture | null = null;

if (dockerAvailable) {
  pg = await startPostgres();
}

afterAll(async () => {
  await pg?.stop();
});

function noopDeps(): { log: () => void } {
  return { log: () => {} };
}

// All container-backed tests are skipIf(!dockerAvailable), so pg is set whenever they run; this
// makes that guarantee explicit instead of scattering non-null assertions.
function pgFixture(): PgFixture {
  if (!pg) throw new Error('postgres fixture not started');
  return pg;
}

function must<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

function makeCtx(): OpCtx {
  return { opId: crypto.randomUUID(), signal: new AbortController().signal, setCommand: () => {} };
}

async function connectAdapter(): Promise<Adapter> {
  const adapter = createAdapter('postgres', noopDeps());
  await adapter.connect(pgFixture().config, makeCtx());
  return adapter;
}

function dbPath(name: string): {
  connectionId: string;
  segments: { kind: 'database'; name: string }[];
} {
  return { connectionId: 'test-pg', segments: [{ kind: 'database', name }] };
}

function tablePath(schema: string, table: string) {
  return {
    connectionId: 'test-pg',
    segments: [
      { kind: 'database' as const, name: 'kira_test' },
      { kind: 'schema' as const, name: schema },
      { kind: 'table' as const, name: table },
    ],
  };
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('waitFor timed out');
}

test.skipIf(!dockerAvailable)(
  '1. connect returns PostgreSQL 17 and disconnect closes every backend',
  async () => {
    const adapter = createAdapter('postgres', noopDeps());
    const info = await adapter.connect(pgFixture().config, makeCtx());
    expect(info.serverVersion).toMatch(/^PostgreSQL 17/);

    const side = new Client({
      host: pgFixture().config.host ?? undefined,
      port: pgFixture().config.port ?? undefined,
      database: 'kira_test',
      user: 'postgres',
      password: 'kira',
    });
    await side.connect();
    const before = await side.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'kira-studio'",
    );
    expect(before.rows[0].n).toBeGreaterThan(0);

    await adapter.disconnect();

    const after = await side.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'kira-studio'",
    );
    await side.end();
    expect(after.rows[0].n).toBe(0);
  },
);

test.skipIf(!dockerAvailable)('2. auth failure yields E_AUTH with the server message', async () => {
  const adapter = createAdapter('postgres', noopDeps());
  const bad = { ...pgFixture().config, password: 'definitely-wrong' };
  let code: string | undefined;
  try {
    await adapter.connect(bad, makeCtx());
  } catch (err) {
    expect(err).toBeInstanceOf(AdapterError);
    code = (err as AdapterError).code;
    expect((err as AdapterError).message).toMatch(/password authentication failed/);
  }
  expect(code).toBe('E_AUTH');
});

test.skipIf(!dockerAvailable)(
  '3. tree enumerates databases, schemas (no system), relations, 60 columns',
  async () => {
    const adapter = await connectAdapter();

    const root = await adapter.children({ connectionId: 'test-pg', segments: [] }, makeCtx());
    const rootNames = root.map((n) => n.name);
    expect(rootNames).toContain('kira_test');
    expect(rootNames).toContain('postgres');

    const dbs = await adapter.children(dbPath('kira_test'), makeCtx());
    const schemaNames = dbs.map((n) => n.name);
    expect(schemaNames).toContain('app');
    expect(schemaNames).toContain('analytics');
    expect(schemaNames).not.toContain('pg_catalog');
    expect(schemaNames).not.toContain('information_schema');

    const appChildren = await adapter.children(
      {
        connectionId: 'test-pg',
        segments: [
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
        ],
      },
      makeCtx(),
    );
    const kindByName = new Map(appChildren.map((n) => [n.name, n.kind]));
    expect(kindByName.get('wide_table')).toBe('table');
    expect(kindByName.get('customer_names')).toBe('view');
    expect(kindByName.get('region_stats')).toBe('matview');
    expect(kindByName.get('order_seq')).toBe('sequence');
    expect(kindByName.get('add')).toBe('function');
    expect(kindByName.get('touch_table')).toBe('function');

    const cols = await adapter.children(tablePath('app', 'wide_table'), makeCtx());
    expect(cols).toHaveLength(60);
    await adapter.disconnect();
  },
);

test.skipIf(!dockerAvailable)('4. quoted identifiers round-trip exactly', async () => {
  const adapter = await connectAdapter();

  const appChildren = await adapter.children(
    {
      connectionId: 'test-pg',
      segments: [
        { kind: 'database', name: 'kira_test' },
        { kind: 'schema', name: 'app' },
      ],
    },
    makeCtx(),
  );
  expect(appChildren.map((n) => n.name)).toContain('weird"name');
  expect(appChildren.map((n) => n.name)).toContain('Order Items');

  const weirdCols = await adapter.children(tablePath('app', 'weird"name'), makeCtx());
  expect(weirdCols.map((c) => c.name)).toContain('col one');

  const oiCols = await adapter.children(tablePath('app', 'Order Items'), makeCtx());
  expect(oiCols.map((c) => c.name)).toContain('item_name');
  await adapter.disconnect();
});

test.skipIf(!dockerAvailable)(
  '5. describe resolves columns, PK, indexes, outbound and inbound FKs',
  async () => {
    const adapter = await connectAdapter();

    const meta = await adapter.describe(tablePath('app', 'order_items'), makeCtx());
    expect(meta.primaryKey).toEqual(['id']);
    expect(meta.columns.map((c) => c.name)).toEqual(['id', 'order_id', 'product_id', 'qty']);
    expect(meta.foreignKeys).toHaveLength(2);

    const fkOrders = meta.foreignKeys.find((f) => f.referencedPath.endsWith('table:orders'));
    expect(fkOrders).toBeDefined();
    expect(must(fkOrders, 'orders FK missing').columns).toEqual(['order_id']);
    expect(must(fkOrders, 'orders FK missing').referencedColumns).toEqual(['id']);
    expect(must(fkOrders, 'orders FK missing').referencedPath).toBe(
      encodePath([
        { kind: 'database', name: 'kira_test' },
        { kind: 'schema', name: 'app' },
        { kind: 'table', name: 'orders' },
      ]),
    );

    expect(meta.indexes).toHaveLength(2);
    expect(meta.indexes.some((i) => i.primary)).toBe(true);
    expect(meta.indexes.some((i) => i.name === 'order_items_order_idx')).toBe(true);

    const empMeta = await adapter.describe(tablePath('app', 'employees'), makeCtx());
    expect(empMeta.referencedBy).toHaveLength(1);
    expect(empMeta.referencedBy[0].referencedPath).toContain('employees');
    await adapter.disconnect();
  },
);

test.skipIf(!dockerAvailable)(
  '6. row estimate present for analyzed table, absent otherwise',
  async () => {
    const adapter = await connectAdapter();
    const appChildren = await adapter.children(
      {
        connectionId: 'test-pg',
        segments: [
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
        ],
      },
      makeCtx(),
    );
    const bigRows = appChildren.find((n) => n.name === 'big_rows');
    expect(bigRows?.detail).toContain('1000000');

    const customers = appChildren.find((n) => n.name === 'customers');
    expect(customers?.detail).toBeUndefined();
    await adapter.disconnect();
  },
);

test.skipIf(!dockerAvailable)('7. cancel is asserted server-side (pg_cancel_backend)', async () => {
  const cfg = pgFixture().config;
  const mk = (): ClientConfig => ({
    host: cfg.host ?? undefined,
    port: cfg.port ?? undefined,
    database: 'kira_test',
    user: 'postgres',
    password: 'kira',
  });
  const client = new Client(mk());
  await client.connect();

  const side = new Client(mk());
  await side.connect();

  // Exclude the monitoring query itself (its text contains "pg_sleep") and filter to active
  // backends — PostgreSQL ≥14 keeps the last query text on idle backends, so a raw query-text
  // check would never see the cancelled pg_sleep "gone".
  const SLEEP_ROWS =
    "SELECT pid FROM pg_stat_activity WHERE state = 'active' AND query LIKE '%pg_sleep%' AND query NOT LIKE '%pg_stat_activity%'";
  const SLEEP_GONE =
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'active' AND query LIKE '%pg_sleep%' AND query NOT LIKE '%pg_stat_activity%'";

  let capturedOpId: string | null = null;
  let markStarted: () => void = () => {};
  const started = new Promise<void>((r) => {
    markStarted = r;
  });

  const opPromise = runOp({ connectionId: 'test-pg', kind: 'children' }, async (ctx) => {
    capturedOpId = ctx.opId;
    markStarted();
    return runQuery(client, 'SELECT pg_sleep(30)', [], ctx, () => {});
  });

  await started;
  expect(capturedOpId).not.toBeNull();

  // Track the rejection by hand — bun's expect().rejects blocks while the promise is pending, and
  // attaching a plain .then up front also guarantees the rejection is never unhandled.
  const outcome = { settled: false, code: null as string | null };
  opPromise.then(
    () => {
      outcome.settled = true;
    },
    (err) => {
      outcome.settled = true;
      outcome.code = (err as { code?: string })?.code ?? null;
    },
  );

  await waitFor(async () => (await side.query(SLEEP_ROWS)).rows.length > 0);
  const target = await side.query(SLEEP_ROWS);
  const backendPid = target.rows[0].pid as number;

  const aborted = abortOp(must<string>(capturedOpId, 'op id not captured'));
  expect(aborted).not.toBeNull();
  const cancelled = await cancelBackend(buildClientConfig(cfg), backendPid);
  expect(cancelled).toBe(true);

  await waitFor(async () => outcome.settled);
  expect(outcome.code).toBe('E_CANCELLED');

  await waitFor(async () => {
    const r = await side.query(SLEEP_GONE);
    return r.rows[0].n === 0;
  }, 2000);

  await side.end();
  await client.end();
});

test.skipIf(!dockerAvailable)('8. caps advertise cancel truthfully', () => {
  expect(postgresCaps.cancel).toBe(true);
});

test.skipIf(!dockerAvailable)(
  '9. children of a leaf sequence returns [] and does not throw',
  async () => {
    const adapter = await connectAdapter();
    const result = await adapter.children(
      {
        connectionId: 'test-pg',
        segments: [
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'sequence', name: 'order_seq' },
        ],
      },
      makeCtx(),
    );
    expect(result).toEqual([]);
    await adapter.disconnect();
  },
);

test('10. unsupported kind throws E_UNSUPPORTED', () => {
  let code: string | undefined;
  try {
    createAdapter('mongodb', noopDeps());
  } catch (err) {
    code = (err as AdapterError).code;
  }
  expect(code).toBe('E_UNSUPPORTED');
});
