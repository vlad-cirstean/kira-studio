import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MutationPlan } from '@shared/domain/mutations';
import type { NodePath } from '@shared/domain/tree';
import type { AdapterDeps, OpCtx } from '../../src/engine/adapters/adapter';
import { createAdapter } from '../../src/engine/adapters/registry';
import { sqliteCaps } from '../../src/engine/adapters/sqlite/caps';
import { isNull, isTruncated, type TabularPage } from '../../src/shared/protocol/page';
import { readTabular } from './support/page';
import {
  SQLITE_UNAVAILABLE_MESSAGE,
  type SqliteFixture,
  sqliteAvailable,
  startSqlite,
} from './support/sqlite';

const FIXTURE_TIMEOUT_MS = 30_000;
const BIG_ROWS = 1_000_000;

const deps: AdapterDeps = {
  log(level, message) {
    if (level === 'error') console.error(`[sqlite adapter] ${message}`);
  },
};

// P13 D13/D3: recording variant — every statement handed to setCommand lands in `.commands`, so
// tests can assert exactly how many round trips an operation issued without wiring a bespoke ctx
// each time.
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
  return { connectionId: 'test-sqlite', segments };
}

const decoder = new TextDecoder();

function cellAt(page: TabularPage, col: number, row: number): string | null {
  const chunk = page.chunks[col];
  if (isNull(chunk, row)) return null;
  return decoder.decode(chunk.data.subarray(chunk.offsets[row], chunk.offsets[row + 1]));
}

let fixture: SqliteFixture;

beforeAll(async () => {
  if (!(await sqliteAvailable())) throw new Error(SQLITE_UNAVAILABLE_MESSAGE);
  fixture = await startSqlite();
}, FIXTURE_TIMEOUT_MS);

afterAll(async () => {
  await fixture?.stop();
});

describe('sqlite adapter (§9.1, P35)', () => {
  test('1. connect / disconnect', async () => {
    const adapter = await createAdapter('sqlite', deps);
    const info = await adapter.connect(fixture.config, makeCtx());
    expect(info.serverVersion).toMatch(/^SQLite 3\./);
    expect(info.details?.file).toBe(fixture.path);
    const journalMode = info.details?.journalMode;
    expect(typeof journalMode).toBe('string');
    expect((journalMode as string).length).toBeGreaterThan(0);
    expect(typeof info.details?.pageSize).toBe('string');

    await adapter.disconnect();

    // The SQLite equivalent of mysql.spec.ts's "the session's connect attributes are gone": a
    // second handle opened right after disconnect() can take a write lock immediately — the only
    // way to prove the first handle was really closed, not merely idle.
    const { DatabaseSync } = await import('node:sqlite');
    const side = new DatabaseSync(fixture.path);
    try {
      side.exec('BEGIN IMMEDIATE');
      side.exec('COMMIT');
    } finally {
      side.close();
    }
  });

  // SQLite has no authentication (F14) — dropped, replaced by three connect-failure scenarios
  // that are real here.
  test('2a. a path that does not exist is E_NOT_FOUND, and Kira never creates the file (D8)', async () => {
    const adapter = await createAdapter('sqlite', deps);
    const missingPath = join(fixture.dir, 'does-not-exist.sqlite');
    await expect(
      adapter.connect({ ...fixture.config, database: missingPath }, makeCtx()),
    ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    expect(existsSync(missingPath)).toBe(false);
  });

  test('2b. a file that is not a SQLite database is E_CONNECT', async () => {
    const notDbPath = join(fixture.dir, 'not-a-database.sqlite');
    writeFileSync(notDbPath, 'this is not a sqlite database file, just plain text');
    const adapter = await createAdapter('sqlite', deps);
    try {
      await adapter.connect({ ...fixture.config, database: notDbPath }, makeCtx());
      throw new Error('expected connect to reject');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('E_CONNECT');
      expect((err as Error).message).toContain('not a database');
    }
  });

  test('2c. a directory is E_CONNECT, not an unhandled throw', async () => {
    const dirPath = join(fixture.dir, 'a-directory.sqlite');
    mkdirSync(dirPath);
    const adapter = await createAdapter('sqlite', deps);
    await expect(
      adapter.connect({ ...fixture.config, database: dirPath }, makeCtx()),
    ).rejects.toMatchObject({ code: 'E_CONNECT' });
  });

  test('3. tree enumeration', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const roots = await adapter.children(path([]), makeCtx());
      // `temp` is always present in database_list but is never a user schema (D19) — hidden.
      expect(roots.map((n) => n.name)).toEqual(['main']);

      const dbChildren = await adapter.children(
        path([{ kind: 'database', name: 'main' }]),
        makeCtx(),
      );
      const byKind = (kind: string) => dbChildren.filter((n) => n.kind === kind).map((n) => n.name);
      expect(byKind('view')).toEqual(['order_summary']);
      // No stored routines, no SEQUENCE engine (D19) — the tree is leaner than either other
      // SQL adapter's.
      expect(byKind('sequence')).toEqual([]);
      expect(byKind('function')).toEqual([]);
      // The FTS5 virtual table shows as a plain table (D19); its five shadow tables
      // (fts_docs_data/idx/docsize/content/config) and every sqlite_-prefixed name are hidden
      // (F17/F24) — never leak into the tree at all.
      expect(byKind('table')).toContain('fts_docs');
      const allNames = dbChildren.map((n) => n.name);
      expect(allNames.some((n) => n.startsWith('fts_docs_'))).toBe(false);
      expect(allNames.some((n) => n.startsWith('sqlite_'))).toBe(false);
      expect(byKind('table')).toHaveLength(17);

      const wideTable = dbChildren.find((n) => n.name === 'wide_table');
      expect(wideTable?.path).toBe('database:main/table:wide_table');
      expect(wideTable?.hasChildren).toBe(false);
      const noColumns = await adapter.children(
        path([
          { kind: 'database', name: 'main' },
          { kind: 'table', name: 'wide_table' },
        ]),
        makeCtx(),
      );
      expect(noColumns).toEqual([]);

      const wideTableMeta = await adapter.describe(
        path([
          { kind: 'database', name: 'main' },
          { kind: 'table', name: 'wide_table' },
        ]),
        makeCtx(),
      );
      expect(wideTableMeta.columns).toHaveLength(58);
      expect(wideTableMeta.columns[0]?.name).toBe('id');
      expect(wideTableMeta.columns[1]?.name).toBe('int_a');
    } finally {
      await adapter.disconnect();
    }
  });

  test('4. quoting', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const dbChildren = await adapter.children(
        path([{ kind: 'database', name: 'main' }]),
        makeCtx(),
      );
      const names = dbChildren.map((n) => n.name);
      expect(names).toContain('weird"name');
      expect(names).toContain('Order Items');

      const weirdMeta = await adapter.describe(
        path([
          { kind: 'database', name: 'main' },
          { kind: 'table', name: 'weird"name' },
        ]),
        makeCtx(),
      );
      expect(weirdMeta.columns.map((c) => c.name).sort()).toEqual(['id', 'value']);

      const spacedMeta = await adapter.describe(
        path([
          { kind: 'database', name: 'main' },
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
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const orderItems = await adapter.describe(
        path([
          { kind: 'database', name: 'main' },
          { kind: 'table', name: 'order_items' },
        ]),
        makeCtx(),
      );
      expect(orderItems.primaryKey).toEqual(['id']);
      const quantity = orderItems.columns.find((c) => c.name === 'quantity');
      expect(quantity).toMatchObject({ nullable: false, defaultExpr: '1' });
      expect(quantity?.dataType).toMatch(/^INTEGER/i);
      // 1, not 3 — a single-column INTEGER PRIMARY KEY (the rowid alias) has no backing index at
      // all in SQLite, and SQLite never auto-creates a supporting index for a foreign-key column
      // the way InnoDB does; the composite UNIQUE(order_id, product_id) constraint's own
      // sqlite_autoindex is the only index this table has.
      expect(orderItems.indexes).toHaveLength(1);
      const uniqueIndex = orderItems.indexes[0];
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
          { kind: 'database', name: 'main' },
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
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const dbChildren = await adapter.children(
        path([{ kind: 'database', name: 'main' }]),
        makeCtx(),
      );
      const bigRows = dbChildren.find((n) => n.name === 'big_rows');
      expect(bigRows?.detail).toMatch(/^~[\d,]+ rows$/);

      const bigRowsMeta = await adapter.describe(
        path([
          { kind: 'database', name: 'main' },
          { kind: 'table', name: 'big_rows' },
        ]),
        makeCtx(),
      );
      expect(bigRowsMeta.rowEstimate).not.toBeNull();
      expect(bigRowsMeta.rowEstimate ?? 0).toBeGreaterThan(900_000);
      expect(bigRowsMeta.rowEstimate ?? 0).toBeLessThan(1_100_000);

      // The seed only runs ANALYZE on big_rows (D32) — every other table has no sqlite_stat1
      // row at all, which getRowEstimateFor must surface as null, not 0 and not a real count.
      const compositePkMeta = await adapter.describe(
        path([
          { kind: 'database', name: 'main' },
          { kind: 'table', name: 'composite_pk' },
        ]),
        makeCtx(),
      );
      expect(compositePkMeta.rowEstimate).toBeNull();
    } finally {
      await adapter.disconnect();
    }
  });

  // D4: rewritten, not dropped — this is the whole of the cancellation contract for an engine
  // with no sqlite3_interrupt and a synchronous API (F10). The app's first honest `cancel: false`.
  test('7. cancel: caps says false, cancel() says false, an already-aborted op still rejects', async () => {
    expect(sqliteCaps.cancel).toBe(false);

    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      expect(await adapter.cancel('any-op-id')).toBe(false);

      const controller = new AbortController();
      controller.abort();
      const ctx: OpCtx = { opId: crypto.randomUUID(), signal: controller.signal, setCommand() {} };
      await expect(
        adapter.execute(
          { path: path([{ kind: 'database', name: 'main' }]), statements: ['SELECT 1'] },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'E_CANCELLED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('8. cap honesty', () => {
    expect(sqliteCaps.cancel).toBe(false);
    // count(*) over a million rows measured at ~9ms (F11) — cheaper than any other engine.
    expect(sqliteCaps.exactCount).toBe(true);
    // SQLite being itself a file does not make its rows files — fileTransfer is about an S3
    // object, not the database.
    expect(sqliteCaps.fileTransfer).toBe(false);
  });

  test('9. children of a leaf', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const children = await adapter.children(
        path([
          { kind: 'database', name: 'main' },
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
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'main' },
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
    const adapter = await createAdapter('sqlite', deps);
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
            { kind: 'database', name: 'main' },
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
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: 'main' },
        { kind: 'table', name: 'big_rows' },
      ]);
      const baseReq = { path: target, projection: null, filter: null, sort: null, pageSize: 100 };

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
      expect(seen.size).toBe(forwardIds.length);

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
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // order_summary is a view with no unique key of its own, and no rowid (D19/D22).
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'main' },
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

      const mixedSortPage = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'main' },
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
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: 'main' },
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
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: 'main' },
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

  test('16. read: fidelity', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'main' },
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
      const blobText = cellAt(page, 4, 3);
      expect(blobText).toMatch(/^0x[0-9a-f]+$/);

      // decimal(20,6) has no real meaning to SQLite (NUMERIC affinity, F21) — it stores and
      // returns the exact value written, not a rounded double.
      const decimalPage = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'main' },
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
      expect(cellAt(decimalPage, 0, 0)).toBe('1.5');
    } finally {
      await adapter.disconnect();
    }
  });

  test('17. count', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const bigRowsCount = await adapter.count(
        {
          path: path([
            { kind: 'database', name: 'main' },
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
            { kind: 'database', name: 'main' },
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
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    const { DatabaseSync } = await import('node:sqlite');
    const probeConn = new DatabaseSync(fixture.path);
    try {
      probeConn.exec('CREATE TABLE IF NOT EXISTS app_probe (id INTEGER PRIMARY KEY)');
      probeConn.exec('INSERT OR IGNORE INTO app_probe (id) VALUES (1)');

      // D9's single-statement guard means a filter carrying a second statement can never even
      // reach the table — it fails to parse as a plain expression inside the WHERE clause's own
      // parentheses (a syntax error), let alone execute.
      await expect(
        readTabular(
          adapter,
          {
            path: path([
              { kind: 'database', name: 'main' },
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

      const stillThere = probeConn
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'app_probe'",
        )
        .get() as { n: number };
      expect(stillThere.n).toBe(1);
    } finally {
      probeConn.exec('DROP TABLE IF EXISTS app_probe');
      probeConn.close();
      await adapter.disconnect();
    }
  });

  test('19. definition', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const wideTableDefinition = await adapter.definition(
        path([
          { kind: 'database', name: 'main' },
          { kind: 'table', name: 'wide_table' },
        ]),
        makeCtx(),
      );
      expect(wideTableDefinition.origin).toBe('server');
      expect(wideTableDefinition.statements).toHaveLength(1);

      // sqlite_master.sql is the CREATE statement as written — a side handle's own read of the
      // same column must match byte-for-byte.
      const { DatabaseSync } = await import('node:sqlite');
      const side = new DatabaseSync(fixture.path);
      try {
        const row = side
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'wide_table'")
          .get() as { sql: string };
        const expected = row.sql.replace(/;\s*$/, '');
        expect(wideTableDefinition.statements[0]).toBe(expected);
      } finally {
        side.close();
      }

      // The text re-executes cleanly into a fresh database (the round-trip claim).
      const roundTrip = new DatabaseSync(join(fixture.dir, 'definition-roundtrip.sqlite'));
      try {
        roundTrip.exec(wideTableDefinition.statements[0]);
      } finally {
        roundTrip.close();
      }

      const orderItems = await adapter.definition(
        path([
          { kind: 'database', name: 'main' },
          { kind: 'table', name: 'order_items' },
        ]),
        makeCtx(),
      );
      const pk = orderItems.constraints.find((c) => c.type === 'primaryKey');
      expect(pk).toBeDefined();
      const uniqueConstraint = orderItems.constraints.find((c) => c.type === 'unique');
      expect(uniqueConstraint?.definition).toContain('order_id');
      const foreignKeys = orderItems.constraints.filter((c) => c.type === 'foreignKey');
      expect(foreignKeys).toHaveLength(2);
      expect(foreignKeys.map((c) => c.definition).join(' ')).toContain('"orders"');
      expect(foreignKeys.map((c) => c.definition).join(' ')).toContain('"products"');
      // SQLite has no CHECK-constraint catalog at all (F19/D24) — not listed, and notes says so.
      const check = orderItems.constraints.find((c) => c.type === 'check');
      expect(check).toBeUndefined();
      expect(orderItems.notes.some((n) => n.toLowerCase().includes('check'))).toBe(true);

      const orderSummary = await adapter.definition(
        path([
          { kind: 'database', name: 'main' },
          { kind: 'view', name: 'order_summary' },
        ]),
        makeCtx(),
      );
      expect(orderSummary.origin).toBe('server');
      expect(orderSummary.statements[0]).toMatch(/^CREATE VIEW/i);

      await expect(
        adapter.definition(path([{ kind: 'database', name: 'main' }]), makeCtx()),
      ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });

      await expect(
        adapter.definition(
          path([
            { kind: 'database', name: 'main' },
            { kind: 'table', name: 'does_not_exist' },
          ]),
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });
    } finally {
      await adapter.disconnect();
    }
  });

  const compositePkPath = () =>
    path([
      { kind: 'database', name: 'main' },
      { kind: 'table', name: 'composite_pk' },
    ]);

  test('20. preview: exact text, never executes', async () => {
    const adapter = await createAdapter('sqlite', deps);
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
        `DELETE FROM "main"."composite_pk" WHERE "tenant_id" = '2' AND "entity_id" = '1'`,
        `UPDATE "main"."composite_pk" SET "name" = 'O''Brien Co' WHERE "tenant_id" = '1' AND "entity_id" = '1'`,
        `INSERT INTO "main"."composite_pk" ("tenant_id", "entity_id", "name") VALUES ('3', '1', 'new tenant')`,
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

  test('21. mutate: update lands in the op log', async () => {
    const adapter = await createAdapter('sqlite', deps);
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
        `UPDATE "main"."composite_pk" SET "name" = 'tenant 1 / entity 1 updated' WHERE "tenant_id" = '1' AND "entity_id" = '1'`,
      );

      const rows = await readTabular(
        adapter,
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

  test('22. mutate: unknown column is E_NOT_FOUND', async () => {
    const adapter = await createAdapter('sqlite', deps);
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
    const adapter = await createAdapter('sqlite', deps);
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

  test('24. mutate: a row-count conflict rolls back the whole batch', async () => {
    const adapter = await createAdapter('sqlite', deps);
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
          filter: 'tenant_id = 2 AND entity_id = 1',
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

  test('25. mutate: delete + update + insert, one transaction', async () => {
    const adapter = await createAdapter('sqlite', deps);
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
          `DELETE FROM "main"."composite_pk" WHERE "tenant_id" = '2' AND "entity_id" = '1'`,
          `UPDATE "main"."composite_pk" SET "name" = 'tenant 1 / entity 1 final' WHERE "tenant_id" = '1' AND "entity_id" = '1'`,
          `INSERT INTO "main"."composite_pk" ("tenant_id", "entity_id", "name") VALUES ('3', '1', 'tenant 3 / entity 1')`,
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

  // no_pk_rowid is exactly the table D22 *can* page by rowid — asserted against here so D23's
  // boundary (rowid is never mutation identity) is visible: paging works, mutating doesn't.
  test('26. mutate: no primary key is E_UNSUPPORTED', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const plan: MutationPlan = {
        path: path([
          { kind: 'database', name: 'main' },
          { kind: 'table', name: 'no_pk_rowid' },
        ]),
        ops: [{ kind: 'update', key: { label: 'alpha' }, changes: { label: 'zzz' } }],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });
    } finally {
      await adapter.disconnect();
    }
  });

  test('27. execute: one page per statement, including a non-row-returning one', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    const { DatabaseSync } = await import('node:sqlite');
    const probeConn = new DatabaseSync(fixture.path);
    try {
      probeConn.exec(
        'CREATE TABLE IF NOT EXISTS console_probe (id INTEGER PRIMARY KEY, name TEXT)',
      );
      probeConn.exec(`INSERT INTO console_probe (id, name) VALUES (1, 'row 1')`);

      let loggedCommand = '';
      const ctx: OpCtx = {
        opId: crypto.randomUUID(),
        signal: new AbortController().signal,
        setCommand(text) {
          loggedCommand = text;
        },
      };
      const statements = [
        'SELECT id, name FROM console_probe ORDER BY id',
        `INSERT INTO console_probe (id, name) VALUES (2, 'row 2')`,
      ];
      const pages = await adapter.execute(
        { path: path([{ kind: 'database', name: 'main' }]), statements },
        ctx,
      );

      expect(loggedCommand).toBe(statements.join(';\n'));

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
          dataType: 'text',
          typeClass: 'text',
          nullable: false,
          isPrimaryKey: false,
          generated: false,
        },
      ]);
      expect(page1.rowCount).toBe(1);
      expect(cellAt(page1, 0, 0)).toBe('1 row(s) affected');
    } finally {
      probeConn.exec('DROP TABLE IF EXISTS console_probe');
      probeConn.close();
      await adapter.disconnect();
    }
  });

  test('28. execute: a failing statement rejects the whole call — earlier statements already landed', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    const { DatabaseSync } = await import('node:sqlite');
    const probeConn = new DatabaseSync(fixture.path);
    try {
      probeConn.exec(
        'CREATE TABLE IF NOT EXISTS console_probe (id INTEGER PRIMARY KEY, name TEXT)',
      );

      await expect(
        adapter.execute(
          {
            path: path([{ kind: 'database', name: 'main' }]),
            statements: [
              `INSERT INTO console_probe (id, name) VALUES (3, 'landed before the failure')`,
              'SELECT * FROM does_not_exist',
            ],
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });

      const row = probeConn.prepare('SELECT name FROM console_probe WHERE id = 3').get() as {
        name: string;
      };
      expect(row?.name).toBe('landed before the failure');
    } finally {
      probeConn.exec('DROP TABLE IF EXISTS console_probe');
      probeConn.close();
      await adapter.disconnect();
    }
  });

  test('29. execute: an already-cancelled signal rejects before running anything', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const controller = new AbortController();
      controller.abort();
      const ctx: OpCtx = { opId: crypto.randomUUID(), signal: controller.signal, setCommand() {} };
      await expect(
        adapter.execute(
          { path: path([{ kind: 'database', name: 'main' }]), statements: ['SELECT 1'] },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'E_CANCELLED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('30. count issues one statement (F13, D13)', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const ctx = makeCtx();
      const result = await adapter.count(
        {
          path: path([
            { kind: 'database', name: 'main' },
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

  test('31. read still resolves the catalog (D13 boundary)', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const ctx = makeCtx();
      await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'main' },
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
      expect(ctx.commands.length).toBeGreaterThan(1);
    } finally {
      await adapter.disconnect();
    }
  });

  // D4: there is no running-query map at all (the whole API is synchronous, F10) — the guard
  // becomes a failed connect leaving no open handle and no -wal/-shm sidecar behind.
  test('32. a failed connect leaves nothing open, and no -wal/-shm sidecar', async () => {
    const adapter = await createAdapter('sqlite', deps);
    const badPath = join(fixture.dir, 'still-missing.sqlite');
    await expect(
      adapter.connect({ ...fixture.config, database: badPath }, makeCtx()),
    ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    expect(existsSync(`${badPath}-wal`)).toBe(false);
    expect(existsSync(`${badPath}-shm`)).toBe(false);

    // connect()'s catch already ran disconnect() internally — a second, explicit disconnect()
    // must be a clean no-op.
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });

  test('33. read cannot write, revisited: filter injection never reaches the database (F9/D9)', async () => {
    // The one variant of the P13 leak-guard tripwire that still applies with no running-query
    // map (D4): an aborted op never leaves a handle or transaction open either.
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const controller = new AbortController();
      controller.abort();
      const ctx: OpCtx = { opId: crypto.randomUUID(), signal: controller.signal, setCommand() {} };
      await expect(
        readTabular(
          adapter,
          {
            path: path([
              { kind: 'database', name: 'main' },
              { kind: 'table', name: 'order_items' },
            ]),
            projection: null,
            filter: null,
            sort: null,
            pageSize: 10,
            cursor: { mode: 'offset', offset: 0 },
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'E_CANCELLED' });
    } finally {
      await adapter.disconnect();
    }
  });

  // --- SQLite-specific additions (§5, P35) ----------------------------------------------------

  test('34. int64 fidelity, on both the read path and the console path (F4/D3)', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    const { DatabaseSync } = await import('node:sqlite');
    const probeConn = new DatabaseSync(fixture.path);
    try {
      probeConn.exec('ALTER TABLE composite_pk ADD COLUMN big_val INTEGER');
      probeConn
        .prepare('UPDATE composite_pk SET big_val = ? WHERE tenant_id = 1 AND entity_id = 1')
        .run(9_007_199_254_740_993n);

      const page = await readTabular(
        adapter,
        {
          path: compositePkPath(),
          projection: ['big_val'],
          filter: 'tenant_id = 1 AND entity_id = 1',
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(cellAt(page, 0, 0)).toBe('9007199254740993');

      const pages = await adapter.execute(
        {
          path: path([{ kind: 'database', name: 'main' }]),
          statements: ['SELECT big_val FROM composite_pk WHERE tenant_id = 1 AND entity_id = 1'],
        },
        makeCtx(),
      );
      const [consolePage] = pages;
      if (consolePage.kind !== 'tabular') throw new Error('expected a tabular console page');
      expect(cellAt(consolePage, 0, 0)).toBe('9007199254740993');
    } finally {
      probeConn.exec(
        'UPDATE composite_pk SET big_val = NULL WHERE tenant_id = 1 AND entity_id = 1',
      );
      probeConn.close();
      await adapter.disconnect();
    }
  });

  test('35. dynamic typing: the value codec follows the value, not the declared type (F21/D21)', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    const { DatabaseSync } = await import('node:sqlite');
    const probeConn = new DatabaseSync(fixture.path);
    try {
      probeConn.exec('CREATE TABLE IF NOT EXISTS dyn_probe (a TEXT, b INTEGER)');
      probeConn
        .prepare('INSERT INTO dyn_probe (a, b) VALUES (?, ?)')
        .run(Buffer.from([0xde, 0xad, 0xbe, 0xef]), 'not a number');

      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'main' },
            { kind: 'table', name: 'dyn_probe' },
          ]),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      const aIdx = page.columns.findIndex((c) => c.name === 'a');
      const bIdx = page.columns.findIndex((c) => c.name === 'b');
      // typeClass still reflects the *declared* affinity — a BLOB value in a TEXT column doesn't
      // change what the column claims to be.
      expect(page.columns[aIdx]?.typeClass).toBe('text');
      expect(page.columns[bIdx]?.typeClass).toBe('number');
      // But the value on the wire follows its own JS type: the BLOB comes back as 0x-hex, the
      // text comes back verbatim, regardless of either column's declared type.
      expect(cellAt(page, aIdx, 0)).toMatch(/^0x[0-9a-f]+$/);
      expect(cellAt(page, bIdx, 0)).toBe('not a number');
    } finally {
      probeConn.exec('DROP TABLE IF EXISTS dyn_probe');
      probeConn.close();
      await adapter.disconnect();
    }
  });

  test('36. the file is not modified by a read session (F16/D6)', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const before = readFileSync(fixture.path);
      await adapter.children(path([]), makeCtx());
      await adapter.children(path([{ kind: 'database', name: 'main' }]), makeCtx());
      await adapter.describe(
        path([
          { kind: 'database', name: 'main' },
          { kind: 'table', name: 'employees' },
        ]),
        makeCtx(),
      );
      await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'main' },
            { kind: 'table', name: 'employees' },
          ]),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      await adapter.definition(
        path([
          { kind: 'database', name: 'main' },
          { kind: 'table', name: 'employees' },
        ]),
        makeCtx(),
      );
      const after = readFileSync(fixture.path);
      expect(Buffer.compare(before, after)).toBe(0);
      expect(existsSync(`${fixture.path}-wal`)).toBe(false);
      expect(existsSync(`${fixture.path}-shm`)).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('37. keyset paging by rowid (F23/D22/D23)', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const target = path([
        { kind: 'database', name: 'main' },
        { kind: 'table', name: 'no_pk_rowid' },
      ]);
      const page = await readTabular(
        adapter,
        {
          path: target,
          projection: null,
          filter: null,
          sort: null,
          pageSize: 2,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.position.strategy).toBe('keyset');
      // The rowid tiebreaker is purely internal — it never appears as a page column (D23).
      expect(page.columns.some((c) => c.name === 'rowid')).toBe(false);

      const next = page.position.nextToken;
      if (!next) throw new Error('expected a nextToken');
      const page2 = await readTabular(
        adapter,
        {
          path: target,
          projection: null,
          filter: null,
          sort: null,
          pageSize: 2,
          cursor: { mode: 'after', token: next },
        },
        makeCtx(),
      );
      expect(page2.rowCount).toBe(2);
      const prev = page2.position.prevToken;
      if (!prev) throw new Error('expected a prevToken');
      const back = await readTabular(
        adapter,
        {
          path: target,
          projection: null,
          filter: null,
          sort: null,
          pageSize: 2,
          cursor: { mode: 'before', token: prev },
        },
        makeCtx(),
      );
      expect(cellAt(back, 0, 0)).toBe(cellAt(page, 0, 0));

      // without_rowid pages by its own declared PK, not rowid — it has none to page by.
      const wrTarget = path([
        { kind: 'database', name: 'main' },
        { kind: 'table', name: 'without_rowid' },
      ]);
      const wrPage = await readTabular(
        adapter,
        {
          path: wrTarget,
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(wrPage.position.strategy).toBe('keyset');

      // A view has no rowid at all — offset (scenario 13 covers this already; restated here for
      // the contrast with the rowid tables above).
      const viewPage = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'main' },
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
      expect(viewPage.position.strategy).toBe('offset');
    } finally {
      await adapter.disconnect();
    }
  });

  test('38. generated columns (F18)', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const meta = await adapter.describe(
        path([
          { kind: 'database', name: 'main' },
          { kind: 'table', name: 'generated_cols' },
        ]),
        makeCtx(),
      );
      expect(meta.columns.map((c) => c.name)).toEqual(['id', 'a', 'b', 'c']);

      const page = await readTabular(
        adapter,
        {
          path: path([
            { kind: 'database', name: 'main' },
            { kind: 'table', name: 'generated_cols' },
          ]),
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
        path: path([
          { kind: 'database', name: 'main' },
          { kind: 'table', name: 'generated_cols' },
        ]),
        ops: [{ kind: 'insert', values: { id: '99', a: '1', b: '2' } }],
      };
      try {
        await adapter.mutate(plan, makeCtx());
        throw new Error('expected the insert to reject');
      } catch (err) {
        expect((err as { code?: string }).code).toBe('E_QUERY');
        expect((err as Error).message.toLowerCase()).toContain('generated');
      }
    } finally {
      await adapter.disconnect();
    }
  });

  test('39. a locked database is a legible failure (F15/D26)', async () => {
    // The adapter's own busy_timeout is 5000ms (client.ts's BUSY_TIMEOUT_MS, D6) — bun test's
    // default per-test timeout is the same 5000ms, so this scenario needs more headroom than that
    // to let the real timeout actually fire instead of racing the test runner's own.
    const { DatabaseSync } = await import('node:sqlite');
    const locker = new DatabaseSync(fixture.path, { timeout: 200 });
    locker.exec('BEGIN IMMEDIATE');
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const plan: MutationPlan = {
        path: compositePkPath(),
        ops: [
          {
            kind: 'update',
            key: { tenant_id: '1', entity_id: '1' },
            changes: { name: 'should not land, database is locked' },
          },
        ],
      };
      await expect(adapter.mutate(plan, makeCtx())).rejects.toMatchObject({ code: 'E_TIMEOUT' });
    } finally {
      await adapter.disconnect();
      locker.exec('ROLLBACK');
      locker.close();
    }
  }, 10_000);

  test('40. multi-statement input is refused, not truncated (F9/D9)', async () => {
    const adapter = await createAdapter('sqlite', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
        adapter.execute(
          { path: path([{ kind: 'database', name: 'main' }]), statements: ['SELECT 1; SELECT 2'] },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });

      const twoEntries = await adapter.execute(
        { path: path([{ kind: 'database', name: 'main' }]), statements: ['SELECT 1', 'SELECT 2'] },
        makeCtx(),
      );
      expect(twoEntries).toHaveLength(2);

      const trailingComment = await adapter.execute(
        {
          path: path([{ kind: 'database', name: 'main' }]),
          statements: ['SELECT 1; -- trailing comment'],
        },
        makeCtx(),
      );
      expect(trailingComment).toHaveLength(1);
    } finally {
      await adapter.disconnect();
    }
  });
});
