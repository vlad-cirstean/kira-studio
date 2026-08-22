import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { MutationPlan } from '@shared/domain/mutations';
import type { NodePath } from '@shared/domain/tree';
import { createConnection } from 'mariadb';
import type { Adapter, AdapterDeps, OpCtx } from '../../src/engine/adapters/adapter';
import { mariadbCaps } from '../../src/engine/adapters/mariadb/caps';
import { type RunningQuery, runQuery } from '../../src/engine/adapters/mariadb/query';
import { createAdapter } from '../../src/engine/adapters/registry';
import { cancelOp, runOp, wireScheduler } from '../../src/engine/scheduler/ops';
import { isNull, isTruncated, type TabularPage } from '../../src/shared/protocol/page';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from './support/docker';
import { type MariaFixture, startMariadb } from './support/mariadb';

const CONTAINER_START_TIMEOUT_MS = 180_000;
const BIG_ROWS = 1_000_000;

const deps: AdapterDeps = {
  log(level, message) {
    if (level === 'error') console.error(`[mariadb adapter] ${message}`);
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
  return { connectionId: 'test-mariadb', segments };
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

let fixture: MariaFixture;

beforeAll(async () => {
  if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
  fixture = await startMariadb();
}, CONTAINER_START_TIMEOUT_MS);

afterAll(async () => {
  await fixture?.stop();
});

describe('mariadb adapter (§9.1)', () => {
  test('1. connect / disconnect', async () => {
    const adapter = createAdapter('mariadb', deps);
    const info = await adapter.connect(fixture.config, makeCtx());
    expect(info.serverVersion).toMatch(/^MariaDB 11\./);

    await adapter.disconnect();

    const side = await createConnection({
      host: fixture.config.host ?? undefined,
      port: fixture.config.port ?? undefined,
      user: 'root',
      password: 'kira',
    });
    try {
      // PROCESSLIST carries no program-name column; the connect attribute we set
      // (client.ts's `connectAttributes: { program_name: 'kira-studio' }`) lives in
      // performance_schema.session_connect_attrs instead (not information_schema — that schema
      // has no such table). The table name is genuinely lowercase on disk (lower_case_table_names
      // defaults to 0 on Linux, making lookups case-sensitive) — it disappears once the
      // connection that set it ends.
      const rows = await side.query<{ n: bigint | number }[]>(
        `SELECT count(*) AS n FROM performance_schema.session_connect_attrs
         WHERE ATTR_NAME = 'program_name' AND ATTR_VALUE = 'kira-studio'`,
      );
      expect(Number(rows[0]?.n ?? 0)).toBe(0);
    } finally {
      await side.end();
    }
  });

  test('2. auth failure', async () => {
    const adapter = createAdapter('mariadb', deps);
    const badConfig = { ...fixture.config, password: 'definitely-wrong' };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({
      code: 'E_AUTH',
    });
  });

  test('3. tree enumeration', async () => {
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const roots = await adapter.children(path([]), makeCtx());
      const rootNames = roots.map((n) => n.name).sort();
      expect(rootNames).toEqual(['kira_analytics', 'kira_test']);
      expect(rootNames).not.toContain('mysql');
      expect(rootNames).not.toContain('information_schema');
      expect(rootNames).not.toContain('performance_schema');
      expect(rootNames).not.toContain('sys');

      const dbChildren = await adapter.children(
        path([{ kind: 'database', name: 'kira_test' }]),
        makeCtx(),
      );
      const byKind = (kind: string) => dbChildren.filter((n) => n.kind === kind).map((n) => n.name);
      expect(byKind('table')).toContain('wide_table');
      expect(byKind('view')).toEqual(['order_summary']);
      expect(byKind('matview')).toEqual([]);
      expect(byKind('sequence')).toContain('invoice_number_seq');
      expect(byKind('function').sort()).toEqual(['full_name', 'noop_procedure']);

      // No schema level — depth 2, not 3. The encoded path is asserted explicitly, because
      // that is the abstraction claim this adapter exists to test (§6d).
      const wideTable = dbChildren.find((n) => n.name === 'wide_table');
      expect(wideTable?.path).toBe('database:kira_test/table:wide_table');

      const columns = await adapter.children(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'table', name: 'wide_table' },
        ]),
        makeCtx(),
      );
      // 59, not the Postgres fixture's 60 — MariaDB has no equivalent of Postgres's array,
      // inet, and interval types, so wide_table has 3 fewer columns here.
      expect(columns).toHaveLength(59);
      expect(columns[0]?.name).toBe('id');
      expect(columns[0]?.path).toBe('database:kira_test/table:wide_table/column:id');
      expect(columns[1]?.name).toBe('int_a');
    } finally {
      await adapter.disconnect();
    }
  });

  test('4. quoting', async () => {
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const dbChildren = await adapter.children(
        path([{ kind: 'database', name: 'kira_test' }]),
        makeCtx(),
      );
      const names = dbChildren.map((n) => n.name);
      expect(names).toContain('weird`name');
      expect(names).toContain('Order Items');

      const weirdColumns = await adapter.children(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'table', name: 'weird`name' },
        ]),
        makeCtx(),
      );
      expect(weirdColumns.map((c) => c.name).sort()).toEqual(['id', 'value']);

      const spacedColumns = await adapter.children(
        path([
          { kind: 'database', name: 'kira_test' },
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
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const orderItems = await adapter.describe(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'table', name: 'order_items' },
        ]),
        makeCtx(),
      );
      expect(orderItems.primaryKey).toEqual(['id']);
      const quantity = orderItems.columns.find((c) => c.name === 'quantity');
      expect(quantity).toMatchObject({ nullable: false, defaultExpr: '1' });
      expect(quantity?.dataType).toMatch(/^int/);
      // 3, not 2 — InnoDB auto-creates a supporting index for a foreign-key column that isn't
      // already the leftmost column of some other index. order_id is (it leads
      // order_items_order_product_idx), but product_id is only the composite index's second
      // column, so InnoDB adds a third, non-unique index on product_id alone.
      expect(orderItems.indexes).toHaveLength(3);
      const pkIndex = orderItems.indexes.find((i) => i.primary);
      expect(pkIndex).toMatchObject({ unique: true, primary: true, columns: ['id'] });
      const uniqueIndex = orderItems.indexes.find((i) => i.unique && !i.primary);
      expect(uniqueIndex).toMatchObject({
        unique: true,
        primary: false,
        columns: ['order_id', 'product_id'],
      });
      const fkSupportIndex = orderItems.indexes.find((i) => !i.unique);
      expect(fkSupportIndex).toMatchObject({
        unique: false,
        primary: false,
        columns: ['product_id'],
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
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const dbChildren = await adapter.children(
        path([{ kind: 'database', name: 'kira_test' }]),
        makeCtx(),
      );
      const bigRows = dbChildren.find((n) => n.name === 'big_rows');
      expect(bigRows?.detail).toMatch(/^~[\d,]+ rows$/);

      const bigRowsMeta = await adapter.describe(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'table', name: 'big_rows' },
        ]),
        makeCtx(),
      );
      expect(bigRowsMeta.rowEstimate).not.toBeNull();
      expect(bigRowsMeta.rowEstimate ?? 0).toBeGreaterThan(900_000);
      expect(bigRowsMeta.rowEstimate ?? 0).toBeLessThan(1_100_000);

      // Unlike Postgres (reltuples truly stays unset until an explicit ANALYZE/VACUUM),
      // MariaDB's InnoDB persists and auto-recalculates row-count statistics on ordinary DML
      // (innodb_stats_auto_recalc), so a tiny freshly-seeded table already reports an exact
      // count here rather than surfacing null.
      const compositePkMeta = await adapter.describe(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'table', name: 'composite_pk' },
        ]),
        makeCtx(),
      );
      expect(compositePkMeta.rowEstimate).toBe(3);
    } finally {
      await adapter.disconnect();
    }
  });

  test('7. cancel, asserted server-side', async () => {
    const client = await createConnection({
      host: fixture.config.host ?? undefined,
      port: fixture.config.port ?? undefined,
      user: fixture.config.username ?? undefined,
      password: fixture.config.password ?? undefined,
      database: fixture.config.database ?? undefined,
    });
    const side = await createConnection({
      host: fixture.config.host ?? undefined,
      port: fixture.config.port ?? undefined,
      user: 'root',
      password: 'kira',
    });
    try {
      let tracked: RunningQuery | undefined;
      wireScheduler({
        emit: () => {},
        getAdapter: (): Adapter => ({
          kind: 'mariadb',
          caps: mariadbCaps,
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
          async cancel() {
            if (!tracked || tracked.threadId === null) return false;
            const cancelClient = await createConnection({
              host: fixture.config.host ?? undefined,
              port: fixture.config.port ?? undefined,
              user: 'root',
              password: 'kira',
            });
            try {
              await cancelClient.query(`KILL QUERY ${tracked.threadId}`);
              return true;
            } finally {
              await cancelClient.end();
            }
          },
        }),
      });

      let capturedOpId: string | undefined;
      const opPromise = runOp({ connectionId: 'cancel-test', kind: 'children' }, (ctx) => {
        capturedOpId = ctx.opId;
        return runQuery(client, 'SELECT SLEEP(30)', [], ctx, (q) => {
          tracked = q;
        });
      });
      // Same discipline as postgres.spec.ts: mark the rejection handled immediately so
      // Node/Bun does not flag an unhandled rejection during the waitUntil/cancelOp gap below.
      opPromise.catch(() => {});

      await waitUntil(async () => {
        const rows = await side.query<{ n: bigint | number }[]>(
          `SELECT count(*) AS n FROM information_schema.PROCESSLIST
           WHERE state != 'Killed' AND info LIKE '%SLEEP%' AND info NOT LIKE '%PROCESSLIST%'`,
        );
        return Number(rows[0]?.n ?? 0) !== 0;
      });

      expect(capturedOpId).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: asserted above
      const cancelled = await cancelOp(capturedOpId!);
      expect(cancelled).toBe(true);

      await expect(opPromise).rejects.toMatchObject({ code: 'E_CANCELLED' });

      await waitUntil(
        async () => {
          const rows = await side.query<{ n: bigint | number }[]>(
            `SELECT count(*) AS n FROM information_schema.PROCESSLIST
             WHERE state != 'Killed' AND info LIKE '%SLEEP%' AND info NOT LIKE '%PROCESSLIST%'`,
          );
          return Number(rows[0]?.n ?? 0) === 0;
        },
        { timeoutMs: 2000 },
      );
    } finally {
      await client.end();
      await side.end();
    }
  });

  test('8. cap honesty', () => {
    expect(mariadbCaps.cancel).toBe(true);
  });

  test('9. children of a leaf', async () => {
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const children = await adapter.children(
        path([
          { kind: 'database', name: 'kira_test' },
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
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await adapter.read(
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
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
      expect(page.columns.map((c) => c.name)).toEqual(['id', 'payload']);
      expect(page.position.strategy).toBe('keyset');
    } finally {
      await adapter.disconnect();
    }
  });

  test('11. read: deep page by offset', async () => {
    const adapter = createAdapter('mariadb', deps);
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
      const page = await adapter.read(
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
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
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: 'kira_test' },
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
      let lastPage: Awaited<ReturnType<typeof adapter.read>> | undefined;
      for (let i = 0; i < 5; i++) {
        const page = await adapter.read({ ...baseReq, cursor }, makeCtx());
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
        const page = await adapter.read({ ...baseReq, cursor: backCursor }, makeCtx());
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
        adapter.read(
          { ...baseReq, filter: 'id > 0', cursor: { mode: 'after', token: staleToken } },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('13. read: no keyset without a tiebreaker', async () => {
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // order_summary is a view with no unique key of its own.
      const page = await adapter.read(
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
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
      const mixedSortPage = await adapter.read(
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
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
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: 'kira_test' },
        { kind: 'table', name: 'order_items' },
      ]);
      const page = await adapter.read(
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
        adapter.read(
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
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: 'kira_test' },
        { kind: 'table', name: 'order_items' },
      ]);
      const all = await adapter.read(
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
      const filtered = await adapter.read(
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

      await expect(
        adapter.read(
          {
            path: target,
            projection: null,
            filter: 'this is not valid sql (((',
            sort: null,
            pageSize: 10,
            cursor: { mode: 'offset', offset: 0 },
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });

      try {
        await adapter.read(
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
        expect((err as Error).message).toContain('SQL syntax');
      }
    } finally {
      await adapter.disconnect();
    }
  });

  test('16. read: fidelity', async () => {
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await adapter.read(
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
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
      // blob column comes back as 0x-prefixed hex, never U+FFFD.
      const bigTextChunk = page.chunks[3];
      expect(isTruncated(bigTextChunk, 3)).toBe(true);
      expect(page.truncatedCells).toBeGreaterThan(0);
      const blobText = cellAt(page, 4, 3);
      expect(blobText).toMatch(/^0x[0-9a-f]+$/);

      // decimal(20,6) comes back as its exact text, not a rounded double — this is the
      // assertion D3 exists for.
      const decimalPage = await adapter.read(
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'table', name: 'wide_table' },
          ]),
          projection: ['decimal_a'],
          filter: 'id = 1',
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(cellAt(decimalPage, 0, 0)).toBe('1.500000');
    } finally {
      await adapter.disconnect();
    }
  });

  test('17. count', async () => {
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const bigRowsCount = await adapter.count(
        {
          path: path([
            { kind: 'database', name: 'kira_test' },
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
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    const probeConn = await createConnection({
      host: fixture.config.host ?? undefined,
      port: fixture.config.port ?? undefined,
      user: 'root',
      password: 'kira',
      database: 'kira_test',
    });
    try {
      await probeConn.query('CREATE TABLE IF NOT EXISTS app_probe (id INT PRIMARY KEY)');
      await probeConn.query('INSERT IGNORE INTO app_probe (id) VALUES (1)');

      await expect(
        adapter.read(
          {
            path: path([
              { kind: 'database', name: 'kira_test' },
              { kind: 'table', name: 'order_items' },
            ]),
            projection: null,
            filter: '1=1; DROP TABLE app_probe',
            sort: null,
            pageSize: 10,
            cursor: { mode: 'offset', offset: 0 },
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });

      const stillThere = await probeConn.query<{ n: bigint | number }[]>(
        `SELECT count(*) AS n FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = 'kira_test' AND TABLE_NAME = 'app_probe'`,
      );
      expect(Number(stillThere[0]?.n ?? 0)).toBe(1);
    } finally {
      await probeConn.query('DROP TABLE IF EXISTS app_probe');
      await probeConn.end();
      await adapter.disconnect();
    }
  });

  test('19. ddl', async () => {
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    let wideTableDdl: Awaited<ReturnType<Adapter['ddl']>>;
    try {
      // 1. Passthrough.
      wideTableDdl = await adapter.ddl(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'table', name: 'wide_table' },
        ]),
        makeCtx(),
      );
      expect(wideTableDdl.origin).toBe('server');
      expect(wideTableDdl.statements).toHaveLength(1);

      const sideConn = await createConnection({
        host: fixture.config.host ?? undefined,
        port: fixture.config.port ?? undefined,
        user: 'root',
        password: 'kira',
        database: 'kira_test',
      });
      try {
        const [row] = await sideConn.query<{ 'Create Table': string }[]>(
          'SHOW CREATE TABLE wide_table',
        );
        const expected = row['Create Table'].replace(/;\s*$/, '');
        expect(wideTableDdl.statements[0]).toBe(expected);
      } finally {
        await sideConn.end();
      }

      // 3. View.
      const orderSummary = await adapter.ddl(
        path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'table', name: 'order_summary' },
        ]),
        makeCtx(),
      );
      expect(orderSummary.origin).toBe('server');
      expect(orderSummary.statements[0]).toContain('DEFINER=');
      expect(orderSummary.notes.some((n) => n.includes('DEFINER'))).toBe(true);

      // 4. Unsupported and not-found.
      await expect(
        adapter.ddl(
          path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'function', name: 'noop_procedure' },
          ]),
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });

      await expect(
        adapter.ddl(
          path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'function', name: 'full_name' },
          ]),
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });

      await expect(
        adapter.ddl(path([{ kind: 'database', name: 'kira_test' }]), makeCtx()),
      ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });

      await expect(
        adapter.ddl(
          path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'table', name: 'does_not_exist' },
          ]),
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    } finally {
      await adapter.disconnect();
    }

    // 2. Round trip — root creds are required for the admin database and its own connection,
    // since the fixture's `kira` user is only ever granted on `kira_test` (D17 as in postgres.spec.ts).
    const admin = await createConnection({
      host: fixture.config.host ?? undefined,
      port: fixture.config.port ?? undefined,
      user: 'root',
      password: 'kira',
    });
    try {
      await admin.query('DROP DATABASE IF EXISTS kira_ddl_roundtrip');
      await admin.query('CREATE DATABASE kira_ddl_roundtrip');
    } finally {
      await admin.end();
    }

    try {
      const roundTripConn = await createConnection({
        host: fixture.config.host ?? undefined,
        port: fixture.config.port ?? undefined,
        user: 'root',
        password: 'kira',
        database: 'kira_ddl_roundtrip',
      });
      try {
        await roundTripConn.query(wideTableDdl.statements[0]);
      } finally {
        await roundTripConn.end();
      }

      const sourceAdapter = createAdapter('mariadb', deps);
      await sourceAdapter.connect(fixture.config, makeCtx());
      let original: Awaited<ReturnType<Adapter['describe']>>;
      try {
        original = await sourceAdapter.describe(
          path([
            { kind: 'database', name: 'kira_test' },
            { kind: 'table', name: 'wide_table' },
          ]),
          makeCtx(),
        );
      } finally {
        await sourceAdapter.disconnect();
      }

      const copyAdapter = createAdapter('mariadb', deps);
      await copyAdapter.connect(
        { ...fixture.config, username: 'root', password: 'kira', database: 'kira_ddl_roundtrip' },
        makeCtx(),
      );
      let copy: Awaited<ReturnType<Adapter['describe']>>;
      try {
        copy = await copyAdapter.describe(
          path([
            { kind: 'database', name: 'kira_ddl_roundtrip' },
            { kind: 'table', name: 'wide_table' },
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
      const cleanup = await createConnection({
        host: fixture.config.host ?? undefined,
        port: fixture.config.port ?? undefined,
        user: 'root',
        password: 'kira',
      });
      try {
        await cleanup.query('DROP DATABASE IF EXISTS kira_ddl_roundtrip');
      } finally {
        await cleanup.end();
      }
    }
  });

  // composite_pk has no inbound foreign key (unlike customers/regions/products/orders, which
  // all reference or are referenced by something in the fixture graph) — a clean target for
  // delete/insert without tripping an FK constraint the mutation scenarios aren't testing.
  const compositePkPath = () =>
    path([
      { kind: 'database', name: 'kira_test' },
      { kind: 'table', name: 'composite_pk' },
    ]);

  test('20. preview: exact text, never executes', async () => {
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const plan: MutationPlan = {
        path: compositePkPath(),
        ops: [
          { kind: 'insert', values: { tenant_id: '3', entity_id: '1', name: 'new tenant' } },
          { kind: 'delete', key: { tenant_id: '2', entity_id: '1' } },
          { kind: 'update', key: { tenant_id: '1', entity_id: '1' }, changes: { name: "O'Brien Co" } },
        ],
      };
      const statements = adapter.preview(plan);
      expect(statements).toEqual([
        'DELETE FROM `kira_test`.`composite_pk` WHERE `tenant_id` = \'2\' AND `entity_id` = \'1\'',
        'UPDATE `kira_test`.`composite_pk` SET `name` = \'O\'\'Brien Co\' WHERE `tenant_id` = \'1\' AND `entity_id` = \'1\'',
        'INSERT INTO `kira_test`.`composite_pk` (`tenant_id`, `entity_id`, `name`) VALUES (\'3\', \'1\', \'new tenant\')',
      ]);

      const rows = await adapter.read(
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

  test('21. mutate: update lands in the op log', async () => {
    const adapter = createAdapter('mariadb', deps);
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
        'UPDATE `kira_test`.`composite_pk` SET `name` = \'tenant 1 / entity 1 updated\' WHERE `tenant_id` = \'1\' AND `entity_id` = \'1\'',
      );

      const rows = await adapter.read(
        {
          path: compositePkPath(),
          projection: null,
          filter: 'tenant_id = 1 AND entity_id = 1',
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(cellAt(rows, rows.columns.findIndex((c) => c.name === 'name'), 0)).toBe(
        'tenant 1 / entity 1 updated',
      );
    } finally {
      await adapter.disconnect();
    }
  });

  test('22. mutate: unknown column is E_NOT_FOUND', async () => {
    const adapter = createAdapter('mariadb', deps);
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

  test('23. mutate: read-only connection is E_UNSUPPORTED', async () => {
    const adapter = createAdapter('mariadb', deps);
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
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('24. mutate: a row-count conflict rolls back the whole batch', async () => {
    const adapter = createAdapter('mariadb', deps);
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

      const rows = await adapter.read(
        {
          path: compositePkPath(),
          projection: null,
          filter: 'tenant_id = 2 AND entity_id = 1',
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

  test('25. mutate: delete + update + insert, one transaction', async () => {
    const adapter = createAdapter('mariadb', deps);
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
          { kind: 'insert', values: { tenant_id: '3', entity_id: '1', name: 'tenant 3 / entity 1' } },
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
          'DELETE FROM `kira_test`.`composite_pk` WHERE `tenant_id` = \'2\' AND `entity_id` = \'1\'',
          'UPDATE `kira_test`.`composite_pk` SET `name` = \'tenant 1 / entity 1 final\' WHERE `tenant_id` = \'1\' AND `entity_id` = \'1\'',
          'INSERT INTO `kira_test`.`composite_pk` (`tenant_id`, `entity_id`, `name`) VALUES (\'3\', \'1\', \'tenant 3 / entity 1\')',
        ].join(';\n'),
      );

      const rows = await adapter.read(
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

  test('26. mutate: no primary key is E_UNSUPPORTED', async () => {
    const adapter = createAdapter('mariadb', deps);
    await adapter.connect(fixture.config, makeCtx());
    const probeConn = await createConnection({
      host: fixture.config.host ?? undefined,
      port: fixture.config.port ?? undefined,
      user: 'root',
      password: 'kira',
      database: 'kira_test',
    });
    try {
      await probeConn.query('CREATE TABLE IF NOT EXISTS no_pk_probe (col VARCHAR(50))');

      const plan: MutationPlan = {
        path: path([
          { kind: 'database', name: 'kira_test' },
          { kind: 'table', name: 'no_pk_probe' },
        ]),
        ops: [{ kind: 'update', key: { col: 'x' }, changes: { col: 'y' } }],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    } finally {
      await probeConn.query('DROP TABLE IF EXISTS no_pk_probe');
      await probeConn.end();
      await adapter.disconnect();
    }
  });
});
