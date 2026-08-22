import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { NodePath } from '@shared/domain/tree';
import { Client } from 'pg';
import type { Adapter, AdapterDeps, OpCtx } from '../../src/engine/adapters/adapter';
import { AdapterError } from '../../src/engine/adapters/errors';
import { postgresCaps } from '../../src/engine/adapters/postgres/caps';
import { type RunningQuery, runQuery } from '../../src/engine/adapters/postgres/query';
import { createAdapter } from '../../src/engine/adapters/registry';
import { cancelOp, runOp, wireScheduler } from '../../src/engine/scheduler/ops';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from './support/docker';
import { type PgFixture, startPostgres } from './support/postgres';

const CONTAINER_START_TIMEOUT_MS = 180_000;

const deps: AdapterDeps = {
  log(level, message) {
    if (level === 'error') console.error(`[postgres adapter] ${message}`);
  },
};

function makeCtx(): OpCtx {
  return {
    opId: crypto.randomUUID(),
    signal: new AbortController().signal,
    setCommand() {},
  };
}

function path(segments: NodePath['segments']): NodePath {
  return { connectionId: 'test-postgres', segments };
}

async function waitUntil(
  check: () => Promise<boolean>,
  { timeoutMs = 5000, intervalMs = 50 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('waitUntil: condition never became true');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

let fixture: PgFixture;

beforeAll(async () => {
  if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
  fixture = await startPostgres();
}, CONTAINER_START_TIMEOUT_MS);

afterAll(async () => {
  await fixture?.stop();
});

describe('postgres adapter (§9.1)', () => {
  test('1. connect / disconnect', async () => {
    const adapter = createAdapter('postgres', deps);
    const info = await adapter.connect(fixture.config, makeCtx());
    expect(info.serverVersion).toMatch(/^PostgreSQL 17/);

    await adapter.disconnect();

    const side = new Client({ connectionString: fixture.uri });
    await side.connect();
    try {
      const result = await side.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_stat_activity WHERE application_name = 'kira-studio'`,
      );
      expect(result.rows[0]?.n).toBe('0');
    } finally {
      await side.end();
    }
  });

  test('2. auth failure', async () => {
    const adapter = createAdapter('postgres', deps);
    const badConfig = { ...fixture.config, password: 'definitely-wrong' };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({
      code: 'E_AUTH',
    });
  });

  test('3. tree enumeration', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const roots = await adapter.children(path([]), makeCtx());
      const rootNames = roots.map((n) => n.name).sort();
      expect(rootNames).toEqual(['kira_test', 'postgres']);

      const schemas = await adapter.children(
        path([{ kind: 'database', name: 'kira_test' }]),
        makeCtx(),
      );
      const schemaNames = schemas.map((n) => n.name).sort();
      expect(schemaNames).toEqual(['analytics', 'app']);
      expect(schemaNames).not.toContain('pg_catalog');
      expect(schemaNames).not.toContain('information_schema');

      const appChildren = await adapter.children(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
        ]),
        makeCtx(),
      );
      const byKind = (kind: string) =>
        appChildren.filter((n) => n.kind === kind).map((n) => n.name);
      expect(byKind('table')).toContain('wide_table');
      expect(byKind('view')).toEqual(['order_summary']);
      expect(byKind('matview')).toEqual(['customer_totals']);
      expect(byKind('sequence')).toContain('invoice_number_seq');
      expect(byKind('function').sort()).toEqual(['full_name', 'noop_procedure']);

      const columns = await adapter.children(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'wide_table' },
        ]),
        makeCtx(),
      );
      expect(columns).toHaveLength(60);
      expect(columns[0]?.name).toBe('id');
      expect(columns[1]?.name).toBe('int_a');
    } finally {
      await adapter.disconnect();
    }
  });

  test('4. quoting', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const appChildren = await adapter.children(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
        ]),
        makeCtx(),
      );
      const names = appChildren.map((n) => n.name);
      expect(names).toContain('weird"name');
      expect(names).toContain('Order Items');

      const weirdColumns = await adapter.children(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'weird"name' },
        ]),
        makeCtx(),
      );
      expect(weirdColumns.map((c) => c.name).sort()).toEqual(['id', 'value']);

      const spacedColumns = await adapter.children(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'Order Items' },
        ]),
        makeCtx(),
      );
      expect(spacedColumns.map((c) => c.name).sort()).toEqual(['id', 'note']);
    } finally {
      await adapter.disconnect();
    }
  });

  test('5. describe', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const orderItems = await adapter.describe(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'order_items' },
        ]),
        makeCtx(),
      );
      expect(orderItems.primaryKey).toEqual(['id']);
      const quantity = orderItems.columns.find((c) => c.name === 'quantity');
      expect(quantity).toMatchObject({ dataType: 'integer', nullable: false, defaultExpr: '1' });
      expect(orderItems.indexes).toHaveLength(2);
      const pkIndex = orderItems.indexes.find((i) => i.primary);
      expect(pkIndex).toMatchObject({ unique: true, primary: true, columns: ['id'] });
      const uniqueIndex = orderItems.indexes.find((i) => !i.primary);
      expect(uniqueIndex).toMatchObject({
        unique: true,
        primary: false,
        columns: ['order_id', 'product_id'],
      });
      expect(orderItems.foreignKeys).toHaveLength(2);
      const orderFk = orderItems.foreignKeys.find((fk) => fk.columns.includes('order_id'));
      expect(orderFk?.referencedColumns).toEqual(['id']);
      expect(orderFk?.referencedPath).toContain('table:orders');
      const productFk = orderItems.foreignKeys.find((fk) => fk.columns.includes('product_id'));
      expect(productFk?.referencedPath).toContain('table:products');

      const employees = await adapter.describe(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'employees' },
        ]),
        makeCtx(),
      );
      expect(employees.referencedBy).toHaveLength(1);
      expect(employees.referencedBy[0]?.referencedPath).toContain('table:employees');
    } finally {
      await adapter.disconnect();
    }
  });

  test('6. row estimate', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const appChildren = await adapter.children(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
        ]),
        makeCtx(),
      );
      const bigRows = appChildren.find((n) => n.name === 'big_rows');
      expect(bigRows?.detail).toMatch(/^~[\d,]+ rows$/);

      const bigRowsMeta = await adapter.describe(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'big_rows' },
        ]),
        makeCtx(),
      );
      expect(bigRowsMeta.rowEstimate).not.toBeNull();
      expect(bigRowsMeta.rowEstimate ?? 0).toBeGreaterThan(900_000);
      expect(bigRowsMeta.rowEstimate ?? 0).toBeLessThan(1_100_000);

      // Never analysed — must surface as null, never the raw -1 Postgres stores.
      const compositePk = appChildren.find((n) => n.name === 'composite_pk');
      expect(compositePk?.detail).toBeUndefined();
      const compositePkMeta = await adapter.describe(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'composite_pk' },
        ]),
        makeCtx(),
      );
      expect(compositePkMeta.rowEstimate).toBeNull();
    } finally {
      await adapter.disconnect();
    }
  });

  test('7. cancel, asserted server-side', async () => {
    const client = new Client({ connectionString: fixture.uri });
    await client.connect();
    const side = new Client({ connectionString: fixture.uri });
    await side.connect();
    try {
      let tracked: RunningQuery | undefined;
      wireScheduler({
        emit: () => {},
        getAdapter: (): Adapter => ({
          kind: 'postgres',
          caps: postgresCaps,
          connect() {
            throw new Error('not used by this test');
          },
          disconnect: () => Promise.resolve(),
          children: () => Promise.resolve([]),
          describe() {
            throw new Error('not used by this test');
          },
          async cancel() {
            if (!tracked) return false;
            const cancelClient = new Client({ connectionString: fixture.uri });
            await cancelClient.connect();
            try {
              const result = await cancelClient.query<{ ok: boolean }>(
                'SELECT pg_cancel_backend($1) AS ok',
                [tracked.backendPid],
              );
              return result.rows[0]?.ok ?? false;
            } finally {
              await cancelClient.end();
            }
          },
        }),
      });

      let capturedOpId: string | undefined;
      const opPromise = runOp({ connectionId: 'cancel-test', kind: 'children' }, (ctx) => {
        capturedOpId = ctx.opId;
        return runQuery(client, 'SELECT pg_sleep(30)', [], ctx, (q) => {
          tracked = q;
        });
      });
      // opPromise is asserted with `.rejects` further down, but that attaches its handler only
      // after the waitUntil/cancelOp calls below — several ticks after the cancellation actually
      // rejects it. Node/Bun flag that gap as an unhandled rejection; this no-op catch marks the
      // promise handled immediately without affecting the real assertion.
      opPromise.catch(() => {});

      await waitUntil(async () => {
        const result = await side.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_stat_activity
           WHERE state = 'active' AND query LIKE '%pg_sleep%' AND query NOT LIKE '%pg_stat_activity%'`,
        );
        return result.rows[0]?.n !== '0';
      });

      expect(capturedOpId).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: asserted above
      const cancelled = await cancelOp(capturedOpId!);
      expect(cancelled).toBe(true);

      await expect(opPromise).rejects.toMatchObject({ code: 'E_CANCELLED' });

      await waitUntil(
        async () => {
          const result = await side.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM pg_stat_activity
           WHERE state = 'active' AND query LIKE '%pg_sleep%' AND query NOT LIKE '%pg_stat_activity%'`,
          );
          return result.rows[0]?.n === '0';
        },
        { timeoutMs: 2000 },
      );
    } finally {
      await client.end();
      await side.end();
    }
  });

  test('8. cap honesty', () => {
    expect(postgresCaps.cancel).toBe(true);
  });

  test('9. children of a leaf', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const children = await adapter.children(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'sequence', name: 'invoice_number_seq' },
        ]),
        makeCtx(),
      );
      expect(children).toEqual([]);
    } finally {
      await adapter.disconnect();
    }
  });

  test('10. unsupported kind', () => {
    expect(() => createAdapter('mongodb', deps)).toThrow(AdapterError);
    try {
      createAdapter('mongodb', deps);
      throw new Error('expected createAdapter to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as AdapterError).code).toBe('E_UNSUPPORTED');
    }
  });
});
