import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { ConnectionSummary } from '@shared/domain/connection';
import { DATA_OP } from '@shared/protocol/data-ops';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { IPC } from '@shared/protocol/ipc';
import { rabbitmqCaps } from '../../../src/engine/adapters/rabbitmq/caps';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
import { type RabbitMqFixture, startRabbitMq } from '../../db/support/rabbitmq';
import { fixturePathFor, isFixtureWriteMode, writeFixtureModule } from '../support/capture';
import { decodePage } from '../support/decode';
import { openHarness } from '../support/harness';
import type { ControlSnapshot, PortSnapshot } from '../support/types';
import { controlSnapshots as savedControl, portSnapshots as savedPort } from './rabbitmq.fixture';

// P50 §4.4 — rabbitmq. The Add-Connection-dialog flow is left to tests/e2e/connections.spec.ts
// (kept, unchanged); this split's frontend half starts from an already-listed connection. The
// "Exchanges" folder heading is a frontend-only grouping over real exchange-kind nodes, same
// reasoning as mysql's "Routines" (P50 §4.4) — no backend "folder" node kind exists.

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

let rabbitmq: RabbitMqFixture;

before(
  async () => {
    if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
    rabbitmq = await startRabbitMq();
  },
  { timeout: CONTAINER_START_TIMEOUT_MS },
);

after(async () => {
  await rabbitmq?.stop();
});

function findByName<T extends { name: string }>(nodes: T[], name: string, what: string): T {
  const node = nodes.find((n) => n.name === name);
  assert.ok(
    node,
    `expected a ${what} node named ${name}, got ${JSON.stringify(nodes.map((n) => n.name))}`,
  );
  return node;
}

describe('rabbitmq IPC boundary', () => {
  test('connect, tree, poll (requeue warning), publish, exchange definition', async () => {
    const harness = await openHarness();
    const controlSnapshots: ControlSnapshot[] = [];
    const portSnapshots: PortSnapshot[] = [];
    try {
      const config = rabbitmq.config;

      const connectResult = await harness.connect(config);
      assert.match(connectResult.serverVersion, /^RabbitMQ 4\./);
      assert.deepEqual(connectResult.caps, rabbitmqCaps);
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
      const vhostNode = findByName(root.nodes, config.database ?? 'kira', 'database');

      // D16: the nameless default exchange never appears as a row at all — already proven at the
      // adapter level (tests/db/rabbitmq.spec.ts) with the identical fixture data; control.ts/
      // tree-service.ts can only re-wrap and cache what the adapter returns, so re-asserting it
      // here would add nothing (P50's own db-vs-ipc overlap review).
      const vhostChildren = await harness.children(config.id, vhostNode.path);
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: vhostNode.path, refresh: false },
        response: vhostChildren,
      });
      const ordersQueueNode = findByName(vhostChildren.nodes, 'orders', 'queue');
      const ordersExchangeNode = findByName(vhostChildren.nodes, 'orders.direct', 'exchange');

      // Poll (a stream read, batch pagination — never auto-loads, D10/D12).
      const pollPayload = {
        opId: 'be-poll-orders',
        tabId: null,
        connectionId: config.id,
        path: ordersQueueNode.path,
        projection: null,
        filter: null,
        sort: null,
        // streamTabStateSchema's own default (domain/tabs.ts) is 100, not the smallest offered
        // option — the page-size picker only decides which *choices* are visible (capped by
        // caps.maxPageSize), not what a fresh tab requests before any click.
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
        // D32/scenario 5: the key column carries the routing key (the seed sets it to the queue's
        // own name) — already proven at the adapter level with the same fixture data
        // (tests/db/rabbitmq.spec.ts), so only the page-is-real precondition is re-asserted here.
        assert.ok(pollLogical.keys.length > 0);
        // The seed publishes these messages at container-start time (real wall-clock), so their
        // timestamps differ run to run — frozen for the fixture, same D6 pattern as everywhere
        // else a wall-clock value has turned up in this phase.
        pollLogical = {
          ...pollLogical,
          timestamps: pollLogical.timestamps.map(() => '2024-01-01T00:00:00.000Z'),
        };
      }
      portSnapshots.push({
        op: DATA_OP.read,
        payload: pollPayload,
        response: { kind: 'read', page: pollLogical, source: pollResult.source as 'server' },
      });

      // Publish (mutate — the only mutation this protocol has; canUpdate/canDelete permanently
      // false, D25/D26).
      const publishPayload = {
        opId: 'be-publish-orders',
        tabId: null,
        connectionId: config.id,
        path: ordersQueueNode.path,
        ops: [{ kind: 'insert' as const, values: { $body: 'hello from the UI' } }],
      };
      const publishResult = await harness.dataOp<{ affectedRows: number }>(
        DATA_OP.mutate,
        publishPayload,
      );
      assert.equal(publishResult.affectedRows, 1);
      portSnapshots.push({
        op: DATA_OP.mutate,
        payload: publishPayload,
        response: { kind: 'mutate', affectedRows: publishResult.affectedRows },
      });
      // stream/mutations.ts's createImmediateMutator calls reload() after every mutation, which
      // invalidates before reloading (same shape as keyvalue's own reload(), P50 §4.3's redis
      // finding) — without this snapshot the publish's own immediate-reload silently fails.
      const invalidatePayload = { connectionId: config.id, path: ordersQueueNode.path };
      await harness.dataOp(DATA_OP.invalidate, invalidatePayload);
      portSnapshots.push({
        op: DATA_OP.invalidate,
        payload: invalidatePayload,
        response: { kind: 'invalidate' },
      });

      // Re-poll after publish — the exact same request shape as pollPayload above (a poll is
      // always offset 0, no resumable position), so this is a second portSnapshots entry for
      // the identical (op, payload) key; mockPort.ts answers same-key entries in fixture order,
      // one per call, so the frontend's second Poll click (after its own publish) sees this one.
      const rePollResult = await harness.dataOp<{ page: unknown; source: string }>(DATA_OP.read, {
        ...pollPayload,
        opId: 'be-poll-orders-after-publish',
      });
      let rePollLogical = decodePage(rePollResult.page as Parameters<typeof decodePage>[0]);
      assert.equal(rePollLogical.kind, 'stream');
      if (rePollLogical.kind === 'stream') {
        assert.ok(rePollLogical.bodies.some((b) => b === 'hello from the UI'));
        rePollLogical = {
          ...rePollLogical,
          timestamps: rePollLogical.timestamps.map(() => '2024-01-01T00:00:00.000Z'),
        };
      }
      portSnapshots.push({
        op: DATA_OP.read,
        payload: pollPayload,
        response: { kind: 'read', page: rePollLogical, source: rePollResult.source as 'server' },
      });

      // Exchange definition — an "Exchange" properties section and a "Bindings from this
      // exchange" section (D30/D33); what sections render and their order is the frontend's own
      // concern, this half's job is only that the real definition text contains what the UI must
      // find.
      const definitionResult = await harness.definition(config.id, ordersExchangeNode.path);
      assert.match(definitionResult.definition.statements.join('\n'), /direct/);
      // ObjectDefinition.generatedAt is wall-clock (when this definition text was built), not
      // part of the exchange's own real state — frozen for the fixture, same pattern as every
      // other wall-clock-derived field this phase has already excluded (D6).
      const definitionResultForFixture = {
        ...definitionResult,
        definition: { ...definitionResult.definition, generatedAt: '2024-01-01T00:00:00.000Z' },
      };
      controlSnapshots.push({
        channel: IPC.treeDefinition,
        args: {
          connectionId: config.id,
          path: ordersExchangeNode.path,
          refresh: false,
          tabId: null,
        },
        response: definitionResultForFixture,
      });

      if (isFixtureWriteMode()) {
        writeFixtureModule(fixturePathFor('rabbitmq'), 'rabbitmq', controlSnapshots, portSnapshots);
        return;
      }

      assert.deepEqual(JSON.parse(JSON.stringify(controlSnapshots)), savedControl);
      assert.deepEqual(JSON.parse(JSON.stringify(portSnapshots)), savedPort);
    } finally {
      await harness.close();
    }
  });
});
