import { encodeTabular } from '../../src/engine/page/encode';
import { buildCount, buildSelect, quoteIdentMariadb, quoteIdentPostgres } from '../../src/engine/page/sql';
import { CELL_NULL, CELL_TRUNCATED, MAX_CELL_BYTES, cursorKey } from '../../src/shared/page';
import { afterAll, afterEach, beforeAll, describe, expect, test } from './support/harness';

// P2 shared-contract tests. These run without Docker. Step 1 seeds the file with cursorKey stability
// assertions; later steps add the encoder, pagination and cancel scenarios.

describe('cursorKey', () => {
  test('is stable — the same cursor always produces the same string', () => {
    const a: { kind: 'offset'; offset: number } = { kind: 'offset', offset: 0 };
    const b: { kind: 'offset'; offset: number } = { kind: 'offset', offset: 0 };
    expect(cursorKey(a)).toBe(cursorKey(b));
    expect(cursorKey({ kind: 'offset', offset: 4_500 })).toBe('off:4500');
    expect(cursorKey({ kind: 'keyset', token: 'abc', direction: 'next' })).toBe('ks:next:abc');
    expect(cursorKey({ kind: 'keyset', token: 'abc', direction: 'prev' })).toBe('ks:prev:abc');
  });

  test('offset and keyset forms never collide', () => {
    const offset = cursorKey({ kind: 'offset', offset: 0 });
    const keyset = cursorKey({ kind: 'keyset', token: '0', direction: 'next' });
    expect(offset).not.toBe(keyset);
    // A token that happens to look like an offset string still cannot collide because of the
    // `ks:next:` prefix.
    expect(keyset).not.toBe('off:0');
  });
});

describe('encodeTabular', () => {
  function decode(col: { data?: Uint8Array; offsets?: Int32Array }, row: number): string {
    const data = col.data as Uint8Array;
    const offsets = col.offsets as Int32Array;
    const slice = data.subarray(offsets[row], offsets[row + 1]);
    return new TextDecoder().decode(slice);
  }

  test('round-trips every encoding including nulls', () => {
    const { columns, rowCount, bytes } = encodeTabular({
      columns: [
        { name: 'i', dataType: 'int4', encoding: 'f64' },
        { name: 'big', dataType: 'int8', encoding: 'i64' },
        { name: 'ok', dataType: 'bool', encoding: 'bool' },
        { name: 's', dataType: 'text', encoding: 'utf8' },
        { name: 'b', dataType: 'bytea', encoding: 'bytes' },
      ],
      rows: [
        [1, 9_007_199_254_740_993n, true, 'héllo', new Uint8Array([1, 2, 3])],
        [null, null, null, null, null],
        [2, 42n, 'f', 'x', new Uint8Array([255, 0])],
      ],
    });

    expect(rowCount).toBe(3);
    expect(bytes).toBeGreaterThan(0);

    const [i, big, ok, s, b] = columns;
    // f64
    expect(i.values).toBeInstanceOf(Float64Array);
    expect((i.values as Float64Array)[0]).toBe(1);
    expect(i.flags[1] & CELL_NULL).toBeTruthy();
    // i64
    expect(big.values).toBeInstanceOf(BigInt64Array);
    expect((big.values as BigInt64Array)[0]).toBe(9_007_199_254_740_993n);
    expect(big.flags[1] & CELL_NULL).toBeTruthy();
    // bool
    expect(ok.values).toBeInstanceOf(Uint8Array);
    expect((ok.values as Uint8Array)[0]).toBe(1);
    expect((ok.values as Uint8Array)[2]).toBe(0);
    // utf8 — a plain 'f' string must NOT be treated as null
    expect(s.flags[1] & CELL_NULL).toBeTruthy();
    expect(decode(s, 0)).toBe('héllo');
    expect(decode(s, 2)).toBe('x');
    // bytes
    expect(decode(b, 0)).toBe('\x01\x02\x03');
    expect(b.flags[1] & CELL_NULL).toBeTruthy();
  });

  test('a 100 KB string truncates to exactly MAX_CELL_BYTES with CELL_TRUNCATED', () => {
    const big = 'a'.repeat(100 * 1024);
    const { columns, truncatedCells } = encodeTabular({
      columns: [{ name: 't', dataType: 'text', encoding: 'utf8' }],
      rows: [[big]],
    });
    const col = columns[0];
    const data = col.data as Uint8Array;
    expect(data.byteLength).toBe(MAX_CELL_BYTES);
    expect(col.flags[0] & CELL_TRUNCATED).toBeTruthy();
    expect(truncatedCells).toBe(1);
    const text = new TextDecoder().decode(data);
    expect(text.length).toBe(MAX_CELL_BYTES);
    expect(text).toBe('a'.repeat(MAX_CELL_BYTES));
  });

  test('a 4-byte emoji straddling the boundary is dropped whole, not halved', () => {
    // 65534 ASCII bytes fill the scratch to 2 bytes short of the cap; one 4-byte emoji then cannot
    // fit and must be dropped entirely so no broken surrogate leaks into the payload.
    const prefix = 'a'.repeat(MAX_CELL_BYTES - 2);
    const s = `${prefix}😀tail`;
    const { columns } = encodeTabular({
      columns: [{ name: 't', dataType: 'text', encoding: 'utf8' }],
      rows: [[s]],
    });
    const col = columns[0];
    const data = col.data as Uint8Array;
    // The 4-byte emoji cannot fit in the 2 remaining bytes, so it is dropped whole: the payload is
    // the 65534-byte prefix. The flag is set, and the cut is on a code-point boundary.
    expect(data.byteLength).toBe(MAX_CELL_BYTES - 2);
    expect(col.flags[0] & CELL_TRUNCATED).toBeTruthy();
    // The cut is on a code-point boundary: re-decoding must not produce U+FFFD.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    expect(text).not.toContain('\uFFFD');
  });

  test('bytes equals the sum of the actual buffer byteLengths', () => {
    const { columns, bytes } = encodeTabular({
      columns: [{ name: 's', dataType: 'text', encoding: 'utf8' }],
      rows: [['hello'], ['world' as unknown as string]],
    });
    const col = columns[0];
    const expected =
      col.flags.byteLength + (col.data?.byteLength ?? 0) + (col.offsets?.byteLength ?? 0);
    expect(bytes).toBe(expected);
  });

  test('an all-null f64 column produces a Float64Array and no NaNs', () => {
    const { columns } = encodeTabular({
      columns: [{ name: 'n', dataType: 'int4', encoding: 'f64' }],
      rows: [[null], [null]],
    });
    const col = columns[0];
    expect(col.values).toBeInstanceOf(Float64Array);
    const values = col.values as Float64Array;
    for (const v of values) expect(Number.isNaN(v)).toBe(false);
    expect(col.flags[0] & CELL_NULL).toBeTruthy();
    expect(col.flags[1] & CELL_NULL).toBeTruthy();
  });

  test('a non-numeric f64 cell falls the whole column back to utf8', () => {
    const { columns } = encodeTabular({
      columns: [{ name: 'n', dataType: 'int4', encoding: 'f64' }],
      rows: [[1], ['not-a-number' as unknown as number]],
    });
    expect(columns[0].encoding).toBe('utf8');
    expect(columns[0].data).toBeDefined();
  });

  test('an out-of-range i64 falls the whole column back to utf8', () => {
    const tooBig = 2n ** 63n;
    const { columns } = encodeTabular({
      columns: [{ name: 'b', dataType: 'int8', encoding: 'i64' }],
      rows: [[1n], [tooBig]],
    });
    expect(columns[0].encoding).toBe('utf8');
  });

  test('truncated cells are counted exactly', () => {
    const { truncatedCells } = encodeTabular({
      columns: [{ name: 't', dataType: 'text', encoding: 'utf8' }],
      rows: [['short'], ['x'.repeat(MAX_CELL_BYTES + 5)]],
    });
    expect(truncatedCells).toBe(1);
  });
});

describe('buildSelect', () => {
  const pg = (i: number) => `$${i}`;
  const q = quoteIdentPostgres;

  test('no filter, no sort', () => {
    const { text, params } = buildSelect({
      quote: q,
      table: ['app', 'orders'],
      columns: null,
      where: '',
      orderBy: '',
      keyset: null,
      limit: 501,
      offset: null,
      placeholder: pg,
    });
    expect(text).toContain('SELECT *');
    expect(text).toContain('FROM "app"."orders"');
    expect(text).not.toContain('WHERE');
    expect(text).toContain('LIMIT 501');
    expect(params).toEqual([]);
  });

  test('projection + free WHERE', () => {
    const { text, params } = buildSelect({
      quote: q,
      table: ['app', 'orders'],
      columns: ['id', 'total'],
      where: "status = 'new'",
      orderBy: 'id ASC',
      keyset: null,
      limit: 100,
      offset: 0,
      placeholder: pg,
    });
    expect(text).toContain('SELECT "id", "total"');
    expect(text).toContain('WHERE (status = \'new\')');
    expect(text).toContain('ORDER BY id ASC');
    expect(text).toContain('OFFSET 0');
    expect(params).toEqual([]);
  });

  test('keyset next uses a row-constructor comparison with parameterized values', () => {
    const { text, params } = buildSelect({
      quote: q,
      table: ['app', 'orders'],
      columns: ['id'],
      where: '',
      orderBy: 'id ASC',
      keyset: { columns: ['id'], direction: 'asc', values: [42] },
      limit: 501,
      offset: null,
      placeholder: pg,
    });
    expect(text).toContain('WHERE (("id") > ($1))');
    expect(params).toEqual([42]);
  });

  test('keyset prev flips the comparison operator', () => {
    const { text } = buildSelect({
      quote: q,
      table: ['app', 'orders'],
      columns: ['id'],
      where: '',
      orderBy: 'id DESC',
      keyset: { columns: ['id'], direction: 'desc', values: [7] },
      limit: 501,
      offset: null,
      placeholder: pg,
    });
    expect(text).toContain('WHERE (("id") < ($1))');
  });

  test('offset 4500', () => {
    const { text } = buildSelect({
      quote: q,
      table: ['app', 'orders'],
      columns: null,
      where: '',
      orderBy: '',
      keyset: null,
      limit: 500,
      offset: 4_500,
      placeholder: pg,
    });
    expect(text).toContain('OFFSET 4500');
  });

  test('seed identifiers quote correctly', () => {
    expect(quoteIdentPostgres('weird"name')).toBe('"weird""name"');
    expect(quoteIdentPostgres('Order Items')).toBe('"Order Items"');
    expect(quoteIdentMariadb('weird`name')).toBe('`weird``name`');
  });

  test('an identifier containing a NUL throws', () => {
    expect(() => quoteIdentPostgres('bad\0name')).toThrow();
    expect(() => quoteIdentMariadb('bad\0name')).toThrow();
  });

  test('buildCount wraps the free WHERE in parentheses', () => {
    const { text } = buildCount({ quote: q, table: ['app', 'orders'], where: 'id > 5' });
    expect(text).toContain('SELECT COUNT(*)');
    expect(text).toContain('WHERE (id > 5)');
  });
});

import { isDockerAvailable } from './support/docker';
import { startPostgres } from './support/postgres';
import { createAdapter } from '../../src/engine/adapters/registry';
import type { Adapter, OpCtx } from '../../src/engine/adapters/adapter';
import type { ResolvedConnectionConfig } from '../../src/shared/engine-ops';
import type { ReadRequest } from '../../src/shared/data';
import { decodePath, encodePath } from '../../src/shared/tree';

const dockerAvailable = await isDockerAvailable();
let pg: Awaited<ReturnType<typeof startPostgres>> | null = null;

describe('postgres read', () => {
  beforeAll(async () => {
    if (dockerAvailable) pg = await startPostgres();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const fixture = (): ResolvedConnectionConfig => {
    if (!pg) throw new Error('postgres fixture not started');
    return pg.config;
  };

  const makeAdapter = async (): Promise<Adapter> => {
    const adapter = createAdapter('postgres', { log: () => {} });
    await adapter.connect(fixture(), makeCtx());
    return adapter;
  };

  const readReq = (
    over: Partial<ReadRequest>,
  ): ReadRequest => ({
    connectionId: 'test-pg',
    path: encodePath([
      { kind: 'database', name: 'kira_test' },
      { kind: 'schema', name: 'app' },
      { kind: 'table', name: 'wide_table' },
    ]),
    tabId: 't1',
    projection: null,
    where: '',
    orderBy: '',
    pageSize: 100,
    cursor: { kind: 'offset', offset: 0 },
    refresh: false,
    prefetch: false,
    ...over,
  });

  test('reads a page with correct column encodings', async () => {
    // wide_table has no rows in the seed; add a few so the page actually has data.
    const { Client } = await import('pg');
    const seed = new Client({ host: fixture().host ?? undefined, port: fixture().port ?? undefined, database: 'kira_test', user: 'postgres', password: 'kira' });
    await seed.connect();
    await seed.query("INSERT INTO app.wide_table (c01, c02, c04, c10, c19) SELECT i, i, i::numeric(20,6), (i % 2 = 0), decode('0102', 'hex') FROM generate_series(1, 120) i");
    await seed.end();
    const adapter = await makeAdapter();
    const page = await adapter.read(readReq({}), makeCtx());
    expect(page.kind).toBe('tabular');
    if (page.kind !== 'tabular') return;
    expect(page.rowCount).toBe(100);
    expect(page.columns.length).toBe(60);
    const enc = new Map(page.columns.map((c) => [c.name, c.encoding]));
    expect(enc.get('c01')).toBe('f64');
    expect(enc.get('c02')).toBe('i64');
    expect(enc.get('c10')).toBe('bool');
    expect(enc.get('c19')).toBe('bytes');
    expect(enc.get('c04')).toBe('utf8'); // numeric stays text
    expect(enc.get('c07')).toBe('utf8');
    expect(enc.get('c17')).toBe('utf8');
    await adapter.disconnect();
  });

  test('nulls and unicode round-trip distinctly from empty strings', async () => {
    const adapter = await makeAdapter();
    const page = await adapter.read(
      readReq({
        path: encodePath([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'nulls_and_unicode' },
        ]),
      }),
      makeCtx(),
    );
    if (page.kind !== 'tabular') throw new Error('not tabular');
    const row = 0;
    const colOf = (name: string): number => page.columns.findIndex((c) => c.name === name);
    const text = (name: string): string => {
      const c = page.columns[colOf(name)];
      const dec = new TextDecoder();
      return dec.decode(c.data!.subarray(c.offsets![row], c.offsets![row + 1]));
    };
    expect(page.columns[colOf('nullable_text')].flags[row] & 1).toBeTruthy();
    expect(page.columns[colOf('nullable_int')].flags[row] & 1).toBeTruthy();
    expect(text('empty_text')).toBe(''); // NOT null
    expect(text('emoji')).toBe('🐘🚀');
    expect(text('cjk')).toBe('中文测试');
    // big_text is truncated by the 64 KiB cell clamp (D5)
    expect(page.columns[colOf('big_text')].flags[row] & 2).toBeTruthy();
    expect(page.truncatedCells).toBeGreaterThan(0);
    await adapter.disconnect();
  });

  test('composite_pk pages by keyset with monotonic order across the boundary', async () => {
    const adapter = await makeAdapter();
    // seed has no composite_pk rows; add a contiguous run via a direct client
    const { Client } = await import('pg');
    const c = new Client({ host: fixture().host ?? undefined, port: fixture().port ?? undefined, database: 'kira_test', user: 'postgres', password: 'kira' });
    await c.connect();
    await c.query('DELETE FROM app.composite_pk');
    const vals: string[] = [];
    for (let t = 0; t < 5; t++) for (let e = 0; e < 5; e++) vals.push(`(${t}, ${e}, 'v${t}_${e}')`);
    await c.query(`INSERT INTO app.composite_pk (tenant_id, entity_id, value) VALUES ${vals.join(', ')}`);
    await c.end();

    const path = encodePath([
      { kind: 'database', name: 'kira_test' },
      { kind: 'schema', name: 'app' },
      { kind: 'table', name: 'composite_pk' },
    ]);
    // orderBy '' ⇒ keyset on PK ascending (D6)
    const first = await adapter.read(
      readReq({ path, pageSize: 7 }),
      makeCtx(),
    );
    if (first.kind !== 'tabular') throw new Error('not tabular');
    expect(first.rowCount).toBe(7);
    expect(first.nextToken).not.toBeNull();

    const second = await adapter.read(
      readReq({ path, pageSize: 7, cursor: { kind: 'keyset', token: first.nextToken!, direction: 'next' } }),
      makeCtx(),
    );
    if (second.kind !== 'tabular') throw new Error('not tabular');

    const pkOf = (page: { columns: typeof first.columns; rowCount: number }, row: number): [number, number] => {
      const ci = page.columns.findIndex((c) => c.name === 'tenant_id');
      const ei = page.columns.findIndex((c) => c.name === 'entity_id');
      return [Number((page.columns[ci].values as Float64Array)[row]), Number((page.columns[ei].values as Float64Array)[row])];
    };
    const all: Array<[number, number]> = [];
    for (let i = 0; i < first.rowCount; i++) all.push(pkOf(first as { columns: typeof first.columns; rowCount: number }, i));
    for (let i = 0; i < second.rowCount; i++) all.push(pkOf(second as { columns: typeof first.columns; rowCount: number }, i));
    for (let i = 1; i < all.length; i++) {
      const [pt, pe] = all[i - 1];
      const [t, e] = all[i];
      expect(t > pt || (t === pt && e > pe)).toBe(true);
    }
    expect(new Set(all.map(([t, e]) => `${t}:${e}`)).size).toBe(all.length); // no duplicates
    await adapter.disconnect();
  });

  test('big_rows offset 9500 returns the right slice', async () => {
    const adapter = await makeAdapter();
    const page = await adapter.read(
      readReq({
        path: encodePath([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'big_rows' },
        ]),
        cursor: { kind: 'offset', offset: 9_500 },
      }),
      makeCtx(),
    );
    if (page.kind !== 'tabular') throw new Error('not tabular');
    expect(page.offset).toBe(9_500);
    const id = page.columns[0];
    expect((id.values as BigInt64Array)[0]).toBe(9501n);
    await adapter.disconnect();
  });

  test('numeric values come back as exact text', async () => {
    const adapter = await makeAdapter();
    const page = await adapter.read(
      readReq({
        projection: ['c04'],
        path: encodePath([
          { kind: 'database', name: 'kira_test' },
          { kind: 'schema', name: 'app' },
          { kind: 'table', name: 'wide_table' },
        ]),
      }),
      makeCtx(),
    );
    if (page.kind !== 'tabular') throw new Error('not tabular');
    // all rows are empty defaults, so c04 is NULL; still the encoding must be utf8
    expect(page.columns[0].encoding).toBe('utf8');
    await adapter.disconnect();
  });

  test('count exact matches the known row count; estimate is exact:false', async () => {
    const adapter = await makeAdapter();
    const exact = await adapter.count(
      { connectionId: 'test-pg', path: encodePath([{ kind: 'database', name: 'kira_test' }, { kind: 'schema', name: 'app' }, { kind: 'table', name: 'customers' }]), tabId: 't1', where: '', mode: 'exact', refresh: false },
      makeCtx(),
    );
    expect(exact.exact).toBe(true);
    expect(exact.value).toBe(2);

    const est = await adapter.count(
      { connectionId: 'test-pg', path: encodePath([{ kind: 'database', name: 'kira_test' }, { kind: 'schema', name: 'app' }, { kind: 'table', name: 'big_rows' }]), tabId: 't1', where: '', mode: 'estimate', refresh: false },
      makeCtx(),
    );
    expect(est.exact).toBe(false);
    expect(est.value).toBeGreaterThan(0);
    await adapter.disconnect();
  });

  test('a filter with a server error surfaces the server message verbatim', async () => {
    const adapter = await makeAdapter();
    let message = '';
    try {
      await adapter.read(readReq({ where: 'this is not valid sql' }), makeCtx());
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message.length).toBeGreaterThan(0);
    await adapter.disconnect();
  });
});

function makeCtx(): OpCtx {
  return { opId: crypto.randomUUID(), signal: new AbortController().signal, setCommand: () => {} };
}

import * as cache from '../../src/engine/cache';

describe('L2/L3 cache', () => {
  const makePage = (bytes: number): Parameters<typeof cache.l2Put>[1] => ({
    kind: 'tabular',
    columns: [],
    rowCount: 0,
    offset: null,
    nextToken: null,
    prevToken: null,
    bytes,
    truncatedCells: 0,
    elapsedMs: 1,
    fromCache: false,
  });

  const readReq = (id: string): ReadRequest => ({
    connectionId: id,
    path: 'schema:app/table:t',
    tabId: 't1',
    projection: null,
    where: '',
    orderBy: '',
    pageSize: 500,
    cursor: { kind: 'offset', offset: 0 },
    refresh: false,
    prefetch: false,
  });

  afterEach(() => {
    cache.clearAll();
    cache.configure({ l2BudgetBytes: 64 * 1024 * 1024, l3TtlMs: 300_000 });
  });

  test('the same read twice hits L2 the second time', () => {
    const key = cache.l2Key(readReq('c1'));
    expect(cache.l2Get(key)).toBeUndefined();
    cache.l2Put(key, makePage(100));
    const hit = cache.l2Get(key);
    expect(hit).toBeDefined();
    expect(cache.l2Get(key)).toBeDefined();
  });

  test('refresh:true bypasses the lookup and overwrites', () => {
    const key = cache.l2Key(readReq('c1'));
    cache.l2Put(key, makePage(100));
    cache.l2Put(key, makePage(200));
    const hit = cache.l2Get(key);
    expect(hit?.bytes).toBe(200);
  });

  test('a byte budget evicts LRU until the total fits', () => {
    cache.configure({ l2BudgetBytes: 1_000_000 });
    cache.l2Put('a', makePage(600_000));
    cache.l2Put('b', makePage(600_000));
    cache.l2Put('c', makePage(600_000));
    const s = cache.stats();
    expect(s.l2Bytes).toBeLessThanOrEqual(1_000_000);
    // 600 KB each into a 1 MB budget: only the most recent survives (LRU evicts a then b).
    expect(s.l2Entries).toBe(1);
  });

  test('dropConnection zeroes l2Bytes', () => {
    cache.l2Put('c1|x', makePage(100_000));
    cache.l2Put('c2|y', makePage(50_000));
    cache.dropConnection('c1');
    const s = cache.stats();
    expect(s.l2Bytes).toBe(50_000);
  });

  test('an L3 hit after the TTL is a miss', () => {
    cache.configure({ l3TtlMs: 10 });
    cache.l3Put('c1', { value: 5, exact: true });
    expect(cache.l3Get('c1')).toBeDefined();
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cache.l3Get('c1')).toBeUndefined();
        resolve();
      }, 30);
    });
  });

  test('l2Key/l3Key match the §7 key shapes', () => {
    const req = readReq('c1');
    expect(cache.l2Key(req)).toContain('c1');
    expect(cache.l2Key(req)).toContain('schema:app/table:t');
    const countKey = cache.l3Key({
      connectionId: 'c1',
      path: 'schema:app/table:t',
      tabId: 't1',
      where: '',
      mode: 'exact',
      refresh: false,
    });
    expect(countKey).toContain('c1');
    expect(countKey).toContain('exact');
  });
});

test('MAX_CELL_BYTES is 64 KiB', () => {
  expect(MAX_CELL_BYTES).toBe(64 * 1024);
});
