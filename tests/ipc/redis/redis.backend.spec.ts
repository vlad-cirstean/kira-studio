import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { ConnectionSummary } from '@shared/domain/connection';
import { DATA_OP } from '@shared/protocol/data-ops';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { IPC } from '@shared/protocol/ipc';
import { redisCaps } from '../../../src/engine/adapters/redis/caps';
import {
  BIG_HASH_KEY,
  HASH_FIELDS,
  HASH_KEY,
  LIST_KEY,
  LIST_LENGTH,
  TTL_KEY,
} from '../../db/fixtures/0004_redis_seed';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
import { type RedisFixture, startRedis } from '../../db/support/redis';
import { fixturePathFor, isFixtureWriteMode, writeFixtureModule } from '../support/capture';
import { decodePage } from '../support/decode';
import { openHarness } from '../support/harness';
import type { ControlSnapshot, PortSnapshot } from '../support/types';
import { controlSnapshots as savedControl, portSnapshots as savedPort } from './redis.fixture';

// P50 §4.3 — the redis split, read in full against tests/ui/redis.spec.ts. First non-tabular
// page kind through the fixture vocabulary (KeyValuePage), and the first real use of D7's
// request log (scenario 6's cursor-refresh, and the D39 supersession guard the original spec's
// own comment says a local fixture answers too fast to force).

const CONTAINER_START_TIMEOUT_MS = 120_000;

function connectionSummaryOf(config: ResolvedConnectionConfig): ConnectionSummary {
  const { password: _password, ...summary } = config;
  return {
    ...summary,
    host: 'fixture-host',
    port: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    preconnect: null,
    preconnectSidecar: false,
  };
}

let redis: RedisFixture;

before(
  async () => {
    if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
    redis = await startRedis();
  },
  { timeout: CONTAINER_START_TIMEOUT_MS },
);

after(async () => {
  await redis?.stop();
});

// HSCAN's cursor-round order is not guaranteed stable across separate scans of a large
// (hashtable-encoded, not listpack) hash — confirmed empirically: two consecutive
// KIRA_IPC_FIXTURES=write runs against fresh, identically-seeded containers returned the same
// 5000 fields in different orders. Sorting by field name before a fixture ever sees the page
// makes the capture deterministic without weakening what this scenario actually tests (that
// pagination advances and a cursor round-trips) — the UI never depends on HSCAN's own order
// either.
function sortKeyValueFields<
  T extends { kind: 'keyvalue'; fields: (string | null)[]; values: (string | null)[] },
>(page: T): T {
  const order = page.fields
    .map((_, i) => i)
    .sort((a, b) => (page.fields[a] ?? '').localeCompare(page.fields[b] ?? ''));
  return {
    ...page,
    fields: order.map((i) => page.fields[i]),
    values: order.map((i) => page.values[i]),
  };
}

// A large hashtable-encoded hash's HSCAN doesn't just reorder between separate scans of freshly
// (and identically) seeded containers — confirmed empirically, sorting page 1 and page 2 by
// field name still left them disagreeing run to run — which page's own 100 fields lands on
// which side of the cursor boundary depends on Redis's internal bucket/rehash state, not
// anything this app's adapter controls. Real backend behaviour (a page of 100, a working next
// cursor, a second page that also returns rows) is still asserted against the real HSCAN result
// above each call site; only the *fixture* — which the frontend half never inspects beyond a
// DOM row count (P50 §4.3 row 7) — is replaced with this deterministic stand-in afterward, so
// the committed file stops churning on every regeneration.
function syntheticHashPage(
  startIndex: number,
  count: number,
  position: { nextToken: string | null; prevToken: string | null; hasMore: boolean },
) {
  return {
    kind: 'keyvalue' as const,
    redisType: 'hash' as const,
    ttlMs: null,
    memoryBytes: 512,
    fields: Array.from({ length: count }, (_, i) => `f${startIndex + i}`),
    values: Array.from({ length: count }, (_, i) => `v${startIndex + i}`),
    position: {
      offset: null,
      pageSize: count,
      strategy: 'cursor' as const,
      nextToken: position.nextToken,
      prevToken: position.prevToken,
      hasMore: position.hasMore,
    },
  };
}

function findByName<T extends { name: string }>(nodes: T[], name: string, what: string): T {
  const node = nodes.find((n) => n.name === name);
  assert.ok(
    node,
    `expected a ${what} node named ${name}, got ${JSON.stringify(nodes.map((n) => n.name))}`,
  );
  return node;
}

describe('redis IPC boundary', () => {
  test('connect, tree, keyvalue tabs (hash/list/ttl), delete, console', async () => {
    const harness = await openHarness();
    const controlSnapshots: ControlSnapshot[] = [];
    const portSnapshots: PortSnapshot[] = [];
    try {
      const config = redis.config;

      // --- connect --------------------------------------------------------------------------
      const connectResult = await harness.connect(config);
      assert.match(connectResult.serverVersion, /^Redis \d+\.\d+/);
      assert.deepEqual(connectResult.caps, redisCaps);
      controlSnapshots.push({
        channel: IPC.connectionsList,
        args: undefined,
        response: [connectionSummaryOf(config)],
      });
      controlSnapshots.push({ channel: IPC.connectionsStates, args: undefined, response: [] });
      controlSnapshots.push({
        channel: IPC.connectionsConnect,
        args: { id: config.id },
        response: {
          connectionId: config.id,
          status: 'connected',
          serverVersion: connectResult.serverVersion,
          error: null,
          since: 0,
          caps: connectResult.caps,
        },
      });

      // --- 1: root -> db0, db1, both leaves (no key-browsing twisty) -------------------------
      const root = await harness.children(config.id, '');
      assert.equal(root.source, 'server');
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: '', refresh: false },
        response: root,
      });
      const db0Node = findByName(root.nodes, 'db0', 'database');
      const db1Node = findByName(root.nodes, 'db1', 'database');

      // --- 2: db1's own browse level — one namespace, no truncated strip ---------------------
      const db1Children = await harness.children(config.id, db1Node.path);
      assert.equal(db1Children.truncated, false);
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: db1Node.path, refresh: false },
        response: db1Children,
      });
      findByName(db1Children.nodes, 'other-db', 'namespace');

      // --- 3: db0 -> user -> 1 -> the hash key, one children() call per level ----------------
      const db0Children = await harness.children(config.id, db0Node.path);
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: db0Node.path, refresh: false },
        response: db0Children,
      });
      const userNsNode = findByName(db0Children.nodes, 'user', 'namespace');
      const queueNsNode = findByName(db0Children.nodes, 'queue', 'namespace');
      const sessionNsNode = findByName(db0Children.nodes, 'session', 'namespace');

      const userChildren = await harness.children(config.id, userNsNode.path);
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: userNsNode.path, refresh: false },
        response: userChildren,
      });
      const user1NsNode = findByName(userChildren.nodes, '1', 'namespace');

      const user1Children = await harness.children(config.id, user1NsNode.path);
      assert.equal(user1Children.nodes.length, 4); // name, email, profile (hash), bighash
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: user1NsNode.path, refresh: false },
        response: user1Children,
      });
      const hashKeyNode = findByName(user1Children.nodes, HASH_KEY, 'key');
      const bigHashKeyNode = findByName(user1Children.nodes, BIG_HASH_KEY, 'key');

      // --- 4: hash key tab — type badge, field/value rows -------------------------------------
      const hashReadPayload = {
        opId: 'be-read-hash',
        tabId: null,
        connectionId: config.id,
        path: hashKeyNode.path,
        projection: null,
        filter: null,
        sort: null,
        pageSize: 100 as const,
        cursor: { mode: 'offset' as const, offset: 0 },
      };
      const hashRead = await harness.dataOp<{ page: unknown; source: string }>(
        DATA_OP.read,
        hashReadPayload,
      );
      let hashLogicalPage = decodePage(hashRead.page as Parameters<typeof decodePage>[0]);
      assert.equal(hashLogicalPage.kind, 'keyvalue');
      if (hashLogicalPage.kind === 'keyvalue') {
        assert.equal(hashLogicalPage.redisType, 'hash');
        assert.deepEqual(hashLogicalPage.fields.slice().sort(), Object.keys(HASH_FIELDS).sort());
        hashLogicalPage = sortKeyValueFields(hashLogicalPage);
      }
      portSnapshots.push({
        op: DATA_OP.read,
        payload: hashReadPayload,
        response: { kind: 'read', page: hashLogicalPage, source: hashRead.source as 'server' },
      });

      // --- 5: a keyvalue reload calls data:invalidate before re-reading (state.ts:120-124's
      // reload()) — the frontend half's Refresh click needs this snapshot or the invalidate call
      // itself fails, aborting the reload before the cell editor ever clears.
      const invalidatePayload = { connectionId: config.id, path: hashKeyNode.path };
      await harness.dataOp(DATA_OP.invalidate, invalidatePayload);
      portSnapshots.push({
        op: DATA_OP.invalidate,
        payload: invalidatePayload,
        response: { kind: 'invalidate' },
      });

      // --- 6: big hash key — cursor pagination, two pages forward then a Refresh back to one --
      const bigHashBasePayload = {
        opId: 'be-read-bighash-1',
        tabId: null,
        connectionId: config.id,
        path: bigHashKeyNode.path,
        projection: null,
        filter: null,
        sort: null,
        pageSize: 100 as const,
        cursor: { mode: 'offset' as const, offset: 0 },
      };
      const bigHashPage1 = await harness.dataOp<{ page: unknown; source: string }>(
        DATA_OP.read,
        bigHashBasePayload,
      );
      const bigHashLogical1Real = decodePage(bigHashPage1.page as Parameters<typeof decodePage>[0]);
      assert.equal(bigHashLogical1Real.kind, 'keyvalue');
      if (bigHashLogical1Real.kind === 'keyvalue') {
        // HSCAN's COUNT is a hint, not a guarantee (Redis walks buckets, not elements, per
        // round) — a hashtable-encoded 5000-field hash can return well over the requested
        // pageSize in a single round. The only real invariant here is "some rows, more to come".
        assert.ok(bigHashLogical1Real.fields.length > 0);
        assert.equal(bigHashLogical1Real.position.hasMore, true);
      }
      // Refresh re-sends this exact same page-one request (P43 iter3 D40/F37: a cursor page
      // cannot be resumed, so a reload always goes back to page one) — one snapshot serves both.
      // The fixture's own field/value content and cursor tokens are synthetic (syntheticHashPage,
      // above) rather than the real HSCAN result: confirmed empirically that a hashtable-sized
      // hash's scan boundary is not stable across separate captures, even sorted.
      portSnapshots.push({
        op: DATA_OP.read,
        payload: bigHashBasePayload,
        response: {
          kind: 'read',
          page: syntheticHashPage(0, 100, {
            nextToken: 'synthetic-bighash-cursor-1',
            prevToken: null,
            hasMore: true,
          }),
          source: 'server',
        },
      });
      if (bigHashLogical1Real.kind === 'keyvalue') {
        const nextToken = (bigHashLogical1Real.position as { nextToken: string | null }).nextToken;
        assert.ok(nextToken, 'expected the first bighash page to have a next cursor token');
        const bigHashPage2Payload = {
          ...bigHashBasePayload,
          opId: 'be-read-bighash-2',
          cursor: { mode: 'after' as const, token: nextToken as string },
        };
        const bigHashPage2 = await harness.dataOp<{ page: unknown; source: string }>(
          DATA_OP.read,
          bigHashPage2Payload,
        );
        const bigHashLogical2Real = decodePage(
          bigHashPage2.page as Parameters<typeof decodePage>[0],
        );
        assert.equal(bigHashLogical2Real.kind, 'keyvalue');
        if (bigHashLogical2Real.kind === 'keyvalue')
          assert.ok(bigHashLogical2Real.fields.length > 0);
        // The frontend half's own "next" click sends a cursor token it read off page 1's mocked
        // response — the synthetic token above, not this real one — so the fixture's page-2 entry
        // is keyed by that same synthetic token, not bigHashPage2Payload's real one.
        const syntheticPage2Payload = {
          ...bigHashBasePayload,
          opId: 'be-read-bighash-2',
          cursor: { mode: 'after' as const, token: 'synthetic-bighash-cursor-1' },
        };
        portSnapshots.push({
          op: DATA_OP.read,
          payload: syntheticPage2Payload,
          response: {
            kind: 'read',
            page: syntheticHashPage(100, 100, { nextToken: null, prevToken: null, hasMore: false }),
            source: 'server',
          },
        });
      }
      // The frontend half's own Refresh click on the big-hash tab (P43 iter3 D40/F37) invalidates
      // this path too, same as the small hash's did above.
      const bigHashInvalidatePayload = { connectionId: config.id, path: bigHashKeyNode.path };
      await harness.dataOp(DATA_OP.invalidate, bigHashInvalidatePayload);
      portSnapshots.push({
        op: DATA_OP.invalidate,
        payload: bigHashInvalidatePayload,
        response: { kind: 'invalidate' },
      });

      // --- 8: list key — one page holds every seeded job, pager both-disabled ----------------
      const queueChildren = await harness.children(config.id, queueNsNode.path);
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: queueNsNode.path, refresh: false },
        response: queueChildren,
      });
      const listKeyNode = findByName(queueChildren.nodes, LIST_KEY, 'key');
      const listReadPayload = {
        opId: 'be-read-list',
        tabId: null,
        connectionId: config.id,
        path: listKeyNode.path,
        projection: null,
        filter: null,
        sort: null,
        pageSize: 100 as const,
        cursor: { mode: 'offset' as const, offset: 0 },
      };
      const listRead = await harness.dataOp<{ page: unknown; source: string }>(
        DATA_OP.read,
        listReadPayload,
      );
      const listLogical = decodePage(listRead.page as Parameters<typeof decodePage>[0]);
      assert.equal(listLogical.kind, 'keyvalue');
      if (listLogical.kind === 'keyvalue') {
        assert.equal(listLogical.redisType, 'list');
        assert.equal(listLogical.fields.length, LIST_LENGTH);
        assert.equal(listLogical.position.hasMore, false);
      }
      portSnapshots.push({
        op: DATA_OP.read,
        payload: listReadPayload,
        response: { kind: 'read', page: listLogical, source: listRead.source as 'server' },
      });

      // --- 9: TTL key — badges populated ------------------------------------------------------
      const sessionChildrenBefore = await harness.children(config.id, sessionNsNode.path);
      const ttlKeyNode = findByName(sessionChildrenBefore.nodes, TTL_KEY, 'key');
      const ttlReadPayload = {
        opId: 'be-read-ttl',
        tabId: null,
        connectionId: config.id,
        path: ttlKeyNode.path,
        projection: null,
        filter: null,
        sort: null,
        pageSize: 100 as const,
        cursor: { mode: 'offset' as const, offset: 0 },
      };
      const ttlRead = await harness.dataOp<{ page: unknown; source: string }>(
        DATA_OP.read,
        ttlReadPayload,
      );
      let ttlLogical = decodePage(ttlRead.page as Parameters<typeof decodePage>[0]);
      assert.equal(ttlLogical.kind, 'keyvalue');
      if (ttlLogical.kind === 'keyvalue') {
        assert.equal(ttlLogical.redisType, 'string');
        assert.ok(ttlLogical.ttlMs !== null && ttlLogical.ttlMs > 0);
        assert.ok(ttlLogical.memoryBytes !== null && ttlLogical.memoryBytes > 0);
        // Frozen to fixed placeholders once the real values are validated above: ttlMs is
        // wall-clock-derived (PTTL counts down between the two KIRA_IPC_FIXTURES=write ->
        // re-assert runs this file's own acceptance check requires) and memoryBytes is Redis's
        // own internal object-encoding estimate, neither of which the frontend half needs to be
        // real — only "populated, not the no-expiry/unknown placeholder" (P50 D6's fetchedAt/
        // byteSize exclusion, applied to this page kind's own volatile fields).
        ttlLogical = { ...ttlLogical, ttlMs: 9_999_000, memoryBytes: 64 };
      }
      portSnapshots.push({
        op: DATA_OP.read,
        payload: ttlReadPayload,
        response: { kind: 'read', page: ttlLogical, source: ttlRead.source as 'server' },
      });

      // --- 10: delete the TTL key -> the session level's own second listing omits it --------
      const mutatePayload = {
        opId: 'be-delete-ttl',
        tabId: null,
        connectionId: config.id,
        path: ttlKeyNode.path,
        ops: [{ kind: 'delete' as const, key: { _key: TTL_KEY } }],
      };
      const mutateResult = await harness.dataOp<{ affectedRows: number }>(
        DATA_OP.mutate,
        mutatePayload,
      );
      assert.equal(mutateResult.affectedRows, 1);
      portSnapshots.push({
        op: DATA_OP.mutate,
        payload: mutatePayload,
        response: { kind: 'mutate', affectedRows: mutateResult.affectedRows },
      });
      // browseInvalidate()'s cross-tab effect: views/browse/state.ts's invalidateLevel() reloads
      // with { refresh: true } (a hard bypass of the L1 cache, not an ordinary revisit), so the
      // post-delete listing is a genuinely different (channel, args) pair from the pre-delete
      // one — each gets its own snapshot, no fixture-order sequencing needed.
      const sessionChildrenAfter = await harness.children(config.id, sessionNsNode.path, true);
      assert.equal(
        sessionChildrenAfter.nodes.some((n) => n.name === TTL_KEY),
        false,
      );
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: sessionNsNode.path, refresh: false },
        response: sessionChildrenBefore,
      });
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: sessionNsNode.path, refresh: true },
        response: sessionChildrenAfter,
      });

      // --- 11: console — DBSIZE against db0 -> one kv row -------------------------------------
      const executePayload = {
        opId: 'be-console-dbsize',
        tabId: null,
        connectionId: config.id,
        path: db0Node.path,
        statements: ['DBSIZE'],
      };
      const executeResult = await harness.dataOp<{ pages: unknown[] }>(
        DATA_OP.execute,
        executePayload,
      );
      assert.equal(executeResult.pages.length, 1);
      const consoleLogical = decodePage(executeResult.pages[0] as Parameters<typeof decodePage>[0]);
      portSnapshots.push({
        op: DATA_OP.execute,
        payload: executePayload,
        response: { kind: 'execute', pages: [consoleLogical] },
      });

      if (isFixtureWriteMode()) {
        writeFixtureModule(fixturePathFor('redis'), 'redis', controlSnapshots, portSnapshots);
        return;
      }

      assert.deepEqual(JSON.parse(JSON.stringify(controlSnapshots)), savedControl);
      assert.deepEqual(JSON.parse(JSON.stringify(portSnapshots)), savedPort);
    } finally {
      await harness.close();
    }
  });
});
