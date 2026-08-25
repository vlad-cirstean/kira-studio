import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ClickHouseClient } from '@clickhouse/client';
import type { MutationPlan } from '@shared/domain/mutations';
import type { NodePath } from '@shared/domain/tree';
import { isNull, isTruncated, type TabularPage } from '@shared/protocol/page';
import type { Adapter, AdapterDeps, OpCtx } from '../../src/engine/adapters/adapter';
import { clickhouseCaps } from '../../src/engine/adapters/clickhouse/caps';
import { quoteIdent } from '../../src/engine/adapters/clickhouse/read';
import { AdapterError } from '../../src/engine/adapters/errors';
import { createAdapter } from '../../src/engine/adapters/registry';
import { type ClickHouseFixture, startClickHouse } from './support/clickhouse';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from './support/docker';
import { readTabular } from './support/page';

const CONTAINER_START_TIMEOUT_MS = 240_000;

const deps: AdapterDeps = {
  log(level, message) {
    if (level === 'error') console.error(`[clickhouse adapter] ${message}`);
  },
};

// P13 D13/D3's own recording variant — every statement handed to setCommand lands in `.commands`.
function makeCtx(): OpCtx & { commands: string[] } {
  const commands: string[] = [];
  return {
    opId: crypto.randomUUID(),
    signal: new AbortController().signal,
    setCommand(text) {
      commands.push(text);
    },
    commands,
  };
}

function path(segments: NodePath['segments']): NodePath {
  return { connectionId: 'test-clickhouse', segments };
}

const decoder = new TextDecoder();

function cellAt(page: TabularPage, col: number, row: number): string | null {
  const chunk = page.chunks[col];
  if (isNull(chunk, row)) return null;
  return decoder.decode(chunk.data.subarray(chunk.offsets[row], chunk.offsets[row + 1]));
}

async function waitUntil(
  check: () => Promise<boolean>,
  { timeoutMs = 10_000, intervalMs = 100 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('waitUntil: condition never became true');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// A raw @clickhouse/client, connected as the fixture's own admin user — every server-side
// assertion (system.processes, system.metrics, a scratch database for the definition round trip,
// probe tables outside the fixed grant set) goes through this, never through the adapter under
// test (§9.1's own rule: what the adapter claims is checked independently).
async function sideClient(fixture: ClickHouseFixture): Promise<ClickHouseClient> {
  const clickhouseModule = await import('@clickhouse/client');
  return clickhouseModule.createClient({
    url: fixture.baseUrl,
    username: fixture.adminUsername,
    password: fixture.adminPassword,
    database: fixture.database,
  });
}

async function sideRows<T = Record<string, unknown>>(
  client: ClickHouseClient,
  query: string,
): Promise<T[]> {
  const resultSet = await client.query({ query, format: 'JSONEachRow' });
  return resultSet.json<T>();
}

let fixture: ClickHouseFixture;

beforeAll(async () => {
  if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
  fixture = await startClickHouse();
}, CONTAINER_START_TIMEOUT_MS);

afterAll(async () => {
  await fixture?.stop();
});

describe('clickhouse adapter (§9.1, P36)', () => {
  test('1. connect / disconnect', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    const info = await adapter.connect(fixture.config, makeCtx());
    expect(info.serverVersion).toMatch(/^ClickHouse 2\d\./);
    expect(info.details?.url).toBe(fixture.baseUrl);
    expect(info.details?.database).toBe(fixture.database);
    expect(typeof info.details?.timezone).toBe('string');

    await adapter.disconnect();

    const side = await sideClient(fixture);
    try {
      await expect(adapter.children(path([]), makeCtx())).rejects.toMatchObject({
        code: 'E_CONNECT',
      });

      const rows = await sideRows<{ n: string }>(
        side,
        `SELECT count() AS n FROM system.processes WHERE http_user_agent LIKE '%kira-studio%'`,
      );
      expect(Number(rows[0]?.n ?? '0')).toBe(0);
    } finally {
      await side.close();
    }
  });

  test('2a. wrong password is E_AUTH', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    const badConfig = { ...fixture.config, password: 'definitely-wrong' };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({ code: 'E_AUTH' });
  });

  test('2b. unknown user is E_AUTH', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    const badConfig = { ...fixture.config, username: 'no_such_user' };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({ code: 'E_AUTH' });
  });

  test('2c. unreachable host is E_CONNECT, not a hang', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    const badConfig = { ...fixture.config, host: '127.0.0.1', port: 1 };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({
      code: 'E_CONNECT',
    });
  });

  test('2d. unknown database is E_NOT_FOUND naming it', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    const badConfig = { ...fixture.config, database: 'no_such_database' };
    try {
      await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({
        code: 'E_NOT_FOUND',
      });
      let rejected: unknown;
      try {
        await adapter.connect(badConfig, makeCtx());
      } catch (err) {
        rejected = err;
      }
      expect((rejected as Error).message).toContain('no_such_database');
    } finally {
      await adapter.disconnect();
    }
  });

  test('3. tree enumeration', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const roots = await adapter.children(path([]), makeCtx());
      const rootNames = roots.map((n) => n.name);
      expect(rootNames).toContain(fixture.database);
      expect(rootNames).toContain('default');
      // D15: system is kept, both information_schema spellings are hidden.
      expect(rootNames).toContain('system');
      expect(rootNames).not.toContain('INFORMATION_SCHEMA');
      expect(rootNames).not.toContain('information_schema');

      const dbChildren = await adapter.children(
        path([{ kind: 'database', name: fixture.database }]),
        makeCtx(),
      );
      const byKind = (kind: string) => dbChildren.filter((n) => n.kind === kind).map((n) => n.name);
      expect(byKind('table')).toContain('wide_table');
      expect(byKind('view')).toEqual(['order_summary']);
      expect(byKind('matview')).toEqual(['order_summary_mv']);
      // ClickHouse has neither a SEQUENCE nor a per-database routine concept (D15).
      expect(byKind('sequence')).toEqual([]);
      expect(byKind('function')).toEqual([]);

      const wideTable = dbChildren.find((n) => n.name === 'wide_table');
      expect(wideTable?.path).toBe(`database:${fixture.database}/table:wide_table`);
      expect(wideTable?.hasChildren).toBe(false);

      const noColumns = await adapter.children(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'table', name: 'wide_table' },
        ]),
        makeCtx(),
      );
      expect(noColumns).toEqual([]);
    } finally {
      await adapter.disconnect();
    }
  });

  test('4. quoting', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const dbChildren = await adapter.children(
        path([{ kind: 'database', name: fixture.database }]),
        makeCtx(),
      );
      const names = dbChildren.map((n) => n.name);
      expect(names).toContain('weird`name');
      expect(names).toContain('Order Items');

      const weirdMeta = await adapter.describe(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'table', name: 'weird`name' },
        ]),
        makeCtx(),
      );
      expect(weirdMeta.columns.map((c) => c.name).sort()).toEqual(['id', 'value']);

      const spacedMeta = await adapter.describe(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'table', name: 'Order Items' },
        ]),
        makeCtx(),
      );
      expect(spacedMeta.columns.map((c) => c.name).sort()).toEqual(['id', 'note']);
    } finally {
      await adapter.disconnect();
    }
  });

  test('5. describe', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const orderItems = await adapter.describe(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'table', name: 'order_items' },
        ]),
        makeCtx(),
      );
      // D18: a MergeTree PRIMARY KEY is never claimed as ObjectMeta.primaryKey, and ClickHouse has
      // no foreign keys at all.
      expect(orderItems.primaryKey).toBeNull();
      expect(orderItems.foreignKeys).toEqual([]);
      expect(orderItems.referencedBy).toEqual([]);
      const quantity = orderItems.columns.find((c) => c.name === 'quantity');
      expect(quantity).toMatchObject({ nullable: false, defaultExpr: '1' });
      expect(quantity?.dataType).toMatch(/UInt32/);

      // D18/D23: never a "PK" badge on a column either — that would claim the same uniqueness
      // ObjectMeta.primaryKey: null already refuses to. The sorting/primary key expression is
      // shown in full in the definition view's Table properties section instead (D22).
      const idColumn = orderItems.columns.find((c) => c.name === 'id');
      expect(idColumn?.isPrimaryKey).toBe(false);

      const primaryIndex = orderItems.indexes.find((i) => i.primary);
      expect(primaryIndex).toMatchObject({ unique: false, primary: true, columns: ['id'] });
    } finally {
      await adapter.disconnect();
    }
  });

  test('6. row estimate', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const dbChildren = await adapter.children(
        path([{ kind: 'database', name: fixture.database }]),
        makeCtx(),
      );
      const bigRows = dbChildren.find((n) => n.name === 'big_rows');
      expect(bigRows?.detail).toBe('~1,000,000 rows');

      const bigRowsMeta = await adapter.describe(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'table', name: 'big_rows' },
        ]),
        makeCtx(),
      );
      // F32: exact from part metadata, not a band the way MySQL's statistics cache forces.
      expect(bigRowsMeta.rowEstimate).toBe(1_000_000);

      const noSortingKeyMeta = await adapter.describe(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'table', name: 'no_sorting_key' },
        ]),
        makeCtx(),
      );
      // Checked against clickhouse-server 26.3.21.7: the Memory engine's total_rows is not null
      // the way the older assumption behind this fixture's own comment claimed — Memory keeps
      // every row in an in-process array, trivial to count, unlike a MergeTree's part metadata.
      expect(noSortingKeyMeta.rowEstimate).toBe(2);

      const viewMeta = await adapter.describe(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'view', name: 'order_summary' },
        ]),
        makeCtx(),
      );
      expect(viewMeta.rowEstimate).toBeNull();
    } finally {
      await adapter.disconnect();
    }
  });

  test('7. cancel: the real thing', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    const side = await sideClient(fixture);
    try {
      const opId = crypto.randomUUID();
      const ctx: OpCtx = { opId, signal: new AbortController().signal, setCommand() {} };
      const runPromise = adapter.execute(
        {
          path: path([{ kind: 'database', name: fixture.database }]),
          // max_block_size=1 keeps each block's sleep (1s) under the server's own
          // function_sleep_max_microseconds_per_block cap (3s) — verified empirically against
          // clickhouse-server:26.3 that the default block size batches all 30 rows into one block,
          // whose 30s total sleep the server refuses outright before ever running.
          statements: ['SELECT sleepEachRow(1) FROM numbers(30) SETTINGS max_block_size = 1'],
        },
        ctx,
      );
      // Swallow the eventual rejection here — asserted below — so an unhandled rejection isn't
      // reported before cancel() has had a chance to run.
      runPromise.catch(() => {});

      await waitUntil(async () => {
        const rows = await sideRows<{ n: string }>(
          side,
          `SELECT count() AS n FROM system.processes WHERE query_id LIKE 'kira-${opId}-%'`,
        );
        return Number(rows[0]?.n ?? '0') > 0;
      });

      const cancelled = await adapter.cancel(opId);
      expect(cancelled).toBe(true);
      await expect(runPromise).rejects.toMatchObject({ code: 'E_CANCELLED' });

      await waitUntil(async () => {
        const rows = await sideRows<{ n: string }>(
          side,
          `SELECT count() AS n FROM system.processes WHERE query_id LIKE 'kira-${opId}-%'`,
        );
        return Number(rows[0]?.n ?? '0') === 0;
      });

      // An already-aborted signal rejects before the statement ever runs.
      const abortedController = new AbortController();
      abortedController.abort();
      const abortedCtx: OpCtx = {
        opId: crypto.randomUUID(),
        signal: abortedController.signal,
        setCommand() {},
      };
      await expect(
        adapter.execute(
          { path: path([{ kind: 'database', name: fixture.database }]), statements: ['SELECT 1'] },
          abortedCtx,
        ),
      ).rejects.toMatchObject({ code: 'E_CANCELLED' });

      // cancel() for an unknown opId returns false without throwing.
      expect(await adapter.cancel(crypto.randomUUID())).toBe(false);
    } finally {
      await side.close();
      await adapter.disconnect();
    }
  });

  test('8. cap honesty', () => {
    expect(clickhouseCaps.cancel).toBe(true);
    expect(clickhouseCaps.fileTransfer).toBe(false);
    expect(clickhouseCaps.canInsert).toBe(true);
    expect(clickhouseCaps.canUpdate).toBe(false);
    expect(clickhouseCaps.canDelete).toBe(false);
    expect(clickhouseCaps.writable).toBe(true);
    expect(clickhouseCaps.transactions).toBe(false);
    expect(clickhouseCaps.pagination).toBe('offset');
    expect(clickhouseCaps.foreignKeys).toBe(false);
  });

  test('9. children of a leaf', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const children = await adapter.children(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'view', name: 'order_summary' },
        ]),
        makeCtx(),
      );
      expect(children).toEqual([]);
    } finally {
      await adapter.disconnect();
    }
  });

  test('10. read: first page', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: fixture.database },
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
      expect(page.position.strategy).toBe('offset');
    } finally {
      await adapter.disconnect();
    }
  });

  test('11. read: deep page by offset', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const ctx = makeCtx();
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: fixture.database },
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
      expect(cellAt(page, 0, 0)).toBe('900000');
      expect(ctx.commands.join('\n')).toContain('OFFSET');
    } finally {
      await adapter.disconnect();
    }
  });

  test('12-13. there is no keyset, and asking for one says so', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: fixture.database },
        { kind: 'table', name: 'big_rows' },
      ]);
      const baseReq = {
        path: target,
        projection: null,
        filter: null,
        sort: null,
        pageSize: 100,
      };

      const firstPage = await readTabular(
        adapter,
        { ...baseReq, cursor: { mode: 'offset', offset: 0 } },
        makeCtx(),
      );
      expect(firstPage.position.strategy).toBe('offset');
      expect(firstPage.position.nextToken).toBeNull();
      expect(firstPage.position.prevToken).toBeNull();

      await expect(
        readTabular(
          adapter,
          { ...baseReq, cursor: { mode: 'after', token: 'anything' } },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
      let rejected: unknown;
      try {
        await readTabular(
          adapter,
          { ...baseReq, cursor: { mode: 'after', token: 'anything' } },
          makeCtx(),
        );
      } catch (err) {
        rejected = err;
      }
      expect((rejected as Error).message.toLowerCase()).toContain('sparse');

      // Disjoint, complete row sets across two offset pages.
      const secondPage = await readTabular(
        adapter,
        { ...baseReq, cursor: { mode: 'offset', offset: 100 } },
        makeCtx(),
      );
      const firstIds = new Set(
        Array.from({ length: firstPage.rowCount }, (_, r) => cellAt(firstPage, 0, r)),
      );
      const secondIds = new Set(
        Array.from({ length: secondPage.rowCount }, (_, r) => cellAt(secondPage, 0, r)),
      );
      for (const id of secondIds) expect(firstIds.has(id)).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('14. read: projection', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: fixture.database },
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
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: fixture.database },
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

      await expect(
        readTabular(
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
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('15a. quoteIdent rejects a NUL byte, same as the other three SQL adapters (P43 F4/D6)', () => {
    expect(() => quoteIdent('evil\0name')).toThrow(AdapterError);
    try {
      quoteIdent('evil\0name');
      throw new Error('expected quoteIdent to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as AdapterError).code).toBe('E_QUERY');
    }
  });

  test('16. read: fidelity', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: fixture.database },
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
      expect(isNull(labelChunk, 0)).toBe(true);
      expect(isNull(labelChunk, 1)).toBe(false);
      expect(cellAt(page, 1, 1)).toBe('');

      expect(cellAt(page, 1, 2)).toBe('😀🎉👍 emoji');
      expect(cellAt(page, 2, 2)).toContain('中文测试');
      expect(cellAt(page, 2, 2)).toContain('日本語テスト');
      expect(cellAt(page, 2, 2)).toContain('한국어 테스트');
      expect(cellAt(page, 2, 2)).toContain('العربية');
      expect(cellAt(page, 2, 2)).toContain('עברית');

      const bigTextChunk = page.chunks[3];
      expect(isTruncated(bigTextChunk, 3)).toBe(true);
      expect(page.truncatedCells).toBeGreaterThan(0);
    } finally {
      await adapter.disconnect();
    }
  });

  test('17. count', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const bigRowsCount = await adapter.count(
        {
          path: path([
            { kind: 'database', name: fixture.database },
            { kind: 'table', name: 'big_rows' },
          ]),
          filter: null,
        },
        makeCtx(),
      );
      expect(bigRowsCount.value).toBe(1_000_000);
      expect(bigRowsCount.exact).toBe(true);

      const filteredCount = await adapter.count(
        {
          path: path([
            { kind: 'database', name: fixture.database },
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

  test('18. read cannot write (filter injection never reaches the database)', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    const side = await sideClient(fixture);
    try {
      await side.command({
        query: `CREATE TABLE IF NOT EXISTS app_probe (id UInt32) ENGINE = MergeTree ORDER BY id`,
      });
      await side.command({ query: `INSERT INTO app_probe (id) VALUES (1)` });

      await expect(
        readTabular(
          adapter,
          {
            path: path([
              { kind: 'database', name: fixture.database },
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

      const stillThere = await sideRows<{ n: string }>(
        side,
        `SELECT count() AS n FROM system.tables WHERE database = '${fixture.database}' AND name = 'app_probe'`,
      );
      expect(Number(stillThere[0]?.n ?? '0')).toBe(1);
    } finally {
      await side.command({ query: 'DROP TABLE IF EXISTS app_probe' }).catch(() => {});
      await side.close();
      await adapter.disconnect();
    }
  });

  test('19. definition', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    const side = await sideClient(fixture);
    let wideTableDefinition: Awaited<ReturnType<Adapter['definition']>>;
    try {
      wideTableDefinition = await adapter.definition(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'table', name: 'wide_table' },
        ]),
        makeCtx(),
      );
      expect(wideTableDefinition.origin).toBe('server');
      expect(wideTableDefinition.statements).toHaveLength(1);
      // D6: show_table_uuid_in_table_create_query_if_not_nil is pinned to 0 — no auto-generated
      // `UUID '...'` table-identity clause. A plain substring check would also flag wide_table's
      // own legitimate `uuid_a UUID DEFAULT generateUUIDv4()` column, so match the clause's shape.
      expect(wideTableDefinition.statements[0]).not.toMatch(/\bUUID\s+'[0-9a-f-]+'/i);

      const rows = await sideRows<{ create_table_query: string }>(
        side,
        `SELECT create_table_query FROM system.tables WHERE database = '${fixture.database}' AND name = 'wide_table'`,
      );
      const expected = (rows[0]?.create_table_query ?? '').replace(/;\s*$/, '');
      expect(wideTableDefinition.statements[0]).toBe(expected);

      const table = wideTableDefinition.sections.find((s) => s.title === 'Table properties');
      expect(table).toBeDefined();
      const rowName = (name: string) => table?.rows.find((r) => r.name === name);
      expect(rowName('Engine')?.value).toBe('MergeTree');
      expect(rowName('Sorting key')).toBeDefined();
      expect(wideTableDefinition.notes.some((n) => n.toLowerCase().includes('sparse'))).toBe(true);
      expect(wideTableDefinition.notes.some((n) => n.toLowerCase().includes('foreign key'))).toBe(
        true,
      );

      const orderItems = await adapter.definition(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'table', name: 'order_items' },
        ]),
        makeCtx(),
      );
      const check = orderItems.constraints.find((c) => c.type === 'check');
      expect(check?.name).toBe('order_items_quantity_positive');
      expect(check?.definition).toContain('quantity');

      await expect(
        adapter.definition(path([{ kind: 'database', name: fixture.database }]), makeCtx()),
      ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });

      await expect(
        adapter.definition(
          path([
            { kind: 'database', name: fixture.database },
            { kind: 'table', name: 'does_not_exist' },
          ]),
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    } finally {
      await side.close();
      await adapter.disconnect();
    }

    // Round trip: the returned statement re-executes into a scratch database.
    const admin = await sideClient(fixture);
    try {
      await admin.command({ query: 'DROP DATABASE IF EXISTS kira_definition_roundtrip' });
      await admin.command({ query: 'CREATE DATABASE kira_definition_roundtrip' });
      const roundTripStatement = wideTableDefinition.statements[0].replace(
        `${fixture.database}.`,
        'kira_definition_roundtrip.',
      );
      await admin.command({ query: roundTripStatement });

      const rows = await sideRows<{ n: string }>(
        admin,
        `SELECT count() AS n FROM system.tables WHERE database = 'kira_definition_roundtrip' AND name = 'wide_table'`,
      );
      expect(Number(rows[0]?.n ?? '0')).toBe(1);
    } finally {
      await admin
        .command({ query: 'DROP DATABASE IF EXISTS kira_definition_roundtrip' })
        .catch(() => {});
      await admin.close();
    }
  });

  const compositeKeyPath = () =>
    path([
      { kind: 'database', name: fixture.database },
      { kind: 'table', name: 'composite_key' },
    ]);

  test('20. preview: exact text, never executes', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const plan: MutationPlan = {
        path: compositeKeyPath(),
        ops: [{ kind: 'insert', values: { tenant_id: '3', entity_id: '1', name: 'new tenant' } }],
      };
      const statements = adapter.preview(plan);
      expect(statements).toEqual([
        `INSERT INTO \`${fixture.database}\`.\`composite_key\` (\`tenant_id\`, \`entity_id\`, \`name\`) VALUES ('3', '1', 'new tenant')`,
      ]);

      const rows = await readTabular(
        adapter,
        {
          path: compositeKeyPath(),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      // preview() never executes — still the seeded 3 rows.
      expect(rows.rowCount).toBe(3);
    } finally {
      await adapter.disconnect();
    }
  });

  test('21. mutate: an insert lands in the op log with the exact preview() text', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const ctx = makeCtx();
      const plan: MutationPlan = {
        path: compositeKeyPath(),
        ops: [{ kind: 'insert', values: { tenant_id: '9', entity_id: '9', name: 'inserted' } }],
      };
      const [expectedStatement] = adapter.preview(plan);
      const result = await adapter.mutate(plan, ctx);
      expect(result.affectedRows).toBe(1);
      expect(ctx.commands).toContain(expectedStatement);

      const rows = await readTabular(
        adapter,
        {
          path: compositeKeyPath(),
          projection: null,
          filter: 'tenant_id = 9 AND entity_id = 9',
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(rows.rowCount).toBe(1);
    } finally {
      await adapter.disconnect();
    }
  });

  test('22. mutate: unknown column is E_NOT_FOUND', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const plan: MutationPlan = {
        path: compositeKeyPath(),
        ops: [{ kind: 'insert', values: { tenant_id: '1', bogus_col: 'z' } }],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('23. mutate: read-only connection is E_UNSUPPORTED', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect({ ...fixture.config, readOnly: true }, makeCtx());
    try {
      const plan: MutationPlan = {
        path: compositeKeyPath(),
        ops: [{ kind: 'insert', values: { tenant_id: '5', entity_id: '5', name: 'nope' } }],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });
    } finally {
      await adapter.disconnect();
    }
  });

  test('24. mutate: an update op is E_UNSUPPORTED, table unchanged', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const before = await readTabular(
        adapter,
        {
          path: compositeKeyPath(),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );

      const plan: MutationPlan = {
        path: compositeKeyPath(),
        ops: [
          {
            kind: 'update',
            key: { tenant_id: '1', entity_id: '1' },
            changes: { name: 'should not land' },
          },
        ],
      };
      let rejected: unknown;
      try {
        await adapter.mutate(plan, makeCtx());
      } catch (err) {
        rejected = err;
      }
      expect((rejected as { code?: string }).code).toBe('E_UNSUPPORTED');
      expect((rejected as Error).message.toLowerCase()).toContain('sparse');

      const after = await readTabular(
        adapter,
        {
          path: compositeKeyPath(),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(after.rowCount).toBe(before.rowCount);
    } finally {
      await adapter.disconnect();
    }
  });

  test('25. mutate: a delete op is E_UNSUPPORTED, table unchanged', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const before = await readTabular(
        adapter,
        {
          path: compositeKeyPath(),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );

      const plan: MutationPlan = {
        path: compositeKeyPath(),
        ops: [{ kind: 'delete', key: { tenant_id: '1', entity_id: '1' } }],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });

      const after = await readTabular(
        adapter,
        {
          path: compositeKeyPath(),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(after.rowCount).toBe(before.rowCount);
    } finally {
      await adapter.disconnect();
    }
  });

  test('26. mutate: a plan mixing insert with update is refused whole — the insert must not land', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const plan: MutationPlan = {
        path: compositeKeyPath(),
        ops: [
          { kind: 'insert', values: { tenant_id: '77', entity_id: '77', name: 'must not land' } },
          {
            kind: 'update',
            key: { tenant_id: '1', entity_id: '1' },
            changes: { name: 'nope' },
          },
        ],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });

      const rows = await readTabular(
        adapter,
        {
          path: compositeKeyPath(),
          projection: null,
          filter: 'tenant_id = 77 AND entity_id = 77',
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(rows.rowCount).toBe(0);
    } finally {
      await adapter.disconnect();
    }
  });

  test('27. execute: one page per statement, including a non-row-returning one', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    const side = await sideClient(fixture);
    try {
      await side.command({
        query:
          'CREATE TABLE IF NOT EXISTS console_probe (id UInt32, name String) ENGINE = MergeTree ORDER BY id',
      });
      await side.command({ query: `INSERT INTO console_probe (id, name) VALUES (1, 'row 1')` });

      const ctx = makeCtx();
      const statements = [
        'SELECT id, name FROM console_probe ORDER BY id',
        `INSERT INTO console_probe (id, name) VALUES (2, 'row 2')`,
      ];
      const pages = await adapter.execute(
        { path: path([{ kind: 'database', name: fixture.database }]), statements },
        ctx,
      );

      expect(ctx.commands[0]).toBe(statements.join(';\n'));
      expect(pages).toHaveLength(2);
      const [page0, page1] = pages;
      if (page0.kind !== 'tabular' || page1.kind !== 'tabular') {
        throw new Error('expected tabular console pages');
      }
      expect(page0.rowCount).toBe(1);
      const nameCol = page0.columns.findIndex((c) => c.name === 'name');
      expect(cellAt(page0, nameCol, 0)).toBe('row 1');

      expect(page1.columns).toEqual([
        {
          name: 'status',
          dataType: 'String',
          typeClass: 'text',
          nullable: false,
          isPrimaryKey: false,
          generated: false,
        },
      ]);
      expect(page1.rowCount).toBe(1);
      expect(cellAt(page1, 0, 0)).toBe('1 row(s) written');
    } finally {
      await side.command({ query: 'DROP TABLE IF EXISTS console_probe' }).catch(() => {});
      await side.close();
      await adapter.disconnect();
    }
  });

  test('28. execute: a failing statement rejects the whole call — earlier statements already landed', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    const side = await sideClient(fixture);
    try {
      await side.command({
        query:
          'CREATE TABLE IF NOT EXISTS console_probe (id UInt32, name String) ENGINE = MergeTree ORDER BY id',
      });

      await expect(
        adapter.execute(
          {
            path: path([{ kind: 'database', name: fixture.database }]),
            statements: [
              `INSERT INTO console_probe (id, name) VALUES (3, 'landed before the failure')`,
              'SELECT * FROM does_not_exist',
            ],
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });

      const rows = await sideRows<{ name: string }>(
        side,
        'SELECT name FROM console_probe WHERE id = 3',
      );
      expect(rows[0]?.name).toBe('landed before the failure');
    } finally {
      await side.command({ query: 'DROP TABLE IF EXISTS console_probe' }).catch(() => {});
      await side.close();
      await adapter.disconnect();
    }
  });

  test('29. execute: an already-cancelled signal rejects before running anything', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const controller = new AbortController();
      controller.abort();
      const ctx: OpCtx = { opId: crypto.randomUUID(), signal: controller.signal, setCommand() {} };
      await expect(
        adapter.execute(
          {
            path: path([{ kind: 'database', name: fixture.database }]),
            statements: ['SELECT 1'],
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'E_CANCELLED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('30. count issues one statement', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const ctx = makeCtx();
      const result = await adapter.count(
        {
          path: path([
            { kind: 'database', name: fixture.database },
            { kind: 'table', name: 'order_items' },
          ]),
          filter: null,
        },
        ctx,
      );
      expect(result.exact).toBe(true);
      expect(ctx.commands).toHaveLength(1);
      expect(ctx.commands[0]).toMatch(/count\(/i);
    } finally {
      await adapter.disconnect();
    }
  });

  test('31. read still resolves the catalog', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const ctx = makeCtx();
      await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: fixture.database },
            { kind: 'table', name: 'order_items' },
          ]),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        ctx,
      );
      // D19: getReadTarget's catalog queries plus the data query itself — more than one statement.
      expect(ctx.commands.length).toBeGreaterThan(1);
    } finally {
      await adapter.disconnect();
    }
  });

  test('32. the leak guard — a failed connect leaves nothing open, and the running-query map does not grow', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    const badConfig = { ...fixture.config, password: 'definitely-wrong' };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({ code: 'E_AUTH' });
    // connect()'s own catch already ran disconnect() (P13 D1) — a second, explicit disconnect()
    // must be a clean no-op.
    await expect(adapter.disconnect()).resolves.toBeUndefined();

    const goodAdapter = await createAdapter('clickhouse', deps);
    await goodAdapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: fixture.database },
        { kind: 'table', name: 'order_items' },
      ]);
      const opIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const ctx = makeCtx();
        opIds.push(ctx.opId);
        await readTabular(
          goodAdapter,
          {
            path: target,
            projection: null,
            filter: null,
            sort: null,
            pageSize: 10,
            cursor: { mode: 'offset', offset: 0 },
          },
          ctx,
        );
      }
      // Each read's release closure already ran — cancelling any of those opIds now is a no-op.
      for (const opId of opIds) {
        expect(await goodAdapter.cancel(opId)).toBe(false);
      }
    } finally {
      await goodAdapter.disconnect();
    }
  });

  // --- ClickHouse-specific additions (§5, P36) ------------------------------------------------

  test('34. duplicate "primary key" rows are real', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: fixture.database },
            { kind: 'table', name: 'dup_keys' },
          ]),
          projection: null,
          filter: null,
          sort: { kind: 'structured', terms: [{ column: 'note', direction: 'asc' }] },
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.rowCount).toBe(2);
      const idCol = page.columns.findIndex((c) => c.name === 'id');
      expect(cellAt(page, idCol, 0)).toBe('1');
      expect(cellAt(page, idCol, 1)).toBe('1');

      const meta = await adapter.describe(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'table', name: 'dup_keys' },
        ]),
        makeCtx(),
      );
      expect(meta.primaryKey).toBeNull();
      for (const col of meta.columns) expect(col.isPrimaryKey).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('35. wide types', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: fixture.database },
            { kind: 'table', name: 'wide_types' },
          ]),
          projection: null,
          filter: null,
          sort: { kind: 'structured', terms: [{ column: 'id', direction: 'asc' }] },
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      const byName = new Map(page.columns.map((c, i) => [c.name, i]));
      const typeClassOf = (name: string) => page.columns[byName.get(name) ?? -1]?.typeClass;
      const nullableOf = (name: string) => page.columns[byName.get(name) ?? -1]?.nullable;

      expect(typeClassOf('arr')).toBe('json');
      expect(typeClassOf('tup')).toBe('json');
      expect(typeClassOf('mp')).toBe('json');
      expect(typeClassOf('en')).toBe('text');
      expect(typeClassOf('uid')).toBe('text');
      expect(typeClassOf('ip4')).toBe('text');
      expect(typeClassOf('ip6')).toBe('text');
      expect(typeClassOf('dec')).toBe('number');
      expect(typeClassOf('dt64')).toBe('temporal');
      expect(typeClassOf('fixed')).toBe('text');
      expect(typeClassOf('lc')).toBe('text');
      // Nullability is derived from the wrapper chain, not a flag — LowCardinality(Nullable(T)).
      expect(nullableOf('lc_nullable')).toBe(true);
      expect(nullableOf('lc')).toBe(false);

      const row0 = (name: string) => cellAt(page, byName.get(name) ?? -1, 0);
      expect(row0('en')).toBe('green');
      expect(row0('uid')).toBe('61f0c404-5cb3-11e7-907b-a6006ad3dba0');
    } finally {
      await adapter.disconnect();
    }
  });

  test('36. big integers keep every digit', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: fixture.database },
        { kind: 'table', name: 'wide_types' },
      ]);
      const page = await readTabular(
        adapter,
        {
          path: target,
          projection: ['big_uint', 'dec'],
          filter: 'id = 1',
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      // Projection is resolved in the table's own ordinal order, not request order (read.ts's
      // resolveProjection, mirrored by every other SQL adapter) — `dec` (position 9) sorts before
      // `big_uint` (position 14) in wide_types regardless of the ['big_uint', 'dec'] request above.
      // The server itself renders this Decimal128(20) one digit short of the inserted literal's own
      // trailing zero (verified directly against clickhouse-server:26.3's raw JSON response) — the
      // adapter passes the server's own text through unchanged (D16), so 19 fractional digits here
      // is what "every digit" the server actually reports looks like, not a formatting bug.
      expect(cellAt(page, 0, 0)).toBe('123456789012345678.1234567890123456789');
      expect(cellAt(page, 1, 0)).toBe('18446744073709551615');

      const [consolePage] = await adapter.execute(
        {
          path: target,
          statements: ['SELECT big_uint, dec FROM wide_types WHERE id = 1'],
        },
        makeCtx(),
      );
      if (consolePage.kind !== 'tabular') throw new Error('expected a tabular page');
      expect(cellAt(consolePage, 0, 0)).toBe('18446744073709551615');
    } finally {
      await adapter.disconnect();
    }
  });

  test('37. NULL is not the string "null", and NaN is not NULL', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: fixture.database },
            { kind: 'table', name: 'wide_types' },
          ]),
          projection: ['nullable_val', 'float_val'],
          filter: null,
          sort: { kind: 'structured', terms: [{ column: 'id', direction: 'asc' }] },
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      const nullableChunk = page.chunks[0];
      expect(isNull(nullableChunk, 0)).toBe(true);
      expect(isNull(nullableChunk, 1)).toBe(false);
      expect(cellAt(page, 0, 1)).toBe('null');
      expect(isNull(page.chunks[1], 1)).toBe(false);
      expect(cellAt(page, 1, 1)).toBe('nan');
    } finally {
      await adapter.disconnect();
    }
  });

  test("38. the default order is the table's own sorting key", async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    const side = await sideClient(fixture);
    try {
      const ctx = makeCtx();
      await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: fixture.database },
            { kind: 'table', name: 'big_rows' },
          ]),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        ctx,
      );
      const rows = await sideRows<{ sorting_key: string }>(
        side,
        `SELECT sorting_key FROM system.tables WHERE database = '${fixture.database}' AND name = 'big_rows'`,
      );
      const emittedSql = ctx.commands.join('\n');
      expect(emittedSql).toContain(`ORDER BY ${rows[0]?.sorting_key}`);

      const memoryCtx = makeCtx();
      await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: fixture.database },
            { kind: 'table', name: 'no_sorting_key' },
          ]),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        memoryCtx,
      );
      // Not the whole command log: runCatalogQuery (Adapter rule 3) logs every catalog lookup
      // too, and system.columns's own query always carries its own unrelated "ORDER BY position"
      // clause (sorting the column list, nothing to do with the table's data ordering) — the data
      // SELECT itself is the last command read() issues.
      expect(memoryCtx.commands.at(-1)).not.toContain('ORDER BY');
    } finally {
      await side.close();
      await adapter.disconnect();
    }
  });

  test('39. generated columns', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: fixture.database },
        { kind: 'table', name: 'generated_cols' },
      ]);
      const meta = await adapter.describe(target, makeCtx());
      expect(meta.columns.map((c) => c.name).sort()).toEqual(['a', 'b', 'c', 'id']);

      const page = await readTabular(
        adapter,
        {
          path: target,
          projection: null,
          filter: null,
          sort: { kind: 'structured', terms: [{ column: 'id', direction: 'asc' }] },
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.columns.map((c) => c.name)).toEqual(['id', 'a', 'b', 'c']);
      expect(page.columns.map((c) => c.generated)).toEqual([false, false, true, true]);
      const bIdx = page.columns.findIndex((c) => c.name === 'b');
      const cIdx = page.columns.findIndex((c) => c.name === 'c');
      expect(cellAt(page, bIdx, 0)).toBe('10'); // a * 2, a = 5
      expect(cellAt(page, cIdx, 0)).toBe('15'); // a * 3

      const plan: MutationPlan = {
        path: target,
        ops: [{ kind: 'insert', values: { id: '99', a: '1', b: '2' } }],
      };
      try {
        await adapter.mutate(plan, makeCtx());
        throw new Error('expected the insert to reject');
      } catch (err) {
        expect((err as { code?: string }).code).toBe('E_QUERY');
      }
    } finally {
      await adapter.disconnect();
    }
  });

  test('40. definition round trip', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    const side = await sideClient(fixture);
    try {
      const definition = await adapter.definition(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'table', name: 'commented' },
        ]),
        makeCtx(),
      );
      const rows = await sideRows<{ create_table_query: string }>(
        side,
        `SELECT create_table_query FROM system.tables WHERE database = '${fixture.database}' AND name = 'commented'`,
      );
      expect(definition.statements[0]).toBe(
        (rows[0]?.create_table_query ?? '').replace(/;\s*$/, ''),
      );
      expect(definition.statements[0]).not.toContain('UUID');
    } finally {
      await side.close();
      await adapter.disconnect();
    }
  });

  test('41. literal escaping', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const tricky = "a 'quote', a \\backslash\\, a\nnewline, a\ttab, and 日本語";
      const plan: MutationPlan = {
        path: compositeKeyPath(),
        ops: [{ kind: 'insert', values: { tenant_id: '42', entity_id: '1', name: tricky } }],
      };
      const [previewStatement] = adapter.preview(plan);
      const ctx = makeCtx();
      await adapter.mutate(plan, ctx);
      // The executed statement is the same string preview() rendered (no query parameters, D27).
      expect(ctx.commands).toContain(previewStatement);

      const page = await readTabular(
        adapter,
        {
          path: compositeKeyPath(),
          projection: ['name'],
          filter: 'tenant_id = 42 AND entity_id = 1',
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(cellAt(page, 0, 0)).toBe(tricky);
    } finally {
      await adapter.disconnect();
    }
  });

  test('42. multi-statement input is refused by the server', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
        adapter.execute(
          {
            path: path([{ kind: 'database', name: fixture.database }]),
            statements: ['SELECT 1; SELECT 2'],
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });

      const pages = await adapter.execute(
        {
          path: path([{ kind: 'database', name: fixture.database }]),
          statements: ['SELECT 1', 'SELECT 2'],
        },
        makeCtx(),
      );
      expect(pages).toHaveLength(2);
    } finally {
      await adapter.disconnect();
    }
  });

  test('43. read-only is enforced by the server, not just by the adapter', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const plan: MutationPlan = {
        path: compositeKeyPath(),
        ops: [{ kind: 'insert', values: { tenant_id: '1', entity_id: '1', name: 'nope' } }],
      };
      await expect(adapter.mutate(plan, makeCtx())).resolves.toBeDefined();
    } finally {
      await adapter.disconnect();
    }

    const readOnlyAdapter = await createAdapter('clickhouse', deps);
    await readOnlyAdapter.connect(fixture.readOnlyConfig, makeCtx());
    try {
      const plan: MutationPlan = {
        path: compositeKeyPath(),
        ops: [{ kind: 'insert', values: { tenant_id: '2', entity_id: '2', name: 'nope' } }],
      };
      await expect(readOnlyAdapter.mutate(plan, makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });

      // The adapter's own guard runs first; a raw statement through execute() proves the server
      // refuses independently. kira_ro's own grant is SELECT-only (support/clickhouse.ts) — verified
      // empirically against clickhouse-server:26.3 that this INSERT hits that grant check
      // (ACCESS_DENIED, code 497) before the app-level `readonly: 2` setting (query.ts's
      // readonlySettings) would even matter, so the server's own independent refusal is grant-based,
      // mapped to E_AUTH the same as every other ACCESS_DENIED case (errors.ts).
      let rejected: unknown;
      try {
        await readOnlyAdapter.execute(
          {
            path: path([{ kind: 'database', name: fixture.database }]),
            statements: [
              `INSERT INTO composite_key (tenant_id, entity_id, name) VALUES (3, 3, 'nope')`,
            ],
          },
          makeCtx(),
        );
      } catch (err) {
        rejected = err;
      }
      expect((rejected as { code?: string }).code).toBe('E_AUTH');
    } finally {
      await readOnlyAdapter.disconnect();
    }
  });

  test('44. table and column comments', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const commentedMeta = await adapter.describe(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'table', name: 'commented' },
        ]),
        makeCtx(),
      );
      expect(commentedMeta.comment).toBe('a table with its own comment');
      const idColumn = commentedMeta.columns.find((c) => c.name === 'id');
      expect(idColumn?.comment).toBe('the identifying key');

      const regionsMeta = await adapter.describe(
        path([
          { kind: 'database', name: fixture.database },
          { kind: 'table', name: 'regions' },
        ]),
        makeCtx(),
      );
      expect(regionsMeta.comment).toBeNull();
    } finally {
      await adapter.disconnect();
    }
  });

  test('45. cancel does not leak, and neither does a slow read', async () => {
    const adapter = await createAdapter('clickhouse', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const opId = crypto.randomUUID();
      const ctx: OpCtx = { opId, signal: new AbortController().signal, setCommand() {} };
      const slowPromise = adapter.execute(
        {
          path: path([{ kind: 'database', name: fixture.database }]),
          // max_block_size=1 keeps each block's sleep (1s) under the server's own
          // function_sleep_max_microseconds_per_block cap (3s) — verified empirically against
          // clickhouse-server:26.3 that the default block size batches all 30 rows into one block,
          // whose 30s total sleep the server refuses outright before ever running.
          statements: ['SELECT sleepEachRow(1) FROM numbers(30) SETTINGS max_block_size = 1'],
        },
        ctx,
      );
      slowPromise.catch(() => {});

      await waitUntil(async () => (await adapter.cancel(opId)) === true, { timeoutMs: 15_000 });
      await expect(slowPromise).rejects.toMatchObject({ code: 'E_CANCELLED' });

      // A fresh read on the same adapter succeeds immediately — the socket was returned to the
      // pool, not destroyed.
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: fixture.database },
            { kind: 'table', name: 'order_items' },
          ]),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.rowCount).toBeGreaterThan(0);
      expect(await adapter.cancel(opId)).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });
});
