import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { NodePath } from '@shared/domain/tree';
import type { AdapterDeps, OpCtx } from '../../src/engine/adapters/adapter';
import { AdapterError, type AdapterErrorCode } from '../../src/engine/adapters/errors';
import { rabbitmqCaps } from '../../src/engine/adapters/rabbitmq/caps';
import { createAdapter } from '../../src/engine/adapters/registry';
import {
  cellText,
  isNull,
  isTruncated,
  MAX_CELL_BYTES,
  type StreamPage,
} from '../../src/shared/protocol/page';
import {
  BIG_QUEUE,
  BIG_QUEUE_MESSAGE_COUNT,
  BINARY_QUEUE,
  DEFAULT_VHOST,
  DLX_QUEUE,
  EMPTY_QUEUE,
  EVENTS_FANOUT_EXCHANGE,
  EVENTS_TOPIC_EXCHANGE,
  KIRA_VHOST,
  ORDERS_DIRECT_EXCHANGE,
  ORDERS_MESSAGE_COUNT,
  ORDERS_QUEUE,
  STREAM_QUEUE,
  WEIRD_NAME_QUEUE,
} from './fixtures/0011_rabbitmq_seed';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from './support/docker';
import { readStream } from './support/page';
import { type RabbitMqFixture, startRabbitMq } from './support/rabbitmq';

const CONTAINER_START_TIMEOUT_MS = 180_000;

const deps: AdapterDeps = {
  log(level, message) {
    if (level === 'error') console.error(`[rabbitmq adapter] ${message}`);
  },
};

function makeCtx(recorder?: string[]): OpCtx {
  return {
    opId: crypto.randomUUID(),
    signal: new AbortController().signal,
    setCommand(text) {
      recorder?.push(text);
    },
  };
}

function path(connectionId: string, segments: NodePath['segments']): NodePath {
  return { connectionId, segments };
}

function queuePath(vhost: string, name: string): NodePath {
  return path('test-rabbitmq', [
    { kind: 'database', name: vhost },
    { kind: 'queue', name },
  ]);
}

function exchangePath(vhost: string, name: string): NodePath {
  return path('test-rabbitmq', [
    { kind: 'database', name: vhost },
    { kind: 'exchange', name },
  ]);
}

const decoder = new TextDecoder();

interface StreamRow {
  key: string | null;
  headers: Record<string, unknown>;
  attrs: Record<string, unknown>;
  timestamp: string | null;
  body: string;
  isTruncated: boolean;
}

function rowAt(page: StreamPage, row: number): StreamRow {
  return {
    key: isNull(page.keys, row) ? null : cellText(page.keys, row, decoder),
    headers: JSON.parse(cellText(page.headers, row, decoder)),
    attrs: JSON.parse(cellText(page.attrs, row, decoder)),
    timestamp: isNull(page.timestamps, row) ? null : cellText(page.timestamps, row, decoder),
    body: cellText(page.bodies, row, decoder),
    isTruncated: isTruncated(page.bodies, row),
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

/** Counts real `fetch` calls issued during `fn` — the adapter's own ONE call site (query.ts's
 *  request()), so this is the vantage point for the P13 tripwire (scenario 26) and the connect-
 *  probe zero-requests assertion (scenario 20). */
async function countFetchCalls<T>(fn: () => Promise<T>): Promise<{ result: T; calls: number }> {
  let calls = 0;
  const original = globalThis.fetch;
  const spy = spyOn(globalThis, 'fetch').mockImplementation(((
    ...args: Parameters<typeof fetch>
  ) => {
    calls++;
    return original(...args);
  }) as typeof fetch);
  try {
    const result = await fn();
    return { result, calls };
  } finally {
    spy.mockRestore();
  }
}

const streamReq = (vhostPath: NodePath, pageSize: number) => ({
  path: vhostPath,
  projection: null,
  filter: null,
  sort: null,
  pageSize,
  cursor: { mode: 'offset' as const, offset: 0 },
});

let fixture: RabbitMqFixture;

beforeAll(async () => {
  if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
  fixture = await startRabbitMq();
}, CONTAINER_START_TIMEOUT_MS);

afterAll(async () => {
  await fixture?.stop();
});

describe('rabbitmq adapter (§9.1, P37)', () => {
  test('1. connect / disconnect', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    const info = await adapter.connect(fixture.config, makeCtx());
    expect(info.serverVersion).toMatch(/^RabbitMQ 4\./);
    expect(info.details?.management).toBeTruthy();
    expect(info.details?.node).toBeTruthy();
    expect(info.details?.cluster).toBeTruthy();
    expect(info.details?.vhost).toBe(KIRA_VHOST);
    await adapter.disconnect();

    await expect(adapter.children(path('test-rabbitmq', []), makeCtx())).rejects.toMatchObject({
      code: 'E_CONNECT',
    });
  });

  test('2a. connect: wrong password is E_AUTH', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    const badConfig = { ...fixture.config, password: 'definitely-wrong' };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({ code: 'E_AUTH' });
  });

  test('2b. connect: an unreachable port is E_CONNECT, not a hang', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    const badConfig = { ...fixture.config, port: 1 };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({
      code: 'E_CONNECT',
    });
  });

  test('2c. connect: the AMQP port is E_CONNECT naming the port mistake', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    // The container's own AMQP port — reachable but speaks a different protocol entirely, so the
    // HTTP request either times out or gets a non-JSON response; either way the message must name
    // the real mistake (D5).
    const amqpPort = fixture.container.getMappedPort(5672);
    const badConfig = { ...fixture.config, port: amqpPort };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({
      code: 'E_CONNECT',
    });
  });

  test('2d. connect: an amqp:// URI is refused, naming rabbitmq://', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    const badConfig = {
      ...fixture.config,
      mode: 'uri' as const,
      uri: `amqp://guest:guest@${fixture.config.host}:5672/%2F`,
    };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({
      code: 'E_CONNECT',
      message: expect.stringContaining('rabbitmq://'),
    });
  });

  test('3. cap honesty', () => {
    expect(rabbitmqCaps.tabular).toBe(false);
    expect(rabbitmqCaps.stream).toBe(true);
    expect(rabbitmqCaps.defaultPageKind).toBe('stream');
    expect(rabbitmqCaps.definition).toBe(true);
    expect(rabbitmqCaps.describe).toBe(false);
    expect(rabbitmqCaps.sql).toBe(false);
    expect(rabbitmqCaps.exactCount).toBe(false);
    expect(rabbitmqCaps.pagination).toBe('batch');
    expect(rabbitmqCaps.foreignKeys).toBe(false);
    expect(rabbitmqCaps.canInsert).toBe(true);
    expect(rabbitmqCaps.canUpdate).toBe(false);
    expect(rabbitmqCaps.canDelete).toBe(false);
    expect(rabbitmqCaps.writable).toBe(true);
    expect(rabbitmqCaps.transactions).toBe(false);
    expect(rabbitmqCaps.cancel).toBe(true);
    expect(rabbitmqCaps.fileTransfer).toBe(false);
  });

  test('4. tree enumeration: queues, exchanges, no default exchange', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const root = await adapter.children(path('test-rabbitmq', []), makeCtx());
      expect(root.some((n) => n.name === KIRA_VHOST)).toBe(true);
      expect(root.every((n) => n.kind === 'database' && n.hasChildren === true)).toBe(true);

      const vhostPath = path('test-rabbitmq', [{ kind: 'database', name: KIRA_VHOST }]);
      const children = await adapter.children(vhostPath, makeCtx());
      const queues = children.filter((n) => n.kind === 'queue');
      const exchanges = children.filter((n) => n.kind === 'exchange');
      expect(queues.some((n) => n.name === ORDERS_QUEUE)).toBe(true);
      expect(exchanges.some((n) => n.name === ORDERS_DIRECT_EXCHANGE)).toBe(true);
      // The nameless default exchange is never listed (D16).
      expect(exchanges.some((n) => n.name === '')).toBe(false);
      expect(children.every((n) => n.hasChildren === false)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  });

  test('5. vhost scoping and %2F', async () => {
    const scoped = await createAdapter('rabbitmq', deps);
    await scoped.connect(fixture.config, makeCtx());
    try {
      const root = await scoped.children(path('test-rabbitmq', []), makeCtx());
      expect(root.map((n) => n.name)).toEqual([KIRA_VHOST]);
    } finally {
      await scoped.disconnect();
    }

    const unscoped = await createAdapter('rabbitmq', deps);
    await unscoped.connect({ ...fixture.config, database: null }, makeCtx());
    try {
      const root = await unscoped.children(path('test-rabbitmq', []), makeCtx());
      expect(root.map((n) => n.name)).toContain(KIRA_VHOST);
      expect(root.map((n) => n.name)).toContain(DEFAULT_VHOST);

      // A queue seeded under the default vhost '/' reads successfully — proves %2F end to end.
      const page = await readStream(
        unscoped,
        streamReq(queuePath(DEFAULT_VHOST, ORDERS_QUEUE), 10),
        makeCtx(),
      );
      expect(page.rowCount).toBeGreaterThan(0);
    } finally {
      await unscoped.disconnect();
    }
  });

  test('6. a percent-encoded queue name round-trips', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const p = queuePath(KIRA_VHOST, WEIRD_NAME_QUEUE);
      const page = await readStream(adapter, streamReq(p, 10), makeCtx());
      expect(page.rowCount).toBeGreaterThan(0);
      const def = await adapter.definition(p, makeCtx());
      expect(def.qualifiedName).toBe(WEIRD_NAME_QUEUE);
      const count = await adapter.count({ path: p, filter: null }, makeCtx());
      expect(count.exact).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('7. children of a leaf (queue, exchange)', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      expect(await adapter.children(queuePath(KIRA_VHOST, ORDERS_QUEUE), makeCtx())).toEqual([]);
      expect(
        await adapter.children(exchangePath(KIRA_VHOST, ORDERS_DIRECT_EXCHANGE), makeCtx()),
      ).toEqual([]);
    } finally {
      await adapter.disconnect();
    }
  });

  test('8. describe stays unsupported', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
        adapter.describe(queuePath(KIRA_VHOST, ORDERS_QUEUE), makeCtx()),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('9. definition: a queue', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const def = await adapter.definition(queuePath(KIRA_VHOST, DLX_QUEUE), makeCtx());
      expect(def.kind).toBe('queue');
      const titles = def.sections.map((s) => s.title);
      expect(titles).toEqual(['Queue', 'Arguments', 'Bindings', 'Consumers']);
      const argsRows = def.sections.find((s) => s.title === 'Arguments')?.rows ?? [];
      expect(argsRows.some((r) => r.name === 'x-message-ttl')).toBe(true);
      expect(argsRows.some((r) => r.name === 'x-dead-letter-exchange')).toBe(true);

      const ordersDef = await adapter.definition(queuePath(KIRA_VHOST, ORDERS_QUEUE), makeCtx());
      const bindingsRows = ordersDef.sections.find((s) => s.title === 'Bindings')?.rows ?? [];
      expect(bindingsRows.some((r) => r.name === ORDERS_DIRECT_EXCHANGE)).toBe(true);

      expect(() => JSON.parse(def.statements[0] ?? '')).not.toThrow();
      const parsed = JSON.parse(def.statements[0] ?? '{}') as { name?: string };
      expect(parsed.name).toBe(DLX_QUEUE);
      expect(def.notes.length).toBeGreaterThanOrEqual(2);
    } finally {
      await adapter.disconnect();
    }
  });

  test('10. definition: an exchange, both binding directions', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const fanoutDef = await adapter.definition(
        exchangePath(KIRA_VHOST, EVENTS_FANOUT_EXCHANGE),
        makeCtx(),
      );
      const titles = fanoutDef.sections.map((s) => s.title);
      expect(titles).toEqual([
        'Exchange',
        'Arguments',
        'Bindings from this exchange',
        'Bindings to this exchange',
      ]);
      const from = fanoutDef.sections.find((s) => s.title === 'Bindings from this exchange');
      expect(from?.rows.some((r) => r.name === EVENTS_TOPIC_EXCHANGE)).toBe(true);

      const topicDef = await adapter.definition(
        exchangePath(KIRA_VHOST, EVENTS_TOPIC_EXCHANGE),
        makeCtx(),
      );
      const to = topicDef.sections.find((s) => s.title === 'Bindings to this exchange');
      expect(to?.rows.some((r) => r.name === EVENTS_FANOUT_EXCHANGE)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  });

  test('11. read: the column mapping', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readStream(
        adapter,
        streamReq(queuePath(KIRA_VHOST, ORDERS_QUEUE), ORDERS_MESSAGE_COUNT),
        makeCtx(),
      );
      expect(page.rowCount).toBe(ORDERS_MESSAGE_COUNT);
      const row = rowAt(page, 0);
      expect(row.key).toBe(ORDERS_QUEUE); // routing key
      expect(row.attrs.exchange).toBe(ORDERS_DIRECT_EXCHANGE);
      expect(row.attrs.redelivered).toBe(false);
      expect(typeof row.attrs.payload_bytes).toBe('number');
      expect(row.attrs.payload_encoding).toBe('string');
      expect(typeof row.attrs.message_count).toBe('number');
      expect(row.headers.source).toBe('seed');
      expect(row.timestamp).not.toBeNull();
      expect(typeof (JSON.parse(row.body) as { seq: number }).seq).toBe('number');
    } finally {
      await adapter.disconnect();
    }
  });

  test('12. read is non-destructive: two consecutive polls', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const countBefore = await adapter.count(
        { path: queuePath(KIRA_VHOST, ORDERS_QUEUE), filter: null },
        makeCtx(),
      );
      await readStream(
        adapter,
        streamReq(queuePath(KIRA_VHOST, ORDERS_QUEUE), ORDERS_MESSAGE_COUNT),
        makeCtx(),
      );
      const secondPage = await readStream(
        adapter,
        streamReq(queuePath(KIRA_VHOST, ORDERS_QUEUE), ORDERS_MESSAGE_COUNT),
        makeCtx(),
      );
      const countAfter = await adapter.count(
        { path: queuePath(KIRA_VHOST, ORDERS_QUEUE), filter: null },
        makeCtx(),
      );
      expect(countAfter.value).toBe(countBefore.value);
      expect(secondPage.rowCount).toBe(ORDERS_MESSAGE_COUNT);
      expect(rowAt(secondPage, 0).attrs.redelivered).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  });

  test('13. read: the 500-message clamp', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      expect(BIG_QUEUE_MESSAGE_COUNT).toBeGreaterThan(500);
      const page = await readStream(
        adapter,
        streamReq(queuePath(KIRA_VHOST, BIG_QUEUE), 10_000),
        makeCtx(),
      );
      expect(page.rowCount).toBeLessThanOrEqual(500);
    } finally {
      await adapter.disconnect();
    }
  });

  test('14. read: a stream-type queue is E_UNSUPPORTED, naming the broker sentence', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
        readStream(adapter, streamReq(queuePath(KIRA_VHOST, STREAM_QUEUE), 10), makeCtx()),
      ).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
        message: expect.stringContaining('stream queue'),
      });
    } finally {
      await adapter.disconnect();
    }
  });

  test('15. read: an empty queue is an empty page, not an error', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readStream(
        adapter,
        streamReq(queuePath(KIRA_VHOST, EMPTY_QUEUE), 10),
        makeCtx(),
      );
      expect(page.rowCount).toBe(0);
    } finally {
      await adapter.disconnect();
    }
  });

  test('16. read: a nonexistent queue is E_NOT_FOUND', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
        readStream(
          adapter,
          streamReq(queuePath(KIRA_VHOST, 'this-queue-was-never-created'), 10),
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('17. read: binary and oversize payloads', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readStream(
        adapter,
        streamReq(queuePath(KIRA_VHOST, BINARY_QUEUE), 10),
        makeCtx(),
      );
      expect(page.rowCount).toBe(2);

      const binaryRow = rowAt(page, 0);
      expect(binaryRow.attrs.payload_encoding).toBe('base64');
      const decoded = Buffer.from(binaryRow.body, 'base64');
      expect(Array.from(decoded)).toEqual([0xff, 0xfe, 0x00, 0x01, 0x02]);

      const bigRow = rowAt(page, 1);
      expect(bigRow.attrs.payload_bytes).toBeGreaterThan(MAX_CELL_BYTES);
      expect(bigRow.isTruncated).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  });

  test('18. read: batch position on every page', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readStream(
        adapter,
        streamReq(queuePath(KIRA_VHOST, ORDERS_QUEUE), 10),
        makeCtx(),
      );
      expect(page.position.strategy).toBe('batch');
      expect(page.position.hasMore).toBe(false);
      expect(page.position.nextToken).toBeNull();
      expect(page.position.prevToken).toBeNull();
    } finally {
      await adapter.disconnect();
    }
  });

  test('19. count: never exact', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const result = await adapter.count(
        { path: queuePath(KIRA_VHOST, EMPTY_QUEUE), filter: null },
        makeCtx(),
      );
      expect(result).toEqual({ value: 0, exact: false });
    } finally {
      await adapter.disconnect();
    }
  });

  test('20. cancel: an already-aborted signal rejects before any request goes out', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const controller = new AbortController();
      controller.abort();
      const ctx: OpCtx = { opId: crypto.randomUUID(), signal: controller.signal, setCommand() {} };
      const { calls } = await countFetchCalls(() =>
        readStream(adapter, streamReq(queuePath(KIRA_VHOST, EMPTY_QUEUE), 10), ctx).catch((err) => {
          expect(err).toMatchObject({ code: 'E_CANCELLED' });
          return { kind: 'stream' } as StreamPage;
        }),
      );
      expect(calls).toBe(0);
      expect(await adapter.cancel(crypto.randomUUID())).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('21. mutate: publish round-trips, preview matches exactly', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const plan = {
        path: queuePath(KIRA_VHOST, EMPTY_QUEUE),
        ops: [
          {
            kind: 'insert' as const,
            values: {
              $body: 'hello world',
              $headers: '{"a":"1"}',
              $properties: '{"delivery_mode":2}',
            },
          },
        ],
      };
      const preview = adapter.preview(plan);
      expect(preview).toHaveLength(1);
      expect(preview[0]).toContain('/publish');
      expect(preview[0]).toContain('hello world');

      const result = await adapter.mutate(plan, makeCtx());
      expect(result.affectedRows).toBe(1);

      const page = await readStream(
        adapter,
        streamReq(queuePath(KIRA_VHOST, EMPTY_QUEUE), 10),
        makeCtx(),
      );
      expect(page.rowCount).toBe(1);
      const row = rowAt(page, 0);
      expect(row.body).toBe('hello world');
      expect(row.headers.a).toBe('1');
      expect(row.attrs.delivery_mode).toBe(2);
    } finally {
      await adapter.disconnect();
    }
  });

  test('22. mutate: unroutable publish is an error, not a silent success', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const before = await adapter.count(
        { path: queuePath(KIRA_VHOST, ORDERS_QUEUE), filter: null },
        makeCtx(),
      );
      await expect(
        adapter.mutate(
          {
            path: queuePath(KIRA_VHOST, ORDERS_QUEUE),
            ops: [
              {
                kind: 'insert',
                values: {
                  $body: 'nowhere to go',
                  $exchange: ORDERS_DIRECT_EXCHANGE,
                  $routingKey: 'no-such-binding-key',
                },
              },
            ],
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_QUERY' });
      const after = await adapter.count(
        { path: queuePath(KIRA_VHOST, ORDERS_QUEUE), filter: null },
        makeCtx(),
      );
      expect(after.value).toBe(before.value);
    } finally {
      await adapter.disconnect();
    }
  });

  test('23. mutate: update/delete are refused, a mixed plan lands nothing, read-only sends zero requests', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      expectSyncThrow(
        () =>
          adapter.preview({
            path: queuePath(KIRA_VHOST, ORDERS_QUEUE),
            ops: [{ kind: 'delete', key: {} }],
          }),
        'E_UNSUPPORTED',
      );

      const before = await adapter.count(
        { path: queuePath(KIRA_VHOST, ORDERS_QUEUE), filter: null },
        makeCtx(),
      );
      await expect(
        adapter.mutate(
          {
            path: queuePath(KIRA_VHOST, ORDERS_QUEUE),
            ops: [
              { kind: 'insert', values: { $body: 'should not land' } },
              { kind: 'delete', key: {} },
            ],
          },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
      const after = await adapter.count(
        { path: queuePath(KIRA_VHOST, ORDERS_QUEUE), filter: null },
        makeCtx(),
      );
      expect(after.value).toBe(before.value);
    } finally {
      await adapter.disconnect();
    }

    const readOnly = await createAdapter('rabbitmq', deps);
    await readOnly.connect({ ...fixture.config, readOnly: true }, makeCtx());
    try {
      const { calls } = await countFetchCalls(() =>
        readOnly
          .mutate(
            {
              path: queuePath(KIRA_VHOST, EMPTY_QUEUE),
              ops: [{ kind: 'insert', values: { $body: 'refused' } }],
            },
            makeCtx(),
          )
          .catch((err) => {
            expect(err).toMatchObject({ code: 'E_UNSUPPORTED' });
          }),
      );
      expect(calls).toBe(0);
    } finally {
      await readOnly.disconnect();
    }
  });

  test('24. the credential never reaches the command text', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    const commands: string[] = [];
    await adapter.connect(fixture.config, makeCtx(commands));
    try {
      await adapter.children(path('test-rabbitmq', []), makeCtx(commands));
      await adapter.definition(queuePath(KIRA_VHOST, ORDERS_QUEUE), makeCtx(commands));
      await readStream(
        adapter,
        streamReq(queuePath(KIRA_VHOST, ORDERS_QUEUE), 5),
        makeCtx(commands),
      );
      await adapter.count(
        { path: queuePath(KIRA_VHOST, ORDERS_QUEUE), filter: null },
        makeCtx(commands),
      );
      await adapter.mutate(
        {
          path: queuePath(KIRA_VHOST, EMPTY_QUEUE),
          ops: [{ kind: 'insert', values: { $body: 'no secrets here' } }],
        },
        makeCtx(commands),
      );
    } finally {
      await adapter.disconnect();
    }
    for (const cmd of commands) {
      expect(cmd).not.toContain(fixture.config.password ?? ' never-empty-guard ');
      expect(cmd).not.toContain('@');
    }
  });

  test('25. execute() and downloadObject() stay unsupported', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
        adapter.execute(
          { path: queuePath(KIRA_VHOST, ORDERS_QUEUE), statements: ['x'] },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
      await expect(
        adapter.downloadObject(
          { path: queuePath(KIRA_VHOST, ORDERS_QUEUE), destPath: '/tmp/x' },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('26. the P13 tripwire: expanding a vhost issues exactly two GETs', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const vhostPath = path('test-rabbitmq', [{ kind: 'database', name: KIRA_VHOST }]);
      const { calls } = await countFetchCalls(() => adapter.children(vhostPath, makeCtx()));
      expect(calls).toBe(2); // queues, exchanges — regardless of object count
    } finally {
      await adapter.disconnect();
    }
  });

  test('27. the leak guard: a failed connect leaves no usable handle', async () => {
    const adapter = await createAdapter('rabbitmq', deps);
    await expect(
      adapter.connect({ ...fixture.config, password: 'nope' }, makeCtx()),
    ).rejects.toMatchObject({ code: 'E_AUTH' });
    await expect(adapter.children(path('test-rabbitmq', []), makeCtx())).rejects.toMatchObject({
      code: 'E_CONNECT',
    });

    // A fresh connect on the same instance succeeds immediately afterward.
    await adapter.connect(fixture.config, makeCtx());
    try {
      const root = await adapter.children(path('test-rabbitmq', []), makeCtx());
      expect(root.length).toBeGreaterThan(0);
    } finally {
      await adapter.disconnect();
    }
  });
});
