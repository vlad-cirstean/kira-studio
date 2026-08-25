import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { encodeKafkaStreamFilter, type KafkaStreamFilter } from '@shared/domain/streamFilter';
import type { NodePath } from '@shared/domain/tree';
import type { AdapterDeps, OpCtx } from '../../src/engine/adapters/adapter';
import { AdapterError, type AdapterErrorCode } from '../../src/engine/adapters/errors';
import { kafkaCaps } from '../../src/engine/adapters/kafka/caps';
import { createAdapter } from '../../src/engine/adapters/registry';
import { encodePageToken, requestFingerprint } from '../../src/engine/adapters/sql-text';
import { cellText, isNull, type StreamPage } from '../../src/shared/protocol/page';
import {
  CONSUMER_GROUP,
  EMPTY_TOPIC,
  ORDERS_MESSAGE_COUNT,
  ORDERS_PARTITION_COUNT,
  ORDERS_TOPIC,
} from '../db/fixtures/0005_kafka_seed';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../db/support/docker';
import { type KafkaFixture, startKafka } from '../db/support/kafka';
import { readStream } from '../db/support/page';

// P32 D27/D28: this suite left Bun for `ELECTRON_RUN_AS_NODE=1 electron` (test:db:kafka) because
// Bun cannot load the native driver at any ABI (F21). node:test/node:assert/strict replace
// bun:test/expect mechanically — every assertion here is the same check, not a new one. The
// fixture/support files stay under tests/db/ and stay client-free (0005_kafka_seed.ts, support/
// kafka.ts, support/docker.ts, support/page.ts) since tests/ui/kafka.spec.ts also imports them,
// from a third runtime again.

const CONTAINER_START_TIMEOUT_MS = 180_000;

const deps: AdapterDeps = {
  log(level, message) {
    if (level === 'error') console.error(`[kafka adapter] ${message}`);
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
  return { connectionId: 'test-kafka', segments };
}

function topicPath(topic: string): NodePath {
  return path([{ kind: 'topic', name: topic }]);
}

function groupPath(groupId: string): NodePath {
  return path([{ kind: 'consumerGroup', name: groupId }]);
}

const decoder = new TextDecoder();

interface StreamRow {
  key: string | null;
  headers: Record<string, unknown>;
  attrs: Record<string, unknown>;
  timestamp: string | null;
  body: string;
}

function rowAt(page: StreamPage, row: number): StreamRow {
  return {
    key: isNull(page.keys, row) ? null : cellText(page.keys, row, decoder),
    headers: JSON.parse(cellText(page.headers, row, decoder)),
    attrs: JSON.parse(cellText(page.attrs, row, decoder)),
    timestamp: isNull(page.timestamps, row) ? null : cellText(page.timestamps, row, decoder),
    body: cellText(page.bodies, row, decoder),
  };
}

/** preview()/cancel() are synchronous — assert.rejects doesn't apply. */
function expectSyncThrow(fn: () => unknown, code: AdapterErrorCode): void {
  try {
    fn();
    throw new Error('expected the call to throw');
  } catch (err) {
    assert.ok(err instanceof AdapterError);
    assert.strictEqual((err as AdapterError).code, code);
  }
}

async function assertRejectsWithCode(p: Promise<unknown>, code: AdapterErrorCode): Promise<void> {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof AdapterError);
    assert.strictEqual((err as AdapterError).code, code);
    return true;
  });
}

let fixture: KafkaFixture;

before(
  async () => {
    if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
    fixture = await startKafka();
  },
  { timeout: CONTAINER_START_TIMEOUT_MS },
);

after(async () => {
  await fixture?.stop();
});

describe('kafka adapter (§9.1, P10)', () => {
  test('1. connect / disconnect', async () => {
    const adapter = await createAdapter('kafka', deps);
    const info = await adapter.connect(fixture.config, makeCtx());
    assert.strictEqual(info.serverVersion, 'Kafka');
    // P32 D13/D29: this client has no describeCluster() — details reports the configured
    // bootstrap-server count instead of a live cluster id.
    assert.ok(info.details?.brokers);
    await adapter.disconnect();

    await assertRejectsWithCode(adapter.children(path([]), makeCtx()), 'E_CONNECT');
  });

  test('2. cap honesty', () => {
    assert.strictEqual(kafkaCaps.tabular, false);
    assert.strictEqual(kafkaCaps.stream, true);
    assert.strictEqual(kafkaCaps.defaultPageKind, 'stream');
    assert.strictEqual(kafkaCaps.definition, true);
    assert.strictEqual(kafkaCaps.sql, false);
    assert.strictEqual(kafkaCaps.exactCount, true);
    assert.strictEqual(kafkaCaps.pagination, 'offsetWindow');
    // A topic's log is immutable — canUpdate/canDelete stay false permanently, but
    // kafka/produce.ts's producer().send() lands a real canInsert (this session's addition).
    assert.strictEqual(kafkaCaps.canInsert, true);
    assert.strictEqual(kafkaCaps.canUpdate, false);
    assert.strictEqual(kafkaCaps.canDelete, false);
    assert.strictEqual(kafkaCaps.writable, true);
    assert.strictEqual(kafkaCaps.cancel, true);
    assert.strictEqual(kafkaCaps.fileTransfer, false);
  });

  test('3. tree enumeration: root is topics + consumer groups, siblings', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const root = await adapter.children(path([]), makeCtx());
      const topics = root.filter((n) => n.kind === 'topic').map((n) => n.name);
      const groups = root.filter((n) => n.kind === 'consumerGroup').map((n) => n.name);
      assert.deepStrictEqual(topics, [EMPTY_TOPIC, ORDERS_TOPIC].sort());
      assert.deepStrictEqual(groups, [CONSUMER_GROUP]);
      // Neither root-level internal topics (__consumer_offsets) nor the group leaf's own
      // hasChildren promise should ever surface a nonexistent twisty.
      const group = root.find((n) => n.kind === 'consumerGroup');
      assert.strictEqual(group?.hasChildren, false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('4. tree enumeration: a topic node has hasChildren:false (P23 D3), children() still works', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // D3: the tree no longer expands a topic — its root-level node says so — but D4 keeps
      // children() itself enumerating real partitions, since StreamView.vue's partition filter is
      // a second, live caller of exactly this call.
      const root = await adapter.children(path([]), makeCtx());
      const ordersNode = root.find((n) => n.kind === 'topic' && n.name === ORDERS_TOPIC);
      assert.strictEqual(ordersNode?.hasChildren, false);

      const partitions = await adapter.children(topicPath(ORDERS_TOPIC), makeCtx());
      assert.strictEqual(partitions.length, ORDERS_PARTITION_COUNT);
      assert.ok(partitions.every((n) => n.kind === 'partition' && n.hasChildren === false));
      assert.deepStrictEqual(
        partitions.map((n) => n.name),
        ['0', '1'],
      );
    } finally {
      await adapter.disconnect();
    }
  });

  test('5. children of a leaf (partition / consumer group)', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const partitionChildren = await adapter.children(
        path([
          { kind: 'topic', name: ORDERS_TOPIC },
          { kind: 'partition', name: '0' },
        ]),
        makeCtx(),
      );
      assert.deepStrictEqual(partitionChildren, []);

      const groupChildren = await adapter.children(
        path([{ kind: 'consumerGroup', name: CONSUMER_GROUP }]),
        makeCtx(),
      );
      assert.deepStrictEqual(groupChildren, []);
    } finally {
      await adapter.disconnect();
    }
  });

  test('6. describe stays unsupported; definition shows a topic and a consumer group', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await assertRejectsWithCode(
        adapter.describe(topicPath(ORDERS_TOPIC), makeCtx()),
        'E_UNSUPPORTED',
      );

      // P23 D5: a topic's partitions (leader/replicas/isr — data the tree threw away, F8).
      // P32 D14: this client has no DescribeConfigs — Configuration stays, empty, with a note
      // saying why (a permanent degradation now, not an ACL-denied one).
      const topicDef = await adapter.definition(topicPath(ORDERS_TOPIC), makeCtx());
      assert.strictEqual(topicDef.kind, 'topic');
      assert.deepStrictEqual(
        topicDef.sections.map((s) => s.title),
        ['Partitions', 'Configuration'],
      );
      const partitions = topicDef.sections.find((s) => s.title === 'Partitions');
      assert.deepStrictEqual(
        partitions?.rows.map((r) => r.name),
        ['0', '1'],
      );
      assert.ok(partitions?.rows.every((r) => /^leader \d+$/.test(r.value)));
      const config = topicDef.sections.find((s) => s.title === 'Configuration');
      assert.strictEqual(config?.rows.length, 0);
      assert.ok(topicDef.notes.some((n) => /DescribeConfigs/.test(n)));

      // The seed consumer drained ORDERS_TOPIC and disconnected (0005_kafka_seed.ts), so the group
      // has real committed offsets but no active members — exactly the "empty section, not an
      // empty tab" case PropertiesSection.vue's own empty state exists for.
      const groupDef = await adapter.definition(groupPath(CONSUMER_GROUP), makeCtx());
      assert.strictEqual(groupDef.kind, 'consumerGroup');
      assert.deepStrictEqual(
        groupDef.sections.map((s) => s.title),
        ['Group', 'Members', 'Committed offsets'],
      );
      // P32 D15/D29: state is a numeric enum on this client — the definition view must resolve it
      // to a name (STABLE, EMPTY, ...), never render the bare digit.
      const groupSection = groupDef.sections.find((s) => s.title === 'Group');
      const stateRow = groupSection?.rows.find((r) => r.name === 'state');
      assert.match(stateRow?.value ?? '', /^[A-Za-z ]+$/);
      const offsets = groupDef.sections.find((s) => s.title === 'Committed offsets');
      assert.strictEqual(offsets?.rows.length, ORDERS_PARTITION_COUNT);
      assert.deepStrictEqual(offsets?.rows.map((r) => r.name).sort(), [
        `${ORDERS_TOPIC}[0]`,
        `${ORDERS_TOPIC}[1]`,
      ]);
    } finally {
      await adapter.disconnect();
    }
  });

  test('7. read: browses a topic across partitions, offsetWindow pagination', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const req = {
        path: topicPath(ORDERS_TOPIC),
        projection: null,
        filter: null,
        sort: null,
        pageSize: ORDERS_MESSAGE_COUNT,
      };
      const page = await readStream(
        adapter,
        { ...req, cursor: { mode: 'offset', offset: 0 } },
        makeCtx(),
      );
      assert.strictEqual(page.position.strategy, 'offsetWindow');
      assert.strictEqual(page.rowCount, ORDERS_MESSAGE_COUNT);
      assert.strictEqual(page.position.hasMore, false);
      assert.strictEqual(page.visibilityTimeoutSeconds, null);

      const seqs = Array.from({ length: page.rowCount }, (_, r) => {
        const row = rowAt(page, r);
        assert.match(row.key ?? '', /^key-\d$/);
        assert.strictEqual(row.headers.source, 'seed');
        assert.strictEqual(typeof row.attrs.partition, 'number');
        assert.strictEqual(typeof row.attrs.offset, 'string');
        assert.notStrictEqual(row.timestamp, null);
        return (JSON.parse(row.body) as { seq: number }).seq;
      }).sort((a, b) => a - b);
      assert.deepStrictEqual(
        seqs,
        Array.from({ length: ORDERS_MESSAGE_COUNT }, (_, i) => i),
      );
    } finally {
      await adapter.disconnect();
    }
  });

  test('8. read: a smaller page size pages forward with a token', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const req = {
        path: topicPath(ORDERS_TOPIC),
        projection: null,
        filter: null,
        sort: null,
        pageSize: 2,
      };
      const seen = new Set<number>();
      let cursor: { mode: 'offset'; offset: number } | { mode: 'after'; token: string } = {
        mode: 'offset',
        offset: 0,
      };
      for (let guard = 0; guard < ORDERS_MESSAGE_COUNT + 2; guard++) {
        const page = await readStream(adapter, { ...req, cursor }, makeCtx());
        for (let r = 0; r < page.rowCount; r++) {
          seen.add((JSON.parse(rowAt(page, r).body) as { seq: number }).seq);
        }
        if (!page.position.hasMore) break;
        const token = page.position.nextToken;
        if (!token) throw new Error('expected a nextToken on a truncated page');
        cursor = { mode: 'after', token };
      }
      assert.strictEqual(seen.size, ORDERS_MESSAGE_COUNT);
    } finally {
      await adapter.disconnect();
    }
  });

  test('9. read: an empty topic returns a terminal empty page', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readStream(
        adapter,
        {
          path: topicPath(EMPTY_TOPIC),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      assert.strictEqual(page.rowCount, 0);
      assert.strictEqual(page.position.hasMore, false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('10. read: forward-only — a "before" cursor is E_UNSUPPORTED', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await assertRejectsWithCode(
        readStream(
          adapter,
          {
            path: topicPath(ORDERS_TOPIC),
            projection: null,
            filter: null,
            sort: null,
            pageSize: 10,
            cursor: { mode: 'before', token: 'anything' },
          },
          makeCtx(),
        ),
        'E_UNSUPPORTED',
      );
    } finally {
      await adapter.disconnect();
    }
  });

  // admin.fetchTopicOffsets() on a genuinely-missing topic retries with this client's own default
  // backoff before finally rejecting — carried over from kafkajs's equivalent allowance
  // unverified in this sandbox (no Docker); the macOS/Colima box re-checks the actual duration
  // against librdkafka's own metadata-timeout behaviour (P32 D29).
  test('11. read: a nonexistent topic is E_QUERY, not E_NOT_FOUND', {
    timeout: 20_000,
  }, async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await assertRejectsWithCode(
        readStream(
          adapter,
          {
            path: topicPath('this-topic-was-never-created'),
            projection: null,
            filter: null,
            sort: null,
            pageSize: 10,
            cursor: { mode: 'offset', offset: 0 },
          },
          makeCtx(),
        ),
        'E_QUERY',
      );
    } finally {
      await adapter.disconnect();
    }
  });

  test('12. count: exact via high/low watermark subtraction', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      assert.deepStrictEqual(
        await adapter.count({ path: topicPath(ORDERS_TOPIC), filter: null }, makeCtx()),
        { value: ORDERS_MESSAGE_COUNT, exact: true },
      );
      assert.deepStrictEqual(
        await adapter.count({ path: topicPath(EMPTY_TOPIC), filter: null }, makeCtx()),
        { value: 0, exact: true },
      );
    } finally {
      await adapter.disconnect();
    }
  });

  test('13. preview/mutate: update/delete/execute stay unsupported (D13, canUpdate/canDelete false)', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // A topic's log is immutable — there is no per-message update or delete in the Kafka API,
      // only retention/compaction at the topic level (kafkaCaps's own comment). Only `insert`
      // (produce) is supported now; see test 16 for that path actually working end to end.
      expectSyncThrow(
        () =>
          adapter.preview({ path: topicPath(ORDERS_TOPIC), ops: [{ kind: 'delete', key: {} }] }),
        'E_UNSUPPORTED',
      );
      await assertRejectsWithCode(
        adapter.mutate(
          { path: topicPath(ORDERS_TOPIC), ops: [{ kind: 'update', key: {}, changes: {} }] },
          makeCtx(),
        ),
        'E_UNSUPPORTED',
      );
      await assertRejectsWithCode(
        adapter.execute({ path: topicPath(ORDERS_TOPIC), statements: ['x'] }, makeCtx()),
        'E_UNSUPPORTED',
      );
    } finally {
      await adapter.disconnect();
    }
  });

  test('14. cancel is a permanent no-op (D6/D14)', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      assert.strictEqual(await adapter.cancel(crypto.randomUUID()), false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('15. read: an already-cancelled signal aborts the browse', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const controller = new AbortController();
      controller.abort();
      const ctx: OpCtx = { opId: crypto.randomUUID(), signal: controller.signal, setCommand() {} };
      await assertRejectsWithCode(
        readStream(
          adapter,
          {
            path: topicPath(ORDERS_TOPIC),
            projection: null,
            filter: null,
            sort: null,
            pageSize: 10,
            cursor: { mode: 'offset', offset: 0 },
          },
          ctx,
        ),
        'E_CANCELLED',
      );
    } finally {
      await adapter.disconnect();
    }
  });

  test('16. mutate: producing a message actually appears in a fresh browse (canInsert)', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // EMPTY_TOPIC (not ORDERS_TOPIC) so this doesn't perturb the message-count assumptions
      // tests 7/8/12 make about ORDERS_TOPIC's seeded contents.
      const result = await adapter.mutate(
        {
          path: topicPath(EMPTY_TOPIC),
          ops: [
            {
              kind: 'insert',
              values: { $key: 'produced-key', $body: JSON.stringify({ seq: 999 }), $headers: null },
            },
          ],
        },
        makeCtx(),
      );
      assert.strictEqual(result.affectedRows, 1);

      const page = await readStream(
        adapter,
        {
          path: topicPath(EMPTY_TOPIC),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      assert.strictEqual(page.rowCount, 1);
      const row = rowAt(page, 0);
      assert.strictEqual(row.key, 'produced-key');
      assert.deepStrictEqual(JSON.parse(row.body), { seq: 999 });
    } finally {
      await adapter.disconnect();
    }
  });

  // P32 D19/D30: scenarios 17-20 are the proof of the phase's second half — "skip the group-join"
  // is otherwise unfalsifiable from the outside, since the code would look right and a regression
  // (someone reintroducing subscribe()) would pass every scenario above. These assert the cause,
  // not a timing.
  test('17. a browse joins no consumer group (D19/D30)', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // Several small pages, several consumers under the hood — the loop shape scenario 8 already
      // exercises, just watched from the tree's side afterward.
      const req = {
        path: topicPath(ORDERS_TOPIC),
        projection: null,
        filter: null,
        sort: null,
        pageSize: 2,
      };
      let cursor: { mode: 'offset'; offset: number } | { mode: 'after'; token: string } = {
        mode: 'offset',
        offset: 0,
      };
      for (let guard = 0; guard < ORDERS_MESSAGE_COUNT + 2; guard++) {
        const page = await readStream(adapter, { ...req, cursor }, makeCtx());
        if (!page.position.hasMore) break;
        const token = page.position.nextToken;
        if (!token) throw new Error('expected a nextToken on a truncated page');
        cursor = { mode: 'after', token };
      }

      const root = await adapter.children(path([]), makeCtx());
      const groups = root.filter((n) => n.kind === 'consumerGroup').map((n) => n.name);
      assert.deepStrictEqual(groups, [CONSUMER_GROUP]);
    } finally {
      await adapter.disconnect();
    }
  });

  test('18. a browse commits no offsets (D19/D30)', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // Scenario 17 just paged ORDERS_TOPIC in full — the structural form of P10 D6's promise is
      // that this left no trace in __consumer_offsets under the browse group's name: either the
      // group itself was never created (E_NOT_FOUND), or it exists with no committed offsets for
      // the topic that was browsed.
      try {
        const def = await adapter.definition(groupPath('kira-studio-browse'), makeCtx());
        const offsets = def.sections.find((s) => s.title === 'Committed offsets');
        const ordersOffsets =
          offsets?.rows.filter((r) => r.name.startsWith(`${ORDERS_TOPIC}[`)) ?? [];
        assert.strictEqual(ordersOffsets.length, 0);
      } catch (err) {
        assert.ok(err instanceof AdapterError);
        assert.strictEqual(err.code, 'E_NOT_FOUND');
      }
    } finally {
      await adapter.disconnect();
    }
  });

  test('19. a timestamp filter still seeks (D20)', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // Learn each seeded message's real timestamp rather than assuming a hand-picked value falls
      // between two of them — kafka-console-producer sets CreateTime per message at send, which
      // may or may not spread across seeded messages depending on broker/client clock resolution.
      // The median of the observed timestamps is used as the seek boundary either way: "returned
      // rows are exactly those at or after it" holds structurally even in the degenerate case
      // where every message shares one timestamp (nothing gets excluded, and the assertion still
      // matches what freshWindows should produce) — but a real split (the common case) is what
      // actually exercises admin.fetchTopicOffsetsByTimestamp's seek.
      const full = await readStream(
        adapter,
        {
          path: topicPath(ORDERS_TOPIC),
          projection: null,
          filter: null,
          sort: null,
          pageSize: ORDERS_MESSAGE_COUNT,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      const rows = Array.from({ length: full.rowCount }, (_, r) => rowAt(full, r));
      const timestamps = rows.map((r) => Date.parse(r.timestamp ?? '')).sort((a, b) => a - b);
      const boundary = timestamps[Math.floor(timestamps.length / 2)];
      const expectedCount = timestamps.filter((t) => t >= boundary).length;

      const filter: KafkaStreamFilter = { offset: null, partitions: [], timestampMs: boundary };
      const filtered = await readStream(
        adapter,
        {
          path: topicPath(ORDERS_TOPIC),
          projection: null,
          filter: encodeKafkaStreamFilter(filter),
          sort: null,
          pageSize: ORDERS_MESSAGE_COUNT,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      assert.strictEqual(filtered.rowCount, expectedCount);
      for (let r = 0; r < filtered.rowCount; r++) {
        const row = rowAt(filtered, r);
        assert.ok(Date.parse(row.timestamp ?? '') >= boundary);
      }
    } finally {
      await adapter.disconnect();
    }
  });

  test('20. an oversized start offset is refused, not truncated (D23)', async () => {
    const adapter = await createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // Hand-crafted page token — no seed data needed, this exercises toNativeOffset's guard
      // directly rather than any particular topic content.
      const oversizedOffset = String(Number.MAX_SAFE_INTEGER + 1);
      const windows = [
        { partition: 0, next: oversizedOffset, end: String(Number.MAX_SAFE_INTEGER + 1000) },
      ];
      const req = {
        path: topicPath(ORDERS_TOPIC),
        projection: null,
        filter: null,
        sort: null,
        pageSize: 10,
      };
      const fingerprint = requestFingerprint({
        topic: ORDERS_TOPIC,
        pageSize: req.pageSize,
        filter: req.filter,
      });
      const token = encodePageToken([JSON.stringify(windows)], fingerprint);

      await assert.rejects(
        readStream(adapter, { ...req, cursor: { mode: 'after', token } }, makeCtx()),
        (err: unknown) => {
          assert.ok(err instanceof AdapterError);
          assert.strictEqual(err.code, 'E_UNSUPPORTED');
          assert.match(err.message, new RegExp(oversizedOffset));
          return true;
        },
      );
    } finally {
      await adapter.disconnect();
    }
  });
});
