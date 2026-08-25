import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { MutationPlan } from '@shared/domain/mutations';
import { encodePath, type NodePath } from '@shared/domain/tree';
import { cellText, type KeyValuePage } from '@shared/protocol/page';
import type { AdapterDeps, OpCtx } from '../../src/engine/adapters/adapter';
import { deleteLiveAdapter, setLiveAdapter } from '../../src/engine/adapters/live';
import { redisCaps } from '../../src/engine/adapters/redis/caps';
import { createAdapter } from '../../src/engine/adapters/registry';
import { handleMutate, handleRead } from '../../src/engine/data';
import {
  BIG_LIST_KEY,
  BIG_LIST_LENGTH,
  HASH_FIELDS,
  HASH_KEY,
  LIST_KEY,
  LIST_LENGTH,
  SET_KEY,
  SET_MEMBERS,
  STREAM_ENTRY_COUNT,
  STREAM_KEY,
  TTL_KEY,
  ZSET_KEY,
  ZSET_MEMBERS,
} from './fixtures/0004_redis_seed';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from './support/docker';
import { readKeyValue } from './support/page';
import {
  REDIS_PRIMARY_DB_INDEX,
  REDIS_SECONDARY_DB_INDEX,
  type RedisFixture,
  startRedis,
} from './support/redis';

const CONTAINER_START_TIMEOUT_MS = 180_000;
const PRIMARY_DB_NAME = `db${REDIS_PRIMARY_DB_INDEX}`;
const SECONDARY_DB_NAME = `db${REDIS_SECONDARY_DB_INDEX}`;

const deps: AdapterDeps = {
  log(level, message) {
    if (level === 'error') console.error(`[redis adapter] ${message}`);
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
  return { connectionId: 'test-redis', segments };
}

function keyPath(key: string): NodePath {
  // resolveKeyTarget() only ever reads the first (database) and last (key) segment — a 'key'
  // leaf's own name is already the complete literal key (P9's D3), so no intermediate
  // 'namespace' segments are needed to read/count it.
  return path([
    { kind: 'database', name: PRIMARY_DB_NAME },
    { kind: 'key', name: key },
  ]);
}

const decoder = new TextDecoder();

function kvFieldAt(page: KeyValuePage, row: number): string {
  return cellText(page.fields, row, decoder);
}

function kvValueAt(page: KeyValuePage, row: number): string {
  return cellText(page.values, row, decoder);
}

function kvPairs(page: KeyValuePage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let r = 0; r < page.rowCount; r++) out[kvFieldAt(page, r)] = kvValueAt(page, r);
  return out;
}

let fixture: RedisFixture;

beforeAll(async () => {
  if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
  fixture = await startRedis();
}, CONTAINER_START_TIMEOUT_MS);

afterAll(async () => {
  await fixture?.stop();
});

describe('redis adapter (§9.1, P9)', () => {
  test('1. connect / disconnect', async () => {
    const adapter = await createAdapter('redis', deps);
    const info = await adapter.connect(fixture.config, makeCtx());
    expect(info.serverVersion).toMatch(/^Redis \d/);
    await adapter.disconnect();

    await expect(adapter.children(path([]), makeCtx())).rejects.toMatchObject({
      code: 'E_CONNECT',
    });
  });

  test('2. auth failure', async () => {
    const adapter = await createAdapter('redis', deps);
    const badConfig = { ...fixture.config, password: 'definitely-wrong' };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({
      code: 'E_AUTH',
    });
  });

  test('3. tree enumeration: dbs, namespaces, keys', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const { nodes: dbs } = await adapter.children(path([]), makeCtx());
      expect(dbs.map((n) => n.name)).toEqual([PRIMARY_DB_NAME, SECONDARY_DB_NAME]);
      expect(dbs.every((n) => n.kind === 'database')).toBe(true);

      const rootResult = await adapter.children(
        path([{ kind: 'database', name: PRIMARY_DB_NAME }]),
        makeCtx(),
      );
      const root = rootResult.nodes;
      // P43 iter2 F16/D21: an ordinary listing (well under MAX_SCAN_ROUNDS) never sets
      // `truncated` — the guard that the widening left the normal path unchanged.
      expect(rootResult.truncated).toBeUndefined();
      const rootNamespaces = root.filter((n) => n.kind === 'namespace').map((n) => n.name);
      const rootKeys = root.filter((n) => n.kind === 'key').map((n) => n.name);
      expect(rootNamespaces).toEqual(['events', 'queue', 'session', 'tags', 'user']);
      expect(rootKeys).toEqual(['counter', 'leaderboard']);

      const { nodes: userChildren } = await adapter.children(
        path([
          { kind: 'database', name: PRIMARY_DB_NAME },
          { kind: 'namespace', name: 'user' },
        ]),
        makeCtx(),
      );
      expect(userChildren.map((n) => n.name)).toEqual(['1', '2']);
      expect(userChildren.every((n) => n.kind === 'namespace')).toBe(true);

      const { nodes: user1Children } = await adapter.children(
        path([
          { kind: 'database', name: PRIMARY_DB_NAME },
          { kind: 'namespace', name: 'user' },
          { kind: 'namespace', name: '1' },
        ]),
        makeCtx(),
      );
      // Leaf 'key' nodes store the complete literal key, not just the local segment (D3).
      expect(user1Children.map((n) => n.name)).toEqual(['user:1:email', 'user:1:name', HASH_KEY]);
      expect(user1Children.every((n) => n.kind === 'key' && n.hasChildren === false)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  });

  test('4. cap honesty', () => {
    expect(redisCaps.tabular).toBe(false);
    expect(redisCaps.keyValue).toBe(true);
    expect(redisCaps.keyBrowser).toBe(true); // P41: unbounded namespace tree, browsed in a tab
    expect(redisCaps.defaultPageKind).toBe('keyvalue');
    expect(redisCaps.definition).toBe(false);
    expect(redisCaps.exactCount).toBe(true);
    expect(redisCaps.pagination).toBe('cursor');
    expect(redisCaps.cancel).toBe(true);
    expect(redisCaps.writable).toBe(true);
    expect(redisCaps.fileTransfer).toBe(false);
  });

  test('5. children of a leaf', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const { nodes: children } = await adapter.children(
        path([
          { kind: 'database', name: PRIMARY_DB_NAME },
          { kind: 'key', name: 'counter' },
        ]),
        makeCtx(),
      );
      expect(children).toEqual([]);
    } finally {
      await adapter.disconnect();
    }
  });

  test('6. describe/definition are unsupported', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(adapter.describe(keyPath('counter'), makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });
      await expect(adapter.definition(keyPath('counter'), makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });
    } finally {
      await adapter.disconnect();
    }
  });

  test('7. read: string', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readKeyValue(
        adapter,
        {
          path: keyPath('counter'),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.redisType).toBe('string');
      expect(page.rowCount).toBe(1);
      expect(page.position.strategy).toBe('offset');
      expect(page.ttlMs).toBeNull();
      expect(kvValueAt(page, 0)).toBe('42');
    } finally {
      await adapter.disconnect();
    }
  });

  test('8. read: hash', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readKeyValue(
        adapter,
        {
          path: keyPath(HASH_KEY),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 100,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.redisType).toBe('hash');
      expect(page.rowCount).toBe(Object.keys(HASH_FIELDS).length);
      expect(page.position.strategy).toBe('cursor');
      expect(page.position.hasMore).toBe(false);
      expect(kvPairs(page)).toEqual(HASH_FIELDS);
    } finally {
      await adapter.disconnect();
    }
  });

  test('9. read: set', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readKeyValue(
        adapter,
        {
          path: keyPath(SET_KEY),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 100,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.redisType).toBe('set');
      expect(page.rowCount).toBe(SET_MEMBERS.length);
      const members = Array.from({ length: page.rowCount }, (_, r) => kvValueAt(page, r)).sort();
      expect(members).toEqual([...SET_MEMBERS].sort());
    } finally {
      await adapter.disconnect();
    }
  });

  test('10. read: zset', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readKeyValue(
        adapter,
        {
          path: keyPath(ZSET_KEY),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 100,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.redisType).toBe('zset');
      expect(page.rowCount).toBe(ZSET_MEMBERS.length);
      const pairs = kvPairs(page);
      for (const [member, score] of ZSET_MEMBERS) expect(pairs[member]).toBe(String(score));
    } finally {
      await adapter.disconnect();
    }
  });

  test('11. read: list, genuine offset pagination', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const req = {
        path: keyPath(LIST_KEY),
        projection: null,
        filter: null,
        sort: null,
        pageSize: 10,
      };

      const page1 = await readKeyValue(
        adapter,
        { ...req, cursor: { mode: 'offset', offset: 0 } },
        makeCtx(),
      );
      expect(page1.redisType).toBe('list');
      expect(page1.position.strategy).toBe('offset');
      expect(page1.rowCount).toBe(10);
      expect(page1.position.hasMore).toBe(true);
      expect(kvFieldAt(page1, 0)).toBe('0');
      expect(kvValueAt(page1, 0)).toBe('job-0');
      expect(kvValueAt(page1, 9)).toBe('job-9');

      const page3 = await readKeyValue(
        adapter,
        { ...req, cursor: { mode: 'offset', offset: 20 } },
        makeCtx(),
      );
      expect(page3.rowCount).toBe(LIST_LENGTH - 20);
      expect(page3.position.hasMore).toBe(false);
      expect(kvFieldAt(page3, 0)).toBe('20');
      expect(kvValueAt(page3, 0)).toBe('job-20');
    } finally {
      await adapter.disconnect();
    }
  });

  test('12. read: stream, forward cursor pagination', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const req = {
        path: keyPath(STREAM_KEY),
        projection: null,
        filter: null,
        sort: null,
        pageSize: STREAM_ENTRY_COUNT - 1,
      };
      const page1 = await readKeyValue(
        adapter,
        { ...req, cursor: { mode: 'offset', offset: 0 } },
        makeCtx(),
      );
      expect(page1.redisType).toBe('stream');
      expect(page1.position.strategy).toBe('cursor');
      expect(page1.rowCount).toBe(STREAM_ENTRY_COUNT - 1);
      expect(page1.position.hasMore).toBe(true);
      const nextToken = page1.position.nextToken;
      if (!nextToken) throw new Error('expected a nextToken on a truncated stream page');

      const page2 = await readKeyValue(
        adapter,
        { ...req, cursor: { mode: 'after', token: nextToken } },
        makeCtx(),
      );
      expect(page2.rowCount).toBe(1);
      expect(page2.position.hasMore).toBe(false);
      expect(JSON.parse(kvValueAt(page2, 0))).toEqual({
        type: 'click',
        seq: String(STREAM_ENTRY_COUNT - 1),
      });

      await expect(
        readKeyValue(adapter, { ...req, cursor: { mode: 'before', token: nextToken } }, makeCtx()),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('13. read: cursor pagination is forward-only for hash/set/zset too', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
        readKeyValue(
          adapter,
          {
            path: keyPath(HASH_KEY),
            projection: null,
            filter: null,
            sort: null,
            pageSize: 100,
            cursor: { mode: 'before', token: 'anything' },
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('14. read: TTL and memory metadata', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readKeyValue(
        adapter,
        {
          path: keyPath(TTL_KEY),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.ttlMs).not.toBeNull();
      expect(page.ttlMs as number).toBeGreaterThan(0);
      expect(page.ttlMs as number).toBeLessThanOrEqual(10_000 * 1000);
      // Best-effort (§8.8) — MEMORY USAGE is supported by the redis:7 image, so this should
      // resolve to a real measurement rather than the null fallback.
      expect(typeof page.memoryBytes).toBe('number');
    } finally {
      await adapter.disconnect();
    }
  });

  test('15. read: a vanished/nonexistent key is E_QUERY, not E_NOT_FOUND', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
        readKeyValue(
          adapter,
          {
            path: keyPath('this-key-was-never-set'),
            projection: null,
            filter: null,
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

  test('16. count: exact via O(1) type-length commands', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      expect(await adapter.count({ path: keyPath('counter'), filter: null }, makeCtx())).toEqual({
        value: 1,
        exact: true,
      });
      expect(await adapter.count({ path: keyPath(HASH_KEY), filter: null }, makeCtx())).toEqual({
        value: Object.keys(HASH_FIELDS).length,
        exact: true,
      });
      expect(await adapter.count({ path: keyPath(SET_KEY), filter: null }, makeCtx())).toEqual({
        value: SET_MEMBERS.length,
        exact: true,
      });
      expect(await adapter.count({ path: keyPath(ZSET_KEY), filter: null }, makeCtx())).toEqual({
        value: ZSET_MEMBERS.length,
        exact: true,
      });
      expect(await adapter.count({ path: keyPath(LIST_KEY), filter: null }, makeCtx())).toEqual({
        value: LIST_LENGTH,
        exact: true,
      });
      expect(await adapter.count({ path: keyPath(STREAM_KEY), filter: null }, makeCtx())).toEqual({
        value: STREAM_ENTRY_COUNT,
        exact: true,
      });
    } finally {
      await adapter.disconnect();
    }
  });

  test('17. preview/mutate: insert, update, delete (D2 write support)', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const insertPlan: MutationPlan = {
        path: keyPath('mutate-test-key'),
        ops: [{ kind: 'insert', values: { _key: 'mutate-test-key', $value: 'hello' } }],
      };
      expect(adapter.preview(insertPlan)).toEqual(['SET mutate-test-key hello NX']);
      expect(await adapter.mutate(insertPlan, makeCtx())).toEqual({ affectedRows: 1 });

      // NX means a second insert of the same key must fail rather than silently overwrite.
      await expect(adapter.mutate(insertPlan, makeCtx())).rejects.toMatchObject({
        code: 'E_QUERY',
      });

      const updatePlan: MutationPlan = {
        path: keyPath('mutate-test-key'),
        ops: [{ kind: 'update', key: { _key: 'mutate-test-key' }, changes: { $value: 'world' } }],
      };
      expect(adapter.preview(updatePlan)).toEqual(['SET mutate-test-key world']);
      expect(await adapter.mutate(updatePlan, makeCtx())).toEqual({ affectedRows: 1 });

      const page = await readKeyValue(
        adapter,
        {
          path: keyPath('mutate-test-key'),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(kvValueAt(page, 0)).toBe('world');

      const deletePlan: MutationPlan = {
        path: keyPath('mutate-test-key'),
        ops: [{ kind: 'delete', key: { _key: 'mutate-test-key' } }],
      };
      expect(adapter.preview(deletePlan)).toEqual(['DEL mutate-test-key']);
      expect(await adapter.mutate(deletePlan, makeCtx())).toEqual({ affectedRows: 1 });
      // Deleting an already-gone key is a no-op affecting zero rows, not an error.
      expect(await adapter.mutate(deletePlan, makeCtx())).toEqual({ affectedRows: 0 });
    } finally {
      await adapter.disconnect();
    }
  });

  test('18. execute: generic command dispatch, both reply shapes', async () => {
    const adapter = await createAdapter('redis', deps);
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
      const statements = ['GET counter', 'PING'];
      const pages = await adapter.execute(
        { path: path([{ kind: 'database', name: PRIMARY_DB_NAME }]), statements },
        ctx,
      );
      expect(loggedCommand).toBe(statements.join('\n'));
      expect(pages).toHaveLength(2);
      const [getPage, pingPage] = pages;
      if (getPage.kind !== 'keyvalue' || pingPage.kind !== 'keyvalue') {
        throw new Error('expected keyvalue console pages');
      }
      expect(kvFieldAt(getPage, 0)).toBe('GET');
      expect(kvValueAt(getPage, 0)).toBe('42');
      expect(kvFieldAt(pingPage, 0)).toBe('PING');
      expect(kvValueAt(pingPage, 0)).toBe('PONG');

      // An array reply gets one row per element (D11 — no per-command result shape).
      const [keysPage] = await adapter.execute(
        { path: path([{ kind: 'database', name: PRIMARY_DB_NAME }]), statements: ['KEYS counter'] },
        makeCtx(),
      );
      if (keysPage.kind !== 'keyvalue') throw new Error('expected a keyvalue console page');
      expect(keysPage.rowCount).toBe(1);
      expect(kvValueAt(keysPage, 0)).toBe('counter');
    } finally {
      await adapter.disconnect();
    }
  });

  test('19. execute: an unknown command is E_QUERY', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
        adapter.execute(
          {
            path: path([{ kind: 'database', name: PRIMARY_DB_NAME }]),
            statements: ['NOTACOMMAND foo'],
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('20. execute: an already-cancelled signal rejects before running anything', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const controller = new AbortController();
      controller.abort();
      const ctx: OpCtx = { opId: crypto.randomUUID(), signal: controller.signal, setCommand() {} };
      await expect(
        adapter.execute(
          {
            path: path([{ kind: 'database', name: PRIMARY_DB_NAME }]),
            statements: ['GET counter'],
          },
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'E_CANCELLED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('21. cancel is a permanent no-op (D7/D8)', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      expect(await adapter.cancel(crypto.randomUUID())).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  // P43 F12/D17: engine/data.ts's handleMutate — not the adapter directly, since the bug this
  // pins lives in the cache layer above it, not in the adapter. redis/mutate.ts's own `mutate()`
  // is a plain sequential loop with no transaction (unlike postgres/mysql-family/sqlite), so a
  // plan whose second op fails still applies its first op against the server. Before this fix
  // handleMutate only invalidated the cache on the success path, so a page read before the
  // mutation kept serving the pre-mutation value as a cache hit even after a failed commit.
  test("22. a partially failed mutate still invalidates the target's cached page (D17)", async () => {
    const connectionId = 'cache-test-redis-partial-failure';
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    setLiveAdapter(connectionId, adapter);
    try {
      const counterPath = encodePath(keyPath('counter').segments);
      const readReq = {
        opId: crypto.randomUUID(),
        tabId: null,
        connectionId,
        path: counterPath,
        projection: null,
        filter: null,
        sort: null,
        pageSize: 10 as const,
        cursor: { mode: 'offset' as const, offset: 0 },
      };

      // Warm L2: a miss, then a hit — proves the read that matters below is genuinely served
      // from cache rather than happening to hit the server again anyway.
      const first = await handleRead(readReq);
      expect(first.response.source).toBe('server');
      expect(kvValueAt(first.page as KeyValuePage, 0)).toBe('42');
      const second = await handleRead({ ...readReq, opId: crypto.randomUUID() });
      expect(second.response.source).toBe('cache');

      // op 1 (SET counter) succeeds against the server; op 2 targets HASH_KEY, a hash — wrong
      // type for an `update` op (assertEditableType), so the plan throws part-way through.
      await expect(
        handleMutate({
          opId: crypto.randomUUID(),
          tabId: null,
          connectionId,
          path: counterPath,
          ops: [
            { kind: 'update', key: { _key: 'counter' }, changes: { $value: '43' } },
            { kind: 'update', key: { _key: HASH_KEY }, changes: { $value: 'irrelevant' } },
          ],
        }),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });

      // The cached page must be gone (a fresh server read, not the stale '42' hit) and the read
      // that replaces it must reflect op 1's already-applied effect.
      const afterFailure = await handleRead({ ...readReq, opId: crypto.randomUUID() });
      expect(afterFailure.response.source).toBe('server');
      expect(kvValueAt(afterFailure.page as KeyValuePage, 0)).toBe('43');
    } finally {
      deleteLiveAdapter(connectionId);
      await adapter.disconnect();
      // Leaves 'counter' at '43' for the rest of this suite — no other test reads 'counter' after
      // this one runs (test order is declaration order).
    }
  });

  // P43 iter2 F18/D25: LIST_WINDOW used to clamp a list read to 500 elements regardless of the
  // caller's own req.pageSize, silently dropping everything between the clamp and the requested
  // page size while still reporting the unclamped size back. BIG_LIST_LENGTH (1200) is well past
  // the old clamp, so this genuinely exercises the boundary it used to cut short.
  test('23. read: a list page honours the full requested page size (D25)', async () => {
    const adapter = await createAdapter('redis', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page0 = await readKeyValue(
        adapter,
        {
          path: keyPath(BIG_LIST_KEY),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 1000,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page0.rowCount).toBe(1000);
      expect(page0.position.hasMore).toBe(true);
      // Element 500 is exactly where the old 500-wide clamp would have cut the page short.
      expect(kvValueAt(page0, 500)).toBe('big-job-500');
      expect(kvValueAt(page0, 999)).toBe('big-job-999');

      const page1 = await readKeyValue(
        adapter,
        {
          path: keyPath(BIG_LIST_KEY),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 1000,
          cursor: { mode: 'offset', offset: 1000 },
        },
        makeCtx(),
      );
      expect(page1.rowCount).toBe(BIG_LIST_LENGTH - 1000);
      expect(page1.position.hasMore).toBe(false);
      // Not 'big-job-500' — the element the old clamp would have silently repeated at this offset.
      expect(kvValueAt(page1, 0)).toBe('big-job-1000');
    } finally {
      await adapter.disconnect();
    }
  });
});
