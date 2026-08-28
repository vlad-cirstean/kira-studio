import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { ConnectionSummary } from '@shared/domain/connection';
import { DATA_OP } from '@shared/protocol/data-ops';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { IPC } from '@shared/protocol/ipc';
import { mysqlCaps } from '../../../src/engine/adapters/mysql/caps';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
import { type MysqlFixture, startMysql } from '../../db/support/mysql';
import { fixturePathFor, isFixtureWriteMode, writeFixtureModule } from '../support/capture';
import { decodePage } from '../support/decode';
import { openHarness } from '../support/harness';
import type { ControlSnapshot, PortSnapshot } from '../support/types';
import { controlSnapshots as savedControl, portSnapshots as savedPort } from './mysql.fixture';

// P50 §4.4 — mysql, same shape as mariadb's split (§4.2), plus the dialect-quoting seam this
// spec exists for (D17: Filter by this value must come back backtick-quoted) and the
// "Routines" folder naming (D20 — not "Functions", mysql's own catalog grouping). The
// engine-picker/Add-Connection-dialog flow in the original tests/ui/mysql.spec.ts is generic
// connection-dialog UI already covered by tests/ui/connections.spec.ts (kept, unchanged) — this
// split's frontend half starts from an already-listed connection, like mariadb's and redis's own
// frontend specs, to keep the split focused on this adapter's actual distinguishing behavior.

const CONTAINER_START_TIMEOUT_MS = 180_000;

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

let mysql: MysqlFixture;

before(
  async () => {
    if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
    mysql = await startMysql();
  },
  { timeout: CONTAINER_START_TIMEOUT_MS },
);

after(async () => {
  await mysql?.stop();
});

function findByName<T extends { name: string }>(nodes: T[], name: string, what: string): T {
  const node = nodes.find((n) => n.name === name);
  assert.ok(
    node,
    `expected a ${what} node named ${name}, got ${JSON.stringify(nodes.map((n) => n.name))}`,
  );
  return node;
}

describe('mysql IPC boundary', () => {
  test('connect, tree (Routines folder), filter-by-value quoting, console', async () => {
    const harness = await openHarness();
    const controlSnapshots: ControlSnapshot[] = [];
    const portSnapshots: PortSnapshot[] = [];
    try {
      const config = mysql.config;

      const connectResult = await harness.connect(config);
      assert.match(connectResult.serverVersion, /^MySQL 8\.4\./);
      assert.deepEqual(connectResult.caps, mysqlCaps);
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

      const root = await harness.children(config.id, '');
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: '', refresh: false },
        response: root,
      });
      const dbNode = findByName(root.nodes, config.database ?? 'kira_test', 'database');

      const dbChildren = await harness.children(config.id, dbNode.path);
      // information_schema.TABLES.TABLE_ROWS is InnoDB's own sampled estimate, not an exact
      // count — confirmed empirically to differ (~1M vs ~1000K, the same magnitude rounded
      // across a formatting boundary) between separate, identically-seeded containers. Frozen to
      // a fixed placeholder for big_rows only; every other table's small enough that its
      // estimate is exact and stable (P50 D6's fetchedAt/byteSize pattern, applied here).
      const dbChildrenForFixture = {
        ...dbChildren,
        nodes: dbChildren.nodes.map((n) =>
          n.name === 'big_rows' ? { ...n, detail: '~1M rows' } : n,
        ),
      };
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: dbNode.path, refresh: false },
        response: dbChildrenForFixture,
      });
      const orderItemsNode = findByName(dbChildren.nodes, 'order_items', 'table');
      // D20: there is no backend "folder" node kind at all (domain/tree.ts's NodeKind has none) —
      // "Routines" vs. a generic "Functions" heading is a frontend-only label choice the tree
      // component makes per connection kind when grouping the real function-kind nodes below,
      // so that assertion belongs entirely to the frontend half, not this one.
      assert.ok(
        dbChildren.nodes.some((n) => n.kind === 'function'),
        'expected at least one function-kind node under the database',
      );

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
      const logicalPage = decodePage(readResult.page as Parameters<typeof decodePage>[0]);
      assert.equal(logicalPage.kind, 'tabular');
      portSnapshots.push({
        op: DATA_OP.read,
        payload: readPayload,
        response: { kind: 'read', page: logicalPage, source: readResult.source as 'server' },
      });

      // D17: the load-bearing assertion — a same-value filter narrows to exactly the row it came
      // from, and the request the filter produced is backtick-quoted (asserted on the frontend
      // half via D7's request log; here the real value that filter must match is captured).
      let idColumnIndex = -1;
      let firstIdValue: string | null = null;
      if (logicalPage.kind === 'tabular') {
        idColumnIndex = logicalPage.columns.findIndex((c) => c.name === 'id');
        assert.ok(idColumnIndex >= 0, 'expected an id column');
        firstIdValue = logicalPage.rows[0]?.[idColumnIndex] ?? null;
        assert.ok(firstIdValue, 'expected a non-null id in the first row');
      }
      const filterByValueFilter = `\`id\` = '${firstIdValue}'`;
      const filteredReadPayload = {
        ...readPayload,
        opId: 'be-read-order-items-filtered',
        filter: filterByValueFilter,
      };
      const filteredRead = await harness.dataOp<{ page: unknown; source: string }>(
        DATA_OP.read,
        filteredReadPayload,
      );
      const filteredLogicalPage = decodePage(filteredRead.page as Parameters<typeof decodePage>[0]);
      assert.equal(filteredLogicalPage.kind, 'tabular');
      if (filteredLogicalPage.kind === 'tabular') assert.equal(filteredLogicalPage.rows.length, 1);
      portSnapshots.push({
        op: DATA_OP.read,
        payload: filteredReadPayload,
        response: {
          kind: 'read',
          page: filteredLogicalPage,
          source: filteredRead.source as 'server',
        },
      });

      // D17's other half — console is really SQL mode: SELECT 1.
      const executePayload = {
        opId: 'be-console-select1',
        tabId: null,
        connectionId: config.id,
        path: dbNode.path,
        // ConsoleView.vue's runStatement() sends statementAtCursor()'s own trimmed text, which
        // excludes the trailing delimiter (sql-split.ts's splitSqlStatements) — typing
        // "SELECT 1;" into the editor produces the request "SELECT 1", not "SELECT 1;".
        statements: ['SELECT 1'],
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
        writeFixtureModule(fixturePathFor('mysql'), 'mysql', controlSnapshots, portSnapshots);
        return;
      }

      assert.deepEqual(JSON.parse(JSON.stringify(controlSnapshots)), savedControl);
      assert.deepEqual(JSON.parse(JSON.stringify(portSnapshots)), savedPort);
    } finally {
      await harness.close();
    }
  });
});
