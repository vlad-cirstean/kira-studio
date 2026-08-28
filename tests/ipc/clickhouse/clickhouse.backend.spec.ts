import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { ConnectionSummary } from '@shared/domain/connection';
import { DATA_OP } from '@shared/protocol/data-ops';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { IPC } from '@shared/protocol/ipc';
import { clickhouseCaps } from '../../../src/engine/adapters/clickhouse/caps';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
import { fixturePathFor, isFixtureWriteMode, writeFixtureModule } from '../support/capture';
import { decodePage } from '../support/decode';
import { openHarness } from '../support/harness';
import type { ControlSnapshot, PortSnapshot } from '../support/types';
import { controlSnapshots as savedControl, portSnapshots as savedPort } from './clickhouse.fixture';
import { type ClickHouseIpcFixture, startClickHouse } from './container';

// P50 §4.4 — clickhouse, same shape as mysql's split (§4.4) plus the delete-gating this adapter's
// permanently-false canUpdate/canDelete caps drive (D23/D25/D26 in clickhouseCaps.ts's own
// comment: a MergeTree PRIMARY KEY is a sparse index, not a uniqueness constraint, so a row can
// never be addressed unambiguously). The engine-picker/Add-Connection-dialog flow in the original
// tests/ui/clickhouse.spec.ts is generic connection-dialog UI already covered by
// tests/e2e/connections.spec.ts (kept, unchanged) — this split's frontend half starts from an
// already-listed connection, like every other adapter split.
//
// This adapter's container needs its own start() (./container.ts), not
// tests/db/support/clickhouse.ts's — that file's ClickHouseContainer construction is private to
// its own start() and this sandbox's fixed ulimit ceiling can't satisfy the class's hardcoded
// nofile request (see container.ts's own comment). No other adapter split needed this.

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

let clickhouse: ClickHouseIpcFixture;

before(
  async () => {
    if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
    clickhouse = await startClickHouse();
  },
  { timeout: CONTAINER_START_TIMEOUT_MS },
);

after(async () => {
  await clickhouse?.stop();
});

function findByName<T extends { name: string }>(nodes: T[], name: string, what: string): T {
  const node = nodes.find((n) => n.name === name);
  assert.ok(
    node,
    `expected a ${what} node named ${name}, got ${JSON.stringify(nodes.map((n) => n.name))}`,
  );
  return node;
}

describe('clickhouse IPC boundary', () => {
  test('connect, tree (Views/Materialized views folders), filter-by-value quoting, delete gating, definition, console', async () => {
    const harness = await openHarness();
    const controlSnapshots: ControlSnapshot[] = [];
    const portSnapshots: PortSnapshot[] = [];
    try {
      const config = clickhouse.config;

      const connectResult = await harness.connect(config);
      assert.match(connectResult.serverVersion, /^ClickHouse 2\d\./);
      assert.deepEqual(connectResult.caps, clickhouseCaps);
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
      const dbNode = findByName(root.nodes, clickhouse.database, 'database');
      // D15: no INFORMATION_SCHEMA node at all — a fact about this adapter's own tree
      // enumeration, so it belongs here rather than only being implied by the frontend fixture.
      assert.equal(
        root.nodes.some((n) => n.name.toUpperCase() === 'INFORMATION_SCHEMA'),
        false,
      );

      const dbChildren = await harness.children(config.id, dbNode.path);
      // A materialized view with no explicit backing table gets ClickHouse's own auto-generated
      // `.inner_id.<uuid>` storage table — a fresh random UUID every time the container (and so
      // the MV) is created, embedded in both `name` and `path`. Frozen the same way every other
      // adapter's own randomly-generated id has been this phase (D6).
      const dbChildrenForFixture = {
        ...dbChildren,
        nodes: dbChildren.nodes.map((n) =>
          n.name.startsWith('.inner_id.')
            ? {
                ...n,
                name: '.inner_id.00000000-0000-0000-0000-000000000000',
                path: `${dbNode.path}/table:.inner_id.00000000-0000-0000-0000-000000000000`,
              }
            : n,
        ),
      };
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: dbNode.path, refresh: false },
        response: dbChildrenForFixture,
      });
      const orderItemsNode = findByName(dbChildren.nodes, 'order_items', 'table');
      // D15: there is no backend "folder" node kind at all (domain/tree.ts's NodeKind has none) —
      // "Views"/"Materialized views" headings are a frontend-only grouping over the real
      // view/matview-kind nodes below, same reasoning as mysql's own "Routines" finding (D20) —
      // that assertion belongs entirely to the frontend half.
      assert.ok(
        dbChildren.nodes.some((n) => n.kind === 'view'),
        'expected at least one view-kind node under the database',
      );
      assert.ok(
        dbChildren.nodes.some((n) => n.kind === 'matview'),
        'expected at least one matview-kind node under the database',
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

      // D29: the load-bearing assertion — a same-value filter narrows to exactly the row it came
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

      // D31/D26: canUpdate/canDelete are permanently false — the disabled −-row button and its
      // tooltip are a pure caps-driven rendering fact, already proven above by
      // assert.deepEqual(connectResult.caps, clickhouseCaps); nothing further to capture backend-
      // side. Same reasoning covers "double-clicking a cell does not start an inline edit."

      // D18/D22: the table's definition — a "Table properties" section naming its engine
      // (MergeTree) and sorting key, no PK badge anywhere (there is no primary-key concept here,
      // only a sparse sorting key — clickhouseCaps.ts's own comment).
      const definitionResult = await harness.definition(config.id, orderItemsNode.path);
      assert.match(definitionResult.definition.statements.join('\n'), /MergeTree/);
      const definitionResultForFixture = {
        ...definitionResult,
        definition: { ...definitionResult.definition, generatedAt: '2024-01-01T00:00:00.000Z' },
      };
      controlSnapshots.push({
        channel: IPC.treeDefinition,
        args: { connectionId: config.id, path: orderItemsNode.path, tabId: null },
        response: definitionResultForFixture,
      });

      // D30: the console tab is really SQL mode — SELECT 1. ConsoleView.vue's runStatement() sends
      // statementAtCursor()'s own trimmed text, excluding the trailing delimiter — typing
      // "SELECT 1;" produces the request "SELECT 1", not "SELECT 1;" (same finding as mysql's).
      const executePayload = {
        opId: 'be-console-select1',
        tabId: null,
        connectionId: config.id,
        path: dbNode.path,
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
        writeFixtureModule(
          fixturePathFor('clickhouse'),
          'clickhouse',
          controlSnapshots,
          portSnapshots,
        );
        return;
      }

      assert.deepEqual(JSON.parse(JSON.stringify(controlSnapshots)), savedControl);
      assert.deepEqual(JSON.parse(JSON.stringify(portSnapshots)), savedPort);
    } finally {
      await harness.close();
    }
  });
});
