import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ddlText } from '@shared/domain/ddl';
import type { MutationPlan } from '@shared/domain/mutations';
import type { NodePath } from '@shared/domain/tree';
import { Client } from 'pg';
import type { Adapter, AdapterDeps, OpCtx } from '../../src/engine/adapters/adapter';
import { AdapterError } from '../../src/engine/adapters/errors';
import { postgresCaps } from '../../src/engine/adapters/postgres/caps';
import { type RunningQuery, runQuery } from '../../src/engine/adapters/postgres/query';
import { createAdapter } from '../../src/engine/adapters/registry';
import { cancelOp, runOp, wireScheduler } from '../../src/engine/scheduler/ops';
import { isNull, isTruncated, type TabularPage } from '../../src/shared/protocol/page';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from './support/docker';
import { readTabular } from './support/page';
import { type PgFixture, startPostgres } from './support/postgres';

const CONTAINER_START_TIMEOUT_MS = 180_000;
const BIG_ROWS = 1_000_000;

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

const decoder = new TextDecoder();

function cellAt(page: TabularPage, col: number, row: number): string | null {
  const chunk = page.chunks[col];
  if (isNull(chunk, row)) return null;
  return decoder.decode(chunk.data.subarray(chunk.offsets[row], chunk.offsets[row + 1]));
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
          ddl() {
            throw new Error('not used by this test');
          },
          read() {
            throw new Error('not used by this test');
          },
          count() {
            throw new Error('not used by this test');
          },
          preview() {
            throw new Error('not used by this test');
          },
          mutate() {
            throw new Error('not used by this test');
          },
          execute() {
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

  test('10. read: first page', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
            { kind: 'table', name: 'big_rows' },
          ]),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 100,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.rowCount).toBe(100);
      expect(page.position.hasMore).toBe(true);
      expect(page.columns.map((c) => c.name)).toEqual(['id', 'hash']);
      expect(page.position.strategy).toBe('keyset');
    } finally {
      await adapter.disconnect();
    }
  });

  test('11. read: deep page by offset', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      let loggedCommand = '';
      const ctx: OpCtx = {
        opId: crypto.randomUUID(),
        signal: new AbortController().signal,
        setCommand(text) {
          loggedCommand = text;
        },
      };
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
            { kind: 'table', name: 'big_rows' },
          ]),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 100,
          cursor: { mode: 'offset', offset: 900_000 },
        },
        ctx,
      );
      expect(cellAt(page, 0, 0)).toBe('900001');
      expect(loggedCommand).toContain('OFFSET');
    } finally {
      await adapter.disconnect();
    }
  });

  test('12. read: keyset forward and backward', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: 'kira_test' },
        { kind: 'schema', name: 'app' },
        { kind: 'table', name: 'big_rows' },
      ]);
      const baseReq = {
        path: target,
        projection: null,
        filter: null,
        sort: null,
        pageSize: 100,
      };

      const forwardIds: string[] = [];
      let cursor: { mode: 'offset'; offset: number } | { mode: 'after'; token: string } = {
        mode: 'offset',
        offset: 0,
      };
      let lastPage: TabularPage | undefined;
      for (let i = 0; i < 5; i++) {
        const page = await readTabular(adapter, { ...baseReq, cursor }, makeCtx());
        lastPage = page;
        for (let r = 0; r < page.rowCount; r++) forwardIds.push(cellAt(page, 0, r) ?? '');
        const nextToken = page.position.nextToken;
        if (!nextToken) throw new Error('expected a nextToken on every forward page');
        cursor = { mode: 'after', token: nextToken };
      }
      if (!lastPage) throw new Error('expected at least one page');

      const initialPrevToken = lastPage.position.prevToken;
      if (!initialPrevToken) throw new Error('expected a prevToken on the last forward page');

      // Every page (forward or backward) displays its rows in ascending order (D7's builder
      // reverses a 'before' fetch back into display order) — so walking backward and
      // prepending each newly-visited page's block, starting from the last forward page's own
      // rows, reconstructs the full ascending id sequence directly.
      const backwardIds: string[] = [];
      for (let r = 0; r < lastPage.rowCount; r++) backwardIds.push(cellAt(lastPage, 0, r) ?? '');
      let backCursor: { mode: 'before'; token: string } = {
        mode: 'before',
        token: initialPrevToken,
      };
      for (let i = 0; i < 5; i++) {
        const page = await readTabular(adapter, { ...baseReq, cursor: backCursor }, makeCtx());
        const ids: string[] = [];
        for (let r = 0; r < page.rowCount; r++) ids.push(cellAt(page, 0, r) ?? '');
        backwardIds.unshift(...ids);
        if (!page.position.prevToken) break;
        backCursor = { mode: 'before', token: page.position.prevToken };
      }

      expect(backwardIds).toEqual(forwardIds);
      const seen = new Set(forwardIds);
      expect(seen.size).toBe(forwardIds.length); // no repeats

      // A token from a different filter is rejected (§5c's fingerprint).
      const staleToken = lastPage.position.nextToken;
      if (!staleToken) throw new Error('expected a nextToken on the last forward page');
      await expect(
        readTabular(
          adapter,
          { ...baseReq, filter: 'id > 0', cursor: { mode: 'after', token: staleToken } },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('13. read: no keyset without a tiebreaker', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // order_summary is a view with no unique key of its own.
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
            { kind: 'view', name: 'order_summary' },
          ]),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.position.strategy).toBe('offset');

      // A mixed-direction structured sort on a table that does have a PK falls back too.
      const mixedSortPage = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
            { kind: 'table', name: 'order_items' },
          ]),
          projection: null,
          filter: null,
          sort: {
            kind: 'structured',
            terms: [
              { column: 'order_id', direction: 'asc' },
              { column: 'product_id', direction: 'desc' },
            ],
          },
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(mixedSortPage.position.strategy).toBe('offset');
    } finally {
      await adapter.disconnect();
    }
  });

  test('14. read: projection', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: 'kira_test' },
        { kind: 'schema', name: 'app' },
        { kind: 'table', name: 'order_items' },
      ]);
      const page = await readTabular(
        adapter,
        {
          path: target,
          projection: ['product_id', 'id'],
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      // Ordinal order (id, then product_id), not request order.
      expect(page.columns.map((c) => c.name)).toEqual(['id', 'product_id']);
      expect(page.chunks).toHaveLength(2);

      await expect(
        readTabular(
          adapter,
          {
            path: target,
            projection: ['not_a_real_column'],
            filter: null,
            sort: null,
            pageSize: 10,
            cursor: { mode: 'offset', offset: 0 },
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('15. read: filter and sort', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: 'kira_test' },
        { kind: 'schema', name: 'app' },
        { kind: 'table', name: 'order_items' },
      ]);
      const all = await readTabular(
        adapter,
        {
          path: target,
          projection: null,
          filter: null,
          sort: null,
          pageSize: 100,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      const filtered = await readTabular(
        adapter,
        {
          path: target,
          projection: null,
          filter: 'quantity > 1',
          sort: null,
          pageSize: 100,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(filtered.rowCount).toBeLessThan(all.rowCount);

      try {
        await readTabular(
          adapter,
          {
            path: target,
            projection: null,
            filter: 'this is not valid sql (((',
            sort: null,
            pageSize: 10,
            cursor: { mode: 'offset', offset: 0 },
          },
          makeCtx(),
        );
        throw new Error('expected the read to reject');
      } catch (err) {
        expect((err as { code?: string }).code).toBe('E_QUERY');
        expect((err as Error).message).toContain('syntax error');
      }
    } finally {
      await adapter.disconnect();
    }
  });

  test('16. read: fidelity', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
            { kind: 'table', name: 'nulls_and_unicode' },
          ]),
          projection: ['id', 'label', 'note', 'big_text', 'big_blob'],
          filter: null,
          sort: { kind: 'structured', terms: [{ column: 'id', direction: 'asc' }] },
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );

      const labelChunk = page.chunks[1];
      // Row 0: every nullable column NULL. Row 1: empty strings — distinguishable via isNull.
      expect(isNull(labelChunk, 0)).toBe(true);
      expect(isNull(labelChunk, 1)).toBe(false);
      expect(cellAt(page, 1, 1)).toBe('');

      // Row 2: emoji/CJK/RTL/combining characters, round-tripped byte-exact.
      expect(cellAt(page, 1, 2)).toBe('😀🎉👍 emoji');
      expect(cellAt(page, 2, 2)).toContain('中文测试');
      expect(cellAt(page, 2, 2)).toContain('日本語テスト');
      expect(cellAt(page, 2, 2)).toContain('한국어 테스트');
      expect(cellAt(page, 2, 2)).toContain('العربية');
      expect(cellAt(page, 2, 2)).toContain('עברית');

      // Row 3: the 1 MB text cell is truncated at MAX_CELL_BYTES and reported as such; the
      // bytea column comes back as 0x-prefixed hex, never U+FFFD.
      const bigTextChunk = page.chunks[3];
      expect(isTruncated(bigTextChunk, 3)).toBe(true);
      expect(page.truncatedCells).toBeGreaterThan(0);
      const blobText = cellAt(page, 4, 3);
      expect(blobText).toMatch(/^0x[0-9a-f]+$/);

      // numeric(20,6) comes back as its exact text, not a rounded double — this is the
      // assertion D3 exists for.
      const numericPage = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
            { kind: 'table', name: 'wide_table' },
          ]),
          projection: ['numeric_a'],
          filter: 'id = 1',
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(cellAt(numericPage, 0, 0)).toBe('1.500000');
    } finally {
      await adapter.disconnect();
    }
  });

  test('17. count', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const bigRowsCount = await adapter.count(
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
            { kind: 'table', name: 'big_rows' },
          ]),
          filter: null,
        },
        makeCtx(),
      );
      expect(bigRowsCount.value).toBe(BIG_ROWS);
      expect(bigRowsCount.exact).toBe(true);

      const filteredCount = await adapter.count(
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
            { kind: 'table', name: 'order_items' },
          ]),
          filter: 'quantity > 1',
        },
        makeCtx(),
      );
      expect(filteredCount.value).toBe(2);
    } finally {
      await adapter.disconnect();
    }
  });

  test('18. read cannot write', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    const probeClient = new Client({ connectionString: fixture.uri });
    await probeClient.connect();
    try {
      await probeClient.query('CREATE TABLE IF NOT EXISTS app.app_probe (id int PRIMARY KEY)');
      await probeClient.query('INSERT INTO app.app_probe (id) VALUES (1) ON CONFLICT DO NOTHING');

      await expect(
        readTabular(
          adapter,
          {
            path: path([
              { kind: 'database', name: 'kira_test' },
              { kind: 'schema', name: 'app' },
              { kind: 'table', name: 'order_items' },
            ]),
            projection: null,
            filter: '1=1; DROP TABLE app.app_probe',
            sort: null,
            pageSize: 10,
            cursor: { mode: 'offset', offset: 0 },
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });

      const stillThere = await probeClient.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.tables
         WHERE table_schema = 'app' AND table_name = 'app_probe'`,
      );
      expect(stillThere.rows[0]?.n).toBe('1');
    } finally {
      await probeClient.query('DROP TABLE IF EXISTS app.app_probe');
      await probeClient.end();
      await adapter.disconnect();
    }
  });

  test('19. unsupported kind', () => {
    // P9 gave redis a real adapter — kafka is still unimplemented (P10), so it is the
    // still-unsupported kind this test now targets.
    expect(() => createAdapter('kafka', deps)).toThrow(AdapterError);
    try {
      createAdapter('kafka', deps);
      throw new Error('expected createAdapter to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as AdapterError).code).toBe('E_UNSUPPORTED');
    }
  });

  test('20. ddl', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // 1. Shape.
      const orderItems = await adapter.ddl(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'order_items' },
        ]),
        makeCtx(),
      );
      expect(orderItems.origin).toBe('composed');
      expect(orderItems.kind).toBe('table');
      expect(orderItems.qualifiedName).toBe('app.order_items');
      expect(orderItems.notes.length).toBeGreaterThan(0);
      // The serial id column's backing sequence must be created before the table that
      // references it via an eagerly-resolved `::regclass` cast in its DEFAULT.
      expect(orderItems.statements[0]).toMatch(/^CREATE SEQUENCE app\.order_items_id_seq$/);
      const orderItemsCreateTable = orderItems.statements.find((s) => s.startsWith('CREATE TABLE'));
      expect(orderItemsCreateTable).toMatch(/^CREATE TABLE app\.order_items \(/);

      // 2. Quoting.
      const weird = await adapter.ddl(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'weird"name' },
        ]),
        makeCtx(),
      );
      const weirdCreateTable = weird.statements.find((s) => s.startsWith('CREATE TABLE'));
      expect(weirdCreateTable).toContain('app."weird""name"');

      const orders = await adapter.ddl(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'orders' },
        ]),
        makeCtx(),
      );
      const ordersCreateTable = orders.statements.find((s) => s.startsWith('CREATE TABLE'));
      expect(ordersCreateTable).not.toContain('"app"."orders"');

      // 5. View.
      const orderSummary = await adapter.ddl(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'view', name: 'order_summary' },
        ]),
        makeCtx(),
      );
      expect(orderSummary.statements).toHaveLength(1);
      expect(orderSummary.statements[0]).toMatch(/^CREATE VIEW app\.order_summary AS/);
      expect(orderSummary.statements[0]).toContain('app.orders');
      expect(orderSummary.statements[0]).toContain('app.order_items');
      expect(orderSummary.statements[0].trimEnd().endsWith(';')).toBe(false);

      // 6. Matview.
      const customerTotals = await adapter.ddl(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'matview', name: 'customer_totals' },
        ]),
        makeCtx(),
      );
      expect(customerTotals.statements[0]).toMatch(
        /^CREATE MATERIALIZED VIEW app\.customer_totals AS/,
      );
      expect(customerTotals.notes.some((n) => n.includes('created without data'))).toBe(true);

      // 7. Unsupported and not-found.
      await expect(
        adapter.ddl(
          path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
            { kind: 'sequence', name: 'invoice_number_seq' },
          ]),
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });

      await expect(
        adapter.ddl(
          path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
            { kind: 'function', name: 'full_name' },
          ]),
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });

      await expect(
        adapter.ddl(
          path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
          ]),
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });

      await expect(
        adapter.ddl(
          path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
            { kind: 'table', name: 'does_not_exist' },
          ]),
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });

      // 8. ddlText round trip.
      const doc = ddlText(orderItems);
      const chunks = doc.split('\n\n');
      expect(chunks).toHaveLength(orderItems.statements.length);
      for (const chunk of chunks) {
        expect(chunk.endsWith(';')).toBe(true);
        expect(chunk.endsWith(';;')).toBe(false);
      }
    } finally {
      await adapter.disconnect();
    }

    // 3 & 4. Round trip — executed into a fresh database, described back, and compared against
    // the original. A second database (not a scratch schema) is what keeps the qualified names
    // ddl() emitted valid verbatim, with no string rewriting in the test (D17).
    async function roundTrip(objectName: string): Promise<void> {
      const sourceAdapter = createAdapter('postgres', deps);
      await sourceAdapter.connect(fixture.config, makeCtx());
      let original: Awaited<ReturnType<Adapter['describe']>>;
      let def: Awaited<ReturnType<Adapter['ddl']>>;
      try {
        original = await sourceAdapter.describe(
          path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
            { kind: 'table', name: objectName },
          ]),
          makeCtx(),
        );
        def = await sourceAdapter.ddl(
          path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
            { kind: 'table', name: objectName },
          ]),
          makeCtx(),
        );
      } finally {
        await sourceAdapter.disconnect();
      }

      const admin = new Client({
        host: fixture.config.host ?? undefined,
        port: fixture.config.port ?? undefined,
        user: fixture.config.username ?? undefined,
        password: fixture.config.password ?? undefined,
        database: 'postgres',
      });
      await admin.connect();
      try {
        await admin.query('DROP DATABASE IF EXISTS kira_ddl_roundtrip');
        await admin.query('CREATE DATABASE kira_ddl_roundtrip');
      } finally {
        await admin.end();
      }

      try {
        const roundTripClient = new Client({
          host: fixture.config.host ?? undefined,
          port: fixture.config.port ?? undefined,
          user: fixture.config.username ?? undefined,
          password: fixture.config.password ?? undefined,
          database: 'kira_ddl_roundtrip',
        });
        await roundTripClient.connect();
        try {
          await roundTripClient.query('CREATE SCHEMA app');
          for (const stmt of def.statements) await roundTripClient.query(stmt);
        } finally {
          await roundTripClient.end();
        }

        const copyAdapter = createAdapter('postgres', deps);
        await copyAdapter.connect({ ...fixture.config, database: 'kira_ddl_roundtrip' }, makeCtx());
        let copy: Awaited<ReturnType<Adapter['describe']>>;
        try {
          copy = await copyAdapter.describe(
            path([
              { kind: 'database', name: 'kira_ddl_roundtrip' },
              { kind: 'schema', name: 'app' },
              { kind: 'table', name: objectName },
            ]),
            makeCtx(),
          );
        } finally {
          await copyAdapter.disconnect();
        }

        const shape = (m: Awaited<ReturnType<Adapter['describe']>>) => ({
          columns: m.columns
            .map((c) => ({
              name: c.name,
              dataType: c.dataType,
              nullable: c.nullable,
              defaultExpr: c.defaultExpr,
              isPrimaryKey: c.isPrimaryKey,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          primaryKey: m.primaryKey ? [...m.primaryKey].sort() : null,
          indexes: m.indexes
            .map((i) => ({ name: i.name, columns: i.columns, unique: i.unique }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        });
        expect(shape(copy)).toEqual(shape(original));
      } finally {
        const cleanup = new Client({
          host: fixture.config.host ?? undefined,
          port: fixture.config.port ?? undefined,
          user: fixture.config.username ?? undefined,
          password: fixture.config.password ?? undefined,
          database: 'postgres',
        });
        await cleanup.connect();
        try {
          await cleanup.query('DROP DATABASE IF EXISTS kira_ddl_roundtrip');
        } finally {
          await cleanup.end();
        }
      }
    }

    await roundTrip('wide_table');
    await roundTrip('weird"name');
  });

  // composite_pk has no inbound foreign key (unlike customers/regions/products/orders, which
  // all reference or are referenced by something in the fixture graph) — a clean target for
  // delete/insert without tripping an FK constraint the mutation scenarios aren't testing.
  const compositePkPath = () =>
    path([
      { kind: 'database', name: 'kira_test' },
      { kind: 'schema', name: 'app' },
      { kind: 'table', name: 'composite_pk' },
    ]);

  test('21. preview: exact text, never executes', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const plan: MutationPlan = {
        path: compositePkPath(),
        ops: [
          { kind: 'insert', values: { tenant_id: '3', entity_id: '1', name: 'new tenant' } },
          { kind: 'delete', key: { tenant_id: '2', entity_id: '1' } },
          {
            kind: 'update',
            key: { tenant_id: '1', entity_id: '1' },
            changes: { name: "O'Brien Co" },
          },
        ],
      };
      const statements = adapter.preview(plan);
      expect(statements).toEqual([
        `DELETE FROM "app"."composite_pk" WHERE "tenant_id" = '2' AND "entity_id" = '1'`,
        `UPDATE "app"."composite_pk" SET "name" = 'O''Brien Co' WHERE "tenant_id" = '1' AND "entity_id" = '1'`,
        `INSERT INTO "app"."composite_pk" ("tenant_id", "entity_id", "name") VALUES ('3', '1', 'new tenant')`,
      ]);

      const rows = await readTabular(
        adapter,
        {
          path: compositePkPath(),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(rows.rowCount).toBe(3);
    } finally {
      await adapter.disconnect();
    }
  });

  test('22. mutate: update lands in the op log', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      let loggedCommand = '';
      const ctx: OpCtx = {
        opId: crypto.randomUUID(),
        signal: new AbortController().signal,
        setCommand(text) {
          loggedCommand = text;
        },
      };
      const plan: MutationPlan = {
        path: compositePkPath(),
        ops: [
          {
            kind: 'update',
            key: { tenant_id: '1', entity_id: '1' },
            changes: { name: 'tenant 1 / entity 1 updated' },
          },
        ],
      };
      const result = await adapter.mutate(plan, ctx);
      expect(result.affectedRows).toBe(1);
      expect(loggedCommand).toBe(
        `UPDATE "app"."composite_pk" SET "name" = 'tenant 1 / entity 1 updated' WHERE "tenant_id" = '1' AND "entity_id" = '1'`,
      );

      const rows = await readTabular(
        adapter,
        {
          path: compositePkPath(),
          projection: null,
          filter: '"tenant_id" = 1 AND "entity_id" = 1',
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(
        cellAt(
          rows,
          rows.columns.findIndex((c) => c.name === 'name'),
          0,
        ),
      ).toBe('tenant 1 / entity 1 updated');
    } finally {
      await adapter.disconnect();
    }
  });

  test('23. mutate: unknown column is E_NOT_FOUND', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const plan: MutationPlan = {
        path: compositePkPath(),
        ops: [
          { kind: 'update', key: { tenant_id: '1', entity_id: '1' }, changes: { bogus_col: 'z' } },
        ],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('24. mutate: read-only connection is E_UNSUPPORTED', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect({ ...fixture.config, readOnly: true }, makeCtx());
    try {
      const plan: MutationPlan = {
        path: compositePkPath(),
        ops: [
          {
            kind: 'update',
            key: { tenant_id: '1', entity_id: '1' },
            changes: { name: 'should not land' },
          },
        ],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });
    } finally {
      await adapter.disconnect();
    }
  });

  test('25. mutate: a row-count conflict rolls back the whole batch', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const plan: MutationPlan = {
        path: compositePkPath(),
        ops: [
          { kind: 'delete', key: { tenant_id: '2', entity_id: '1' } },
          { kind: 'update', key: { tenant_id: '9', entity_id: '9' }, changes: { name: 'nope' } },
        ],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({ code: 'E_QUERY' });

      const rows = await readTabular(
        adapter,
        {
          path: compositePkPath(),
          projection: null,
          filter: '"tenant_id" = 2 AND "entity_id" = 1',
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      // The delete that ran before the failing update must have been rolled back too.
      expect(rows.rowCount).toBe(1);
    } finally {
      await adapter.disconnect();
    }
  });

  test('26. mutate: delete + update + insert, one transaction', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      let loggedCommand = '';
      const ctx: OpCtx = {
        opId: crypto.randomUUID(),
        signal: new AbortController().signal,
        setCommand(text) {
          loggedCommand = text;
        },
      };
      const plan: MutationPlan = {
        path: compositePkPath(),
        ops: [
          {
            kind: 'insert',
            values: { tenant_id: '3', entity_id: '1', name: 'tenant 3 / entity 1' },
          },
          { kind: 'delete', key: { tenant_id: '2', entity_id: '1' } },
          {
            kind: 'update',
            key: { tenant_id: '1', entity_id: '1' },
            changes: { name: 'tenant 1 / entity 1 final' },
          },
        ],
      };
      const result = await adapter.mutate(plan, ctx);
      expect(result.affectedRows).toBe(3);
      expect(loggedCommand).toBe(
        [
          `DELETE FROM "app"."composite_pk" WHERE "tenant_id" = '2' AND "entity_id" = '1'`,
          `UPDATE "app"."composite_pk" SET "name" = 'tenant 1 / entity 1 final' WHERE "tenant_id" = '1' AND "entity_id" = '1'`,
          `INSERT INTO "app"."composite_pk" ("tenant_id", "entity_id", "name") VALUES ('3', '1', 'tenant 3 / entity 1')`,
        ].join(';\n'),
      );

      const rows = await readTabular(
        adapter,
        {
          path: compositePkPath(),
          projection: null,
          filter: null,
          sort: {
            kind: 'structured',
            terms: [
              { column: 'tenant_id', direction: 'asc' },
              { column: 'entity_id', direction: 'asc' },
            ],
          },
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(rows.rowCount).toBe(3);
      const nameCol = rows.columns.findIndex((c) => c.name === 'name');
      expect(cellAt(rows, nameCol, 0)).toBe('tenant 1 / entity 1 final');
      expect(cellAt(rows, nameCol, 2)).toBe('tenant 3 / entity 1');
    } finally {
      await adapter.disconnect();
    }
  });

  test('27. mutate: no primary key is E_UNSUPPORTED', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    const probeClient = new Client({ connectionString: fixture.uri });
    await probeClient.connect();
    try {
      await probeClient.query('CREATE TABLE IF NOT EXISTS app.no_pk_probe (col text)');

      const plan: MutationPlan = {
        path: path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'no_pk_probe' },
        ]),
        ops: [{ kind: 'update', key: { col: 'x' }, changes: { col: 'y' } }],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });
    } finally {
      await probeClient.query('DROP TABLE IF EXISTS app.no_pk_probe');
      await probeClient.end();
      await adapter.disconnect();
    }
  });

  test('28. execute: one page per statement, including a non-row-returning one', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    const probeClient = new Client({ connectionString: fixture.uri });
    await probeClient.connect();
    try {
      await probeClient.query(
        'CREATE TABLE IF NOT EXISTS app.console_probe (id int primary key, name text)',
      );
      await probeClient.query(`INSERT INTO app.console_probe (id, name) VALUES (1, 'row 1')`);

      let loggedCommand = '';
      const ctx: OpCtx = {
        opId: crypto.randomUUID(),
        signal: new AbortController().signal,
        setCommand(text) {
          loggedCommand = text;
        },
      };
      const statements = [
        'SELECT id, name FROM app.console_probe ORDER BY id',
        `INSERT INTO app.console_probe (id, name) VALUES (2, 'row 2')`,
      ];
      const pages = await adapter.execute(
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'schema', name: 'app' },
          ]),
          statements,
        },
        ctx,
      );

      // One op-log row for the whole batch (P5 D9's precedent), not one per statement.
      expect(loggedCommand).toBe(statements.join(';\n'));

      expect(pages).toHaveLength(2);
      const [page0, page1] = pages;
      if (page0.kind !== 'tabular' || page1.kind !== 'tabular') {
        throw new Error('expected tabular console pages');
      }
      expect(page0.rowCount).toBe(1);
      const nameCol = page0.columns.findIndex((c) => c.name === 'name');
      expect(cellAt(page0, nameCol, 0)).toBe('row 1');

      // A non-row-returning statement synthesizes a single-column/single-row status page —
      // an approximation of Postgres's own command-complete tag (console.ts's documented scope).
      expect(page1.columns).toEqual([
        {
          name: 'status',
          dataType: 'text',
          typeClass: 'text',
          nullable: false,
          isPrimaryKey: false,
        },
      ]);
      expect(page1.rowCount).toBe(1);
      expect(cellAt(page1, 0, 0)).toBe('INSERT 1');
    } finally {
      await probeClient.query('DROP TABLE IF EXISTS app.console_probe');
      await probeClient.end();
      await adapter.disconnect();
    }
  });

  test('29. execute: a failing statement rejects the whole call — earlier statements already landed', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    const probeClient = new Client({ connectionString: fixture.uri });
    await probeClient.connect();
    try {
      await probeClient.query(
        'CREATE TABLE IF NOT EXISTS app.console_probe (id int primary key, name text)',
      );

      // execute() is one op-log row and one success/failure outcome per call (all-or-nothing at
      // the call level), never a per-statement transaction — a statement that already committed
      // before the failure stays committed, same as running each one by hand in psql.
      await expect(
        adapter.execute(
          {
            path: path([
              { kind: 'database', name: 'kira_test' },
              { kind: 'schema', name: 'app' },
            ]),
            statements: [
              `INSERT INTO app.console_probe (id, name) VALUES (3, 'landed before the failure')`,
              'SELECT * FROM app.does_not_exist',
            ],
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });

      const rows = await probeClient.query('SELECT name FROM app.console_probe WHERE id = 3');
      expect(rows.rows[0]?.name).toBe('landed before the failure');
    } finally {
      await probeClient.query('DROP TABLE IF EXISTS app.console_probe');
      await probeClient.end();
      await adapter.disconnect();
    }
  });

  test('30. execute: an already-cancelled signal rejects before running anything', async () => {
    const adapter = createAdapter('postgres', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const controller = new AbortController();
      controller.abort();
      const ctx: OpCtx = { opId: crypto.randomUUID(), signal: controller.signal, setCommand() {} };
      await expect(
        adapter.execute(
          { path: path([{ kind: 'database', name: 'kira_test' }]), statements: ['SELECT 1'] },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'E_CANCELLED' });
    } finally {
      await adapter.disconnect();
    }
  });
});
