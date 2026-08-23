import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { NodePath } from '@shared/domain/tree';
import type { AdapterDeps, OpCtx } from '../../src/engine/adapters/adapter';
import { AdapterError, type AdapterErrorCode } from '../../src/engine/adapters/errors';
import { kafkaCaps } from '../../src/engine/adapters/kafka/caps';
import { createAdapter } from '../../src/engine/adapters/registry';
import { cellText, isNull, type StreamPage } from '../../src/shared/protocol/page';
import {
  CONSUMER_GROUP,
  EMPTY_TOPIC,
  ORDERS_MESSAGE_COUNT,
  ORDERS_PARTITION_COUNT,
  ORDERS_TOPIC,
} from './fixtures/0005_kafka_seed';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from './support/docker';
import { type KafkaFixture, startKafka } from './support/kafka';
import { readStream } from './support/page';

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

/** preview()/cancel() are synchronous — `.rejects` doesn't apply. */
function expectSyncThrow(fn: () => unknown, code: AdapterErrorCode): void {
  try {
    fn();
    throw new Error('expected the call to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).code).toBe(code);
  }
}

let fixture: KafkaFixture;

beforeAll(async () => {
  if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
  fixture = await startKafka();
}, CONTAINER_START_TIMEOUT_MS);

afterAll(async () => {
  await fixture?.stop();
});

describe('kafka adapter (§9.1, P10)', () => {
  test('1. connect / disconnect', async () => {
    const adapter = createAdapter('kafka', deps);
    const info = await adapter.connect(fixture.config, makeCtx());
    expect(info.serverVersion).toBe('Kafka');
    expect(info.details?.cluster).toBeTruthy();
    await adapter.disconnect();

    await expect(adapter.children(path([]), makeCtx())).rejects.toMatchObject({
      code: 'E_CONNECT',
    });
  });

  test('2. cap honesty', () => {
    expect(kafkaCaps.tabular).toBe(false);
    expect(kafkaCaps.stream).toBe(true);
    expect(kafkaCaps.defaultPageKind).toBe('stream');
    expect(kafkaCaps.ddl).toBe(false);
    expect(kafkaCaps.sql).toBe(false);
    expect(kafkaCaps.exactCount).toBe(true);
    expect(kafkaCaps.pagination).toBe('offsetWindow');
    expect(kafkaCaps.writable).toBe(false);
    expect(kafkaCaps.cancel).toBe(true);
  });

  test('3. tree enumeration: root is topics + consumer groups, siblings', async () => {
    const adapter = createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const root = await adapter.children(path([]), makeCtx());
      const topics = root.filter((n) => n.kind === 'topic').map((n) => n.name);
      const groups = root.filter((n) => n.kind === 'consumerGroup').map((n) => n.name);
      expect(topics).toEqual([EMPTY_TOPIC, ORDERS_TOPIC].sort());
      expect(groups).toEqual([CONSUMER_GROUP]);
      // Neither root-level internal topics (__consumer_offsets) nor the group leaf's own
      // hasChildren promise should ever surface a nonexistent twisty.
      const group = root.find((n) => n.kind === 'consumerGroup');
      expect(group?.hasChildren).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('4. tree enumeration: partitions nest under a topic, not consumer groups', async () => {
    const adapter = createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const partitions = await adapter.children(topicPath(ORDERS_TOPIC), makeCtx());
      expect(partitions).toHaveLength(ORDERS_PARTITION_COUNT);
      expect(partitions.every((n) => n.kind === 'partition' && n.hasChildren === false)).toBe(true);
      expect(partitions.map((n) => n.name)).toEqual(['0', '1']);
    } finally {
      await adapter.disconnect();
    }
  });

  test('5. children of a leaf (partition / consumer group)', async () => {
    const adapter = createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const partitionChildren = await adapter.children(
        path([
          { kind: 'topic', name: ORDERS_TOPIC },
          { kind: 'partition', name: '0' },
        ]),
        makeCtx(),
      );
      expect(partitionChildren).toEqual([]);

      const groupChildren = await adapter.children(
        path([{ kind: 'consumerGroup', name: CONSUMER_GROUP }]),
        makeCtx(),
      );
      expect(groupChildren).toEqual([]);
    } finally {
      await adapter.disconnect();
    }
  });

  test('6. describe/ddl are unsupported', async () => {
    const adapter = createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(adapter.describe(topicPath(ORDERS_TOPIC), makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });
      await expect(adapter.ddl(topicPath(ORDERS_TOPIC), makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });
    } finally {
      await adapter.disconnect();
    }
  });

  test('7. read: browses a topic across partitions, offsetWindow pagination', async () => {
    const adapter = createAdapter('kafka', deps);
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
      expect(page.position.strategy).toBe('offsetWindow');
      expect(page.rowCount).toBe(ORDERS_MESSAGE_COUNT);
      expect(page.position.hasMore).toBe(false);
      expect(page.visibilityTimeoutSeconds).toBeNull();

      const seqs = Array.from({ length: page.rowCount }, (_, r) => {
        const row = rowAt(page, r);
        expect(row.key).toMatch(/^key-\d$/);
        expect(row.headers.source).toBe('seed');
        expect(typeof row.attrs.partition).toBe('number');
        expect(typeof row.attrs.offset).toBe('string');
        expect(row.timestamp).not.toBeNull();
        return (JSON.parse(row.body) as { seq: number }).seq;
      }).sort((a, b) => a - b);
      expect(seqs).toEqual(Array.from({ length: ORDERS_MESSAGE_COUNT }, (_, i) => i));
    } finally {
      await adapter.disconnect();
    }
  });

  test('8. read: a smaller page size pages forward with a token', async () => {
    const adapter = createAdapter('kafka', deps);
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
      expect(seen.size).toBe(ORDERS_MESSAGE_COUNT);
    } finally {
      await adapter.disconnect();
    }
  });

  test('9. read: an empty topic returns a terminal empty page', async () => {
    const adapter = createAdapter('kafka', deps);
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
      expect(page.rowCount).toBe(0);
      expect(page.position.hasMore).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('10. read: forward-only — a "before" cursor is E_UNSUPPORTED', async () => {
    const adapter = createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
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
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    } finally {
      await adapter.disconnect();
    }
  });

  // admin.fetchTopicOffsets() retries a genuinely-missing topic with kafkajs's default backoff
  // (5 retries, up to ~9s total) before finally rejecting — longer than bun's 5s test default.
  test('11. read: a nonexistent topic is E_QUERY, not E_NOT_FOUND', async () => {
    const adapter = createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
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
      ).rejects.toMatchObject({ code: 'E_QUERY' });
    } finally {
      await adapter.disconnect();
    }
  }, 20_000);

  test('12. count: exact via high/low watermark subtraction', async () => {
    const adapter = createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      expect(
        await adapter.count({ path: topicPath(ORDERS_TOPIC), filter: null }, makeCtx()),
      ).toEqual({ value: ORDERS_MESSAGE_COUNT, exact: true });
      expect(
        await adapter.count({ path: topicPath(EMPTY_TOPIC), filter: null }, makeCtx()),
      ).toEqual({ value: 0, exact: true });
    } finally {
      await adapter.disconnect();
    }
  });

  test('13. preview/mutate/execute are unsupported — read-only, no console (D13)', async () => {
    const adapter = createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      expectSyncThrow(
        () => adapter.preview({ path: topicPath(ORDERS_TOPIC), ops: [] }),
        'E_UNSUPPORTED',
      );
      await expect(
        adapter.mutate({ path: topicPath(ORDERS_TOPIC), ops: [] }, makeCtx()),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
      await expect(
        adapter.execute({ path: topicPath(ORDERS_TOPIC), statements: ['x'] }, makeCtx()),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('14. cancel is a permanent no-op (D6/D14)', async () => {
    const adapter = createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      expect(await adapter.cancel(crypto.randomUUID())).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('15. read: an already-cancelled signal aborts the browse', async () => {
    const adapter = createAdapter('kafka', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const controller = new AbortController();
      controller.abort();
      const ctx: OpCtx = { opId: crypto.randomUUID(), signal: controller.signal, setCommand() {} };
      await expect(
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
      ).rejects.toMatchObject({ code: 'E_CANCELLED' });
    } finally {
      await adapter.disconnect();
    }
  });
});
