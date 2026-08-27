import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { ConnectionSummary } from '@shared/domain/connection';
import { DATA_OP } from '@shared/protocol/data-ops';
import { ENGINE_OP, type ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { IPC } from '@shared/protocol/ipc';
import { mariadbCaps } from '../../../src/engine/adapters/mariadb/caps';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
import { type MariaFixture, startMariadb } from '../../db/support/mariadb';
import { fixturePathFor, isFixtureWriteMode, writeFixtureModule } from '../support/capture';
import { decodePage } from '../support/decode';
import { openHarness } from '../support/harness';
import type { ControlSnapshot, PortSnapshot } from '../support/types';
import { controlSnapshots as savedControl, portSnapshots as savedPort } from './mariadb.fixture';

// P50 §4.2 — the pilot adapter. Every scenario in the original tests/ui/mariadb.spec.ts is
// accounted for here, as a backend assertion, a frontend assertion (mariadb.frontend.spec.ts),
// or both — see the plan's own table. This file drives the real engine/control.ts::handleFrame
// and engine/rpc.ts::dispatch against a real MariaDB container (tests/db/support/mariadb.ts,
// reused by direct import per D1 — no container is stood up twice, tests/db/ is not edited).

const CONTAINER_START_TIMEOUT_MS = 180_000;

// host/port/createdAt/updatedAt are real, ephemeral per-container values (Testcontainers assigns
// a fresh host port every run) — meaningless to a mocked frontend, which never opens a real
// socket, and would make the committed fixture churn on every regeneration. Frozen to fixed
// values here, the same way LogicalPage already drops fetchedAt/byteSize (D6) — the backend
// half's own assertions above this function are what still exercise the real values.
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

let mariadb: MariaFixture;

before(
  async () => {
    if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
    mariadb = await startMariadb();
  },
  { timeout: CONTAINER_START_TIMEOUT_MS },
);

after(async () => {
  await mariadb?.stop();
});

describe('mariadb IPC boundary', () => {
  test('connect, tree, data tab, count, filter, cancel', async () => {
    const harness = await openHarness();
    const controlSnapshots: ControlSnapshot[] = [];
    const portSnapshots: PortSnapshot[] = [];
    try {
      const config = mariadb.config;

      // --- 1/2: connect --------------------------------------------------------------------
      const connectResult = await harness.connect(config);
      assert.match(connectResult.serverVersion, /^MariaDB \d+\.\d+/);
      assert.deepEqual(connectResult.caps, mariadbCaps);
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

      // --- 3: tree — database, then table, no schema level -------------------------------
      const root = await harness.children(config.id, '');
      assert.equal(root.source, 'server');
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: '', refresh: false },
        response: root,
      });
      const dbNode = root.nodes.find((n) => n.kind === 'database' && n.name === config.database);
      assert.ok(dbNode, `expected a database node named ${config.database}`);

      const dbChildrenFirst = await harness.children(config.id, dbNode.path);
      assert.equal(dbChildrenFirst.source, 'server');
      const dbChildrenSecond = await harness.children(config.id, dbNode.path);
      // The cache transition tests/db/ structurally cannot reach (F2) — it never touches
      // main/tree-service.ts's L1 cache-aside.
      assert.equal(dbChildrenSecond.source, 'cache');
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: dbNode.path, refresh: false },
        response: dbChildrenFirst,
      });
      const orderItemsNode = dbChildrenFirst.nodes.find(
        (n) => n.kind === 'table' && n.name === 'order_items',
      );
      assert.ok(orderItemsNode, 'expected an order_items table node');
      assert.equal(orderItemsNode.hasChildren, false);
      const bigRowsNode = dbChildrenFirst.nodes.find(
        (n) => n.kind === 'table' && n.name === 'big_rows',
      );
      assert.ok(bigRowsNode, 'expected a big_rows table node');

      // --- 4: first page of order_items ----------------------------------------------------
      const readPayload = {
        opId: 'be-read-order-items',
        tabId: null,
        connectionId: config.id,
        path: orderItemsNode.path,
        projection: null,
        filter: null,
        sort: null,
        pageSize: 100 as const,
        cursor: { mode: 'offset' as const, offset: 0 },
      };
      const readResult = await harness.dataOp<{ page: unknown; source: string }>(
        DATA_OP.read,
        readPayload,
      );
      assert.equal(readResult.source, 'server');
      const logicalPage = decodePage(readResult.page as Parameters<typeof decodePage>[0]);
      assert.equal(logicalPage.kind, 'tabular');
      if (logicalPage.kind === 'tabular') assert.equal(logicalPage.rows.length, 3);
      portSnapshots.push({
        op: DATA_OP.read,
        payload: readPayload,
        response: { kind: 'read', page: logicalPage, source: 'server' },
      });

      // --- 5: count, twice (server then cache) --------------------------------------------
      const countPayload = {
        opId: 'be-count-order-items',
        tabId: null,
        connectionId: config.id,
        path: orderItemsNode.path,
        filter: null,
        refresh: false,
      };
      const countFirst = await harness.dataOp<{ value: number; exact: boolean; source: string }>(
        DATA_OP.count,
        countPayload,
      );
      assert.equal(countFirst.value, 3);
      assert.equal(countFirst.source, 'server');
      const countSecond = await harness.dataOp<{ source: string }>(DATA_OP.count, countPayload);
      assert.equal(countSecond.source, 'cache');
      portSnapshots.push({
        op: DATA_OP.count,
        payload: countPayload,
        response: {
          kind: 'count',
          value: countFirst.value,
          exact: countFirst.exact,
          stale: false,
          source: 'server',
        },
      });

      // --- 6: filtered read (quantity > 1) — its own fixture entry, and D7's request shape --
      const filteredReadPayload = {
        ...readPayload,
        opId: 'be-read-order-items-filtered',
        filter: 'quantity > 1',
      };
      const filteredRead = await harness.dataOp<{ page: unknown; source: string }>(
        DATA_OP.read,
        filteredReadPayload,
      );
      const filteredLogicalPage = decodePage(filteredRead.page as Parameters<typeof decodePage>[0]);
      assert.equal(filteredLogicalPage.kind, 'tabular');
      if (filteredLogicalPage.kind === 'tabular') assert.equal(filteredLogicalPage.rows.length, 2);
      portSnapshots.push({
        op: DATA_OP.read,
        payload: filteredReadPayload,
        response: {
          kind: 'read',
          page: filteredLogicalPage,
          source: filteredRead.source as 'server',
        },
      });

      // The frontend half's stop-button scenario replays this exact read against big_rows, with
      // an artificial delay (delayMs, frontend-only) standing in for the real SLEEP()-based slow
      // filter this backend half does not need to reproduce (D7: the frontend keeps only the
      // button and the opsCancel payload it sends; the server-side kill is tests/db/mariadb.spec.ts's
      // job, not this layer's).
      const bigRowsReadPayload = {
        opId: 'fe-read-big-rows',
        tabId: null,
        connectionId: config.id,
        path: bigRowsNode.path,
        projection: null,
        filter: null,
        sort: null,
        // A tiny page (D6: a fixture is reviewed as a diff — 10 000 real rows is not). The
        // original UI scenario used page-size-10000 only to make a filtered scan of 1M rows slow
        // enough to cancel; the requested page size itself is incidental to that, and the
        // frontend half's stop-button assertion (D7) needs no real row data at all.
        pageSize: 100 as const,
        cursor: { mode: 'offset' as const, offset: 0 },
      };
      const bigRowsRead = await harness.dataOp<{ page: unknown; source: string }>(
        DATA_OP.read,
        bigRowsReadPayload,
      );
      const bigRowsLogicalPage = decodePage(bigRowsRead.page as Parameters<typeof decodePage>[0]);
      portSnapshots.push({
        op: DATA_OP.read,
        payload: bigRowsReadPayload,
        response: {
          kind: 'read',
          page: bigRowsLogicalPage,
          source: bigRowsRead.source as 'server',
        },
        delayMs: 500,
      });

      // --- 7: cancel — a real running op, a real cancelOp, no ops-log replica needed --------
      // tests/db/mariadb.spec.ts already proves the adapter forwards cancellation server-side
      // (KILL QUERY); this layer's own subject is engine/rpc.ts's dispatch and
      // engine/scheduler/ops.ts's runOp/cancelOp wiring, which tests/db/ never reaches (F2).
      const slowFilterPayload = {
        ...bigRowsReadPayload,
        opId: 'be-cancel-target',
        filter: 'id != 1 OR (SELECT SLEEP(2)) IS NOT NULL',
      };
      const inFlight = harness.dataOp(DATA_OP.read, slowFilterPayload);
      inFlight.catch(() => {}); // observed via the assertion below; an unhandled rejection here would fail the run spuriously
      await new Promise((resolve) => setTimeout(resolve, 100));
      const cancelResult = await harness.engineOp<{ cancelled: boolean }>(ENGINE_OP.cancel, {
        opId: slowFilterPayload.opId,
      });
      assert.equal(cancelResult.cancelled, true);
      await assert.rejects(inFlight, (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal((err as Error & { code?: string }).code, 'E_CANCELLED');
        return true;
      });
      controlSnapshots.push({ channel: IPC.opsCancel, args: undefined, response: undefined });

      if (isFixtureWriteMode()) {
        writeFixtureModule(fixturePathFor('mariadb'), 'mariadb', controlSnapshots, portSnapshots);
        return;
      }

      // Assert mode (the default): every run's real response must still match the committed
      // fixture — the anti-drift half of the vital rule (D5). Round-tripped through JSON before
      // comparing, the same normalization writeFixtureModule's own JSON.stringify already applies
      // to the committed file (an in-memory `args: undefined` key is dropped by JSON, so the
      // freshly captured array must drop it too before the two are compared).
      assert.deepEqual(JSON.parse(JSON.stringify(controlSnapshots)), savedControl);
      assert.deepEqual(JSON.parse(JSON.stringify(portSnapshots)), savedPort);
    } finally {
      await harness.close();
    }
  });
});
