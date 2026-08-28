import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { ConnectionSummary } from '@shared/domain/connection';
import { DATA_OP } from '@shared/protocol/data-ops';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { IPC } from '@shared/protocol/ipc';
import { sqsCaps } from '../../../src/engine/adapters/sqs/caps';
import { DRAIN_QUEUE, EMPTY_QUEUE, ORDERS_QUEUE } from '../../db/fixtures/0006_sqs_seed';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
import { type SqsFixture, startSqs } from '../../db/support/sqs';
import { fixturePathFor, isFixtureWriteMode, writeFixtureModule } from '../support/capture';
import { decodePage } from '../support/decode';
import { openHarness } from '../support/harness';
import type { ControlSnapshot, PortSnapshot } from '../support/types';
import { controlSnapshots as savedControl, portSnapshots as savedPort } from './sqs.fixture';

// P50 §4.4 — sqs. The connectionsCreate (uri mode) flow is left to
// tests/ui/connections.spec.ts (kept, unchanged) — this split's frontend half starts from an
// already-listed connection, same as every other adapter split. `opsRecent` (the ops-log
// assertions the original spec makes — no describe op, no error op, after opening/refreshing the
// definition tab) is mocked to return `[]` on the frontend half: true by construction here (this
// backend half never issues an ENGINE_OP.describe call for sqs at all, since describe:false),
// rather than a claim about a live op log the mocked frontend has no way to inspect.

const CONTAINER_START_TIMEOUT_MS = 120_000;

function connectionSummaryOf(config: ResolvedConnectionConfig): ConnectionSummary {
  const { password: _password, ...summary } = config;
  return {
    ...summary,
    host: 'fixture-host',
    port: 0,
    // LocalStack's own ephemeral host port, carried in options.endpoint for sqs's uri-mode
    // connections (support/sqs.ts) — frozen for the same reason host/port are.
    options: { ...summary.options, endpoint: 'http://fixture-host:0' },
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    preconnect: null,
    preconnectSidecar: false,
  };
}

// CreatedTimestamp/LastModifiedTimestamp are LocalStack's own epoch-seconds wall-clock (when the
// queue was created this run) — embedded both as raw JSON text (statements[0]) and as structured
// rows (sections), so both need the same substitution rather than a field reassignment.
const FIXTURE_EPOCH = '1700000000';
function freezeQueueTimestamps<
  T extends {
    statements: string[];
    sections: { rows: { name: string; value: string; detail: string | null }[] }[];
  },
>(definition: T): T {
  const replaceEpoch = (text: string) => text.replace(/\d{10}/g, FIXTURE_EPOCH);
  return {
    ...definition,
    statements: definition.statements.map(replaceEpoch),
    sections: definition.sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) =>
        row.name === 'CreatedTimestamp' || row.name === 'LastModifiedTimestamp'
          ? { ...row, value: FIXTURE_EPOCH }
          : row,
      ),
    })),
  };
}

let sqs: SqsFixture;

before(
  async () => {
    if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
    sqs = await startSqs();
  },
  { timeout: CONTAINER_START_TIMEOUT_MS },
);

after(async () => {
  await sqs?.stop();
});

function findByName<T extends { name: string }>(nodes: T[], name: string, what: string): T {
  const node = nodes.find((n) => n.name === name);
  assert.ok(
    node,
    `expected a ${what} node named ${name}, got ${JSON.stringify(nodes.map((n) => n.name))}`,
  );
  return node;
}

describe('sqs IPC boundary', () => {
  test('connect, flat queue tree, stream tab (batch, Poll-only), definition', async () => {
    const harness = await openHarness();
    const controlSnapshots: ControlSnapshot[] = [];
    const portSnapshots: PortSnapshot[] = [];
    try {
      const config = sqs.config;

      const connectResult = await harness.connect(config);
      assert.deepEqual(connectResult.caps, sqsCaps);
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
      // opsRecent: mocked to `[]` — true by construction here (no describe op is ever issued;
      // see the file header).
      controlSnapshots.push({ channel: IPC.opsRecent, args: undefined, response: [] });

      // --- tree: a flat queue list, no nested level under any queue --------------------------
      const root = await harness.children(config.id, '');
      assert.equal(root.source, 'server');
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: '', refresh: false },
        response: root,
      });
      const ordersQueueNode = findByName(root.nodes, ORDERS_QUEUE, 'queue');
      const emptyQueueNode = findByName(root.nodes, EMPTY_QUEUE, 'queue');
      findByName(root.nodes, DRAIN_QUEUE, 'queue');

      // --- open the orders queue: batch pagination never auto-loads --------------------------
      const pollPayload = {
        opId: 'be-poll-orders',
        tabId: null,
        connectionId: config.id,
        path: ordersQueueNode.path,
        projection: null,
        filter: null,
        sort: null,
        pageSize: 100 as const,
        cursor: { mode: 'offset' as const, offset: 0 },
      };
      const pollResult = await harness.dataOp<{ page: unknown; source: string }>(
        DATA_OP.read,
        pollPayload,
      );
      let pollLogical = decodePage(pollResult.page as Parameters<typeof decodePage>[0]);
      assert.equal(pollLogical.kind, 'stream');
      if (pollLogical.kind === 'stream') {
        assert.ok(pollLogical.keys.length > 0);
        assert.ok(pollLogical.visibilityTimeoutSeconds !== null);
        // Three more real, run-to-run-volatile values, all frozen the same way (D6): the key
        // column is SQS's own randomly-generated MessageId (a fresh UUID every SendMessage call,
        // not merely reordered like mariadb's HSCAN finding); `timestamps` is the receive time;
        // and `attrs`' own SentTimestamp/ApproximateFirstReceiveTimestamp are wall-clock epoch-ms
        // embedded inside each row's JSON string, so those two keys are rewritten in place
        // rather than the whole attrs value being replaced (ApproximateReceiveCount is real,
        // stable data — the fixture keeps it).
        pollLogical = {
          ...pollLogical,
          keys: pollLogical.keys.map((_, i) => `msg-${i}`),
          timestamps: pollLogical.timestamps.map(() => '2024-01-01T00:00:00.000Z'),
          attrs: pollLogical.attrs.map((raw) => {
            if (raw === null) return raw;
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            parsed.SentTimestamp = '1700000000000';
            parsed.ApproximateFirstReceiveTimestamp = '1700000000000';
            return JSON.stringify(parsed);
          }),
        };
      }
      portSnapshots.push({
        op: DATA_OP.read,
        payload: pollPayload,
        response: { kind: 'read', page: pollLogical, source: pollResult.source as 'server' },
      });

      // A Poll click on the cell-editor-open scenario invalidates before reloading (same
      // createImmediateMutator-adjacent reload path stream/state.ts's own reload() takes for
      // every stream view — P50's redis/rabbitmq finding, generalised).
      const invalidatePayload = { connectionId: config.id, path: ordersQueueNode.path };
      await harness.dataOp(DATA_OP.invalidate, invalidatePayload);
      portSnapshots.push({
        op: DATA_OP.invalidate,
        payload: invalidatePayload,
        response: { kind: 'invalidate' },
      });

      // --- empty queue: approximate count carries a stale-looking "~0 total" -----------------
      // stream/state.ts's own runCount (unlike grid/state.ts's) never sends a `refresh` field at
      // all — there is no rt.count?.stale-driven bypass here, so this payload must omit the key
      // entirely to match the real wire request byte-for-byte (mockPort's match key would
      // otherwise never hit).
      const countPayload = {
        opId: 'be-count-empty',
        tabId: null,
        connectionId: config.id,
        path: emptyQueueNode.path,
        filter: null,
      };
      // value:0/exact:false on an empty queue is already proven at the adapter level with the
      // same fixture data (tests/db/sqs.spec.ts) — handleCount passes both through verbatim, so
      // re-asserting them here would add nothing (P50's own db-vs-ipc overlap review). The
      // fixture's own deepEqual still pins both values via the snapshot push below.
      const countResult = await harness.dataOp<{
        value: number;
        exact: boolean;
        source: string;
      }>(DATA_OP.count, countPayload);
      portSnapshots.push({
        op: DATA_OP.count,
        payload: countPayload,
        response: {
          kind: 'count',
          value: countResult.value,
          exact: countResult.exact,
          stale: false,
          source: countResult.source as 'server',
        },
      });

      // --- the orders queue's definition — an Attributes section, no console button (P23 D9) -
      const definitionResult = await harness.definition(config.id, ordersQueueNode.path);
      assert.ok(definitionResult.definition.statements.length > 0);
      const definitionResultForFixture = {
        ...definitionResult,
        definition: freezeQueueTimestamps({
          ...definitionResult.definition,
          generatedAt: '2024-01-01T00:00:00.000Z',
        }),
      };
      // definition/state.ts's own load() only passes `refresh: true` on an explicit Refresh click
      // (DefinitionView.vue's onRefresh) — the initial onMounted call omits the key entirely
      // (`opts?.refresh` is `undefined`), so this first snapshot must omit it too, or mockControl's
      // arg-matching (exercised here since this channel now has two snapshots) never hits it.
      controlSnapshots.push({
        channel: IPC.treeDefinition,
        args: { connectionId: config.id, path: ordersQueueNode.path, tabId: null },
        response: definitionResultForFixture,
      });
      // The definition tab's own explicit Refresh re-issues the identical request (same shape as
      // rabbitmq's/redis's own before/after pairs) — captured a second time so the mocked
      // frontend's refresh click has a snapshot to match.
      controlSnapshots.push({
        channel: IPC.treeDefinition,
        args: { connectionId: config.id, path: ordersQueueNode.path, refresh: true, tabId: null },
        response: definitionResultForFixture,
      });

      if (isFixtureWriteMode()) {
        writeFixtureModule(fixturePathFor('sqs'), 'sqs', controlSnapshots, portSnapshots);
        return;
      }

      assert.deepEqual(JSON.parse(JSON.stringify(controlSnapshots)), savedControl);
      assert.deepEqual(JSON.parse(JSON.stringify(portSnapshots)), savedPort);
    } finally {
      await harness.close();
    }
  });
});
