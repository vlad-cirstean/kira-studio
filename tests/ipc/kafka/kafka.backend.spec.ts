import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { ConnectionSummary } from '@shared/domain/connection';
import { DATA_OP } from '@shared/protocol/data-ops';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import { IPC } from '@shared/protocol/ipc';
import { kafkaCaps } from '../../../src/engine/adapters/kafka/caps';
import {
  CONSUMER_GROUP,
  EMPTY_TOPIC,
  ORDERS_MESSAGE_COUNT,
  ORDERS_PARTITION_COUNT,
  ORDERS_TOPIC,
} from '../../db/fixtures/0005_kafka_seed';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
import { type KafkaFixture, startKafka } from '../../db/support/kafka';
import { fixturePathFor, isFixtureWriteMode, writeFixtureModule } from '../support/capture';
import { decodePage } from '../support/decode';
import { openHarness } from '../support/harness';
import type { ControlSnapshot, PortSnapshot } from '../support/types';
import { controlSnapshots as savedControl, portSnapshots as savedPort } from './kafka.fixture';

// P50 §4.4 — kafka. The Add-Connection-dialog flow is left to tests/ui/connections.spec.ts (kept,
// unchanged); this split's frontend half starts from an already-listed connection. "Consumer
// groups" is a frontend-only grouping over real consumerGroup-kind nodes at root — same reasoning
// as mysql's "Routines"/clickhouse's "Views" findings (P50 §4.4) — no backend "folder" node kind
// exists. A topic no longer expands in the tree (P23 D3) but still enumerates its own partitions
// via children() (P23 D4) — StreamView.vue's partition-filter popover is a second, live caller of
// that same call, so this split captures it too.

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

let kafka: KafkaFixture;

before(
  async () => {
    if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
    kafka = await startKafka();
  },
  { timeout: CONTAINER_START_TIMEOUT_MS },
);

after(async () => {
  await kafka?.stop();
});

function findByName<T extends { name: string }>(nodes: T[], name: string, what: string): T {
  const node = nodes.find((n) => n.name === name);
  assert.ok(
    node,
    `expected a ${what} node named ${name}, got ${JSON.stringify(nodes.map((n) => n.name))}`,
  );
  return node;
}

// The group coordinator's own advertised host:port is real, run-to-run volatile data — the host
// is the container's Docker-assigned hostname (a fresh random hex id every run,
// @testcontainers/kafka's own kafka-container.js), and the port is the PLAINTEXT listener's own
// host-mapped ephemeral port (Testcontainers picks a fresh one every run, same as every other
// adapter's own mapped port) — frozen together the same way every other wall-clock/random-id
// finding this phase has already excluded (D6). It appears both as a structured row (coordinator,
// a single "host:port" string) and as two separate fields inside the definition's own JSON
// statements text (`doc.coordinator.host`/`.port`, kafka/definition.ts), so each needs its own
// substitution rather than one shared string replace.
const FIXTURE_COORDINATOR_ROW = 'fixture-broker-host:0';
function freezeCoordinator<
  T extends {
    statements: string[];
    sections: { rows: { name: string; value: string; detail: string | null }[] }[];
  },
>(definition: T): T {
  return {
    ...definition,
    statements: definition.statements.map((text) => {
      const doc = JSON.parse(text) as { coordinator?: { host: string; port: number } };
      if (doc.coordinator) doc.coordinator = { host: 'fixture-broker-host', port: 0 };
      return JSON.stringify(doc, null, 2);
    }),
    sections: definition.sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) =>
        row.name === 'coordinator' ? { ...row, value: FIXTURE_COORDINATOR_ROW } : row,
      ),
    })),
  };
}

// The Kafka client's own read fans across both partitions and interleaves them by arrival, not by
// any key/offset order — confirmed empirically: two consecutive KIRA_IPC_FIXTURES=write runs
// against fresh, identically-seeded containers returned the same six messages in different
// orders. Sorting by key before a fixture ever sees the page makes the capture deterministic
// without weakening what this scenario actually tests (a real page-worth of the seeded messages,
// decoded and rendered) — same reasoning as redis's own HSCAN reordering finding (P50 §4.3).
function sortStreamByKey<
  T extends {
    kind: 'stream';
    keys: (string | null)[];
    headers: (string | null)[];
    attrs: (string | null)[];
    timestamps: (string | null)[];
    bodies: (string | null)[];
  },
>(page: T): T {
  const order = page.keys
    .map((_, i) => i)
    .sort((a, b) => (page.keys[a] ?? '').localeCompare(page.keys[b] ?? ''));
  return {
    ...page,
    keys: order.map((i) => page.keys[i]),
    headers: order.map((i) => page.headers[i]),
    attrs: order.map((i) => page.attrs[i]),
    timestamps: order.map((i) => page.timestamps[i]),
    bodies: order.map((i) => page.bodies[i]),
  };
}

describe('kafka IPC boundary', () => {
  test('connect, tree (topics + consumer groups), partition list, stream tab (offsetWindow), definitions', async () => {
    const harness = await openHarness();
    const controlSnapshots: ControlSnapshot[] = [];
    const portSnapshots: PortSnapshot[] = [];
    try {
      const config = kafka.config;

      const connectResult = await harness.connect(config);
      assert.equal(connectResult.serverVersion, 'Kafka');
      assert.deepEqual(connectResult.caps, kafkaCaps);
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

      // --- tree: topics and consumer groups both at root, ungrouped by the backend -------------
      const root = await harness.children(config.id, '');
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: '', refresh: false },
        response: root,
      });
      const ordersTopicNode = findByName(root.nodes, ORDERS_TOPIC, 'topic');
      const emptyTopicNode = findByName(root.nodes, EMPTY_TOPIC, 'topic');
      const groupNode = findByName(root.nodes, CONSUMER_GROUP, 'consumerGroup');

      // --- the partition-filter popover's own live children() call against the topic path -------
      const partitions = await harness.children(config.id, ordersTopicNode.path);
      assert.equal(partitions.nodes.length, ORDERS_PARTITION_COUNT);
      controlSnapshots.push({
        channel: IPC.treeChildren,
        args: { connectionId: config.id, path: ordersTopicNode.path, refresh: false },
        response: partitions,
      });

      // --- open the orders topic: offsetWindow auto-loads on mount --------------------------
      const readPayload = {
        opId: 'be-read-orders',
        tabId: null,
        connectionId: config.id,
        path: ordersTopicNode.path,
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
      let readLogical = decodePage(readResult.page as Parameters<typeof decodePage>[0]);
      assert.equal(readLogical.kind, 'stream');
      if (readLogical.kind === 'stream') {
        assert.equal(readLogical.keys.length, ORDERS_MESSAGE_COUNT);
        assert.ok(readLogical.keys.every((k) => k !== null && /^key-\d$/.test(k)));
        assert.equal(readLogical.position.hasMore, false);
        // The seed publishes these messages at container-start time (real wall-clock), so their
        // timestamps differ run to run — frozen for the fixture, same D6 pattern as everywhere
        // else a wall-clock value has turned up in this phase.
        readLogical = sortStreamByKey({
          ...readLogical,
          timestamps: readLogical.timestamps.map(() => '2024-01-01T00:00:00.000Z'),
        });
      }
      portSnapshots.push({
        op: DATA_OP.read,
        payload: readPayload,
        response: { kind: 'read', page: readLogical, source: readResult.source as 'server' },
      });

      // --- an empty topic's read comes back with zero rows, no error -------------------------
      const emptyReadPayload = {
        opId: 'be-read-empty',
        tabId: null,
        connectionId: config.id,
        path: emptyTopicNode.path,
        projection: null,
        filter: null,
        sort: null,
        pageSize: 100 as const,
        cursor: { mode: 'offset' as const, offset: 0 },
      };
      const emptyReadResult = await harness.dataOp<{ page: unknown; source: string }>(
        DATA_OP.read,
        emptyReadPayload,
      );
      const emptyReadLogical = decodePage(emptyReadResult.page as Parameters<typeof decodePage>[0]);
      assert.equal(emptyReadLogical.kind, 'stream');
      if (emptyReadLogical.kind === 'stream') assert.equal(emptyReadLogical.keys.length, 0);
      portSnapshots.push({
        op: DATA_OP.read,
        payload: emptyReadPayload,
        response: {
          kind: 'read',
          page: emptyReadLogical,
          source: emptyReadResult.source as 'server',
        },
      });

      // --- the orders topic's definition — Partitions + Configuration (no describeConfigs, D14) -
      const topicDefinitionResult = await harness.definition(config.id, ordersTopicNode.path);
      const partitionsSection = topicDefinitionResult.definition.sections.find(
        (s) => s.title === 'Partitions',
      );
      assert.ok(partitionsSection);
      assert.equal(partitionsSection?.rows.length, ORDERS_PARTITION_COUNT);
      const configSection = topicDefinitionResult.definition.sections.find(
        (s) => s.title === 'Configuration',
      );
      assert.equal(configSection?.rows.length, 0);
      const topicDefinitionForFixture = {
        ...topicDefinitionResult,
        definition: {
          ...topicDefinitionResult.definition,
          generatedAt: '2024-01-01T00:00:00.000Z',
        },
      };
      // definition/state.ts's own load() only passes `refresh: true` on an explicit Refresh click
      // (DefinitionView.vue's onRefresh) — the initial onMounted call omits the key entirely
      // (`opts?.refresh` is `undefined`), so this snapshot must omit it too, or mockControl's
      // arg-matching (exercised here since this channel now has two snapshots, one per path)
      // never hits it — same finding as sqs's own treeDefinition pair.
      controlSnapshots.push({
        channel: IPC.treeDefinition,
        args: { connectionId: config.id, path: ordersTopicNode.path, tabId: null },
        response: topicDefinitionForFixture,
      });

      // --- the consumer group's definition — Group/Members/Committed offsets (P23 D7) -----------
      const groupDefinitionResult = await harness.definition(config.id, groupNode.path);
      const offsetsSection = groupDefinitionResult.definition.sections.find(
        (s) => s.title === 'Committed offsets',
      );
      assert.equal(offsetsSection?.rows.length, ORDERS_PARTITION_COUNT);
      const coordinatorRow = groupDefinitionResult.definition.sections
        .find((s) => s.title === 'Group')
        ?.rows.find((r) => r.name === 'coordinator');
      assert.ok(coordinatorRow);
      const groupDefinitionForFixture = {
        ...groupDefinitionResult,
        definition: freezeCoordinator({
          ...groupDefinitionResult.definition,
          generatedAt: '2024-01-01T00:00:00.000Z',
        }),
      };
      controlSnapshots.push({
        channel: IPC.treeDefinition,
        args: { connectionId: config.id, path: groupNode.path, tabId: null },
        response: groupDefinitionForFixture,
      });

      if (isFixtureWriteMode()) {
        writeFixtureModule(fixturePathFor('kafka'), 'kafka', controlSnapshots, portSnapshots);
        return;
      }

      assert.deepEqual(JSON.parse(JSON.stringify(controlSnapshots)), savedControl);
      assert.deepEqual(JSON.parse(JSON.stringify(portSnapshots)), savedPort);
    } finally {
      await harness.close();
    }
  });
});
