import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { NodePath } from '@shared/domain/tree';
import type { AdapterDeps, OpCtx } from '../../src/engine/adapters/adapter';
import { AdapterError, type AdapterErrorCode } from '../../src/engine/adapters/errors';
import { createAdapter } from '../../src/engine/adapters/registry';
import { sqsCaps } from '../../src/engine/adapters/sqs/caps';
import { cellText, isNull, type StreamPage } from '../../src/shared/protocol/page';
import {
  DRAIN_MESSAGE_COUNT,
  DRAIN_QUEUE,
  EMPTY_QUEUE,
  ORDERS_MESSAGE_COUNT,
  ORDERS_QUEUE,
} from './fixtures/0006_sqs_seed';
import { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from './support/docker';
import { readStream } from './support/page';
import { type SqsFixture, startSqs } from './support/sqs';

const CONTAINER_START_TIMEOUT_MS = 180_000;

const deps: AdapterDeps = {
  log(level, message) {
    if (level === 'error') console.error(`[sqs adapter] ${message}`);
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
  return { connectionId: 'test-sqs', segments };
}

function queuePath(name: string): NodePath {
  return path([{ kind: 'queue', name }]);
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

/**
 * P13 D14: counts `GetQueueUrlCommand`s actually sent, by wrapping the one `SQSClient.prototype
 * .send` every adapter-created client shares — the queueUrls cache lives inside the adapter
 * instance, so this is the only vantage point outside it that can see a cache hit vs. a miss.
 */
async function countGetQueueUrlCalls<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; calls: number }> {
  let calls = 0;
  // send() is overloaded (promise vs. callback style) in a way TypeScript can't express as a
  // single call-through signature — this spy only ever forwards to the real implementation, so
  // the loose type is confined to this one wrapper.
  // biome-ignore lint/suspicious/noExplicitAny: see above
  const original = SQSClient.prototype.send as (...args: any[]) => unknown;
  const spy = spyOn(SQSClient.prototype, 'send').mockImplementation(function (
    this: SQSClient,
    ...args: unknown[]
  ) {
    if (args[0] instanceof GetQueueUrlCommand) calls++;
    return original.apply(this, args);
  } as SQSClient['send']);
  try {
    const result = await fn();
    return { result, calls };
  } finally {
    spy.mockRestore();
  }
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

let fixture: SqsFixture;

beforeAll(async () => {
  if (!(await isDockerAvailable())) throw new Error(DOCKER_UNAVAILABLE_MESSAGE);
  fixture = await startSqs();
}, CONTAINER_START_TIMEOUT_MS);

afterAll(async () => {
  await fixture?.stop();
});

describe('sqs adapter (§9.1, P10)', () => {
  test('1. connect / disconnect', async () => {
    const adapter = await createAdapter('sqs', deps);
    const info = await adapter.connect(fixture.config, makeCtx());
    expect(info.serverVersion).toBe('Amazon SQS');
    await adapter.disconnect();

    await expect(adapter.children(path([]), makeCtx())).rejects.toMatchObject({
      code: 'E_CONNECT',
    });
  });

  test('2. an unparseable URI is rejected at connect time', async () => {
    const adapter = await createAdapter('sqs', deps);
    const badConfig = { ...fixture.config, uri: 'not a valid uri at all' };
    await expect(adapter.connect(badConfig, makeCtx())).rejects.toMatchObject({
      code: 'E_QUERY',
    });
  });

  test('3. cap honesty', () => {
    expect(sqsCaps.tabular).toBe(false);
    expect(sqsCaps.stream).toBe(true);
    expect(sqsCaps.defaultPageKind).toBe('stream');
    expect(sqsCaps.definition).toBe(true);
    expect(sqsCaps.sql).toBe(false);
    expect(sqsCaps.exactCount).toBe(false);
    expect(sqsCaps.pagination).toBe('batch');
    // sqs/mutate.ts's SendMessage/DeleteMessage land both canInsert and canDelete (this session's
    // addition) — there is still no canUpdate: a delivered message can't be edited in place.
    expect(sqsCaps.canInsert).toBe(true);
    expect(sqsCaps.canUpdate).toBe(false);
    expect(sqsCaps.canDelete).toBe(true);
    expect(sqsCaps.writable).toBe(true);
    expect(sqsCaps.cancel).toBe(true);
    expect(sqsCaps.fileTransfer).toBe(false);
  });

  test('4. tree enumeration: root is a flat queue list', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const root = await adapter.children(path([]), makeCtx());
      expect(root.map((n) => n.name)).toEqual([DRAIN_QUEUE, EMPTY_QUEUE, ORDERS_QUEUE].sort());
      expect(root.every((n) => n.kind === 'queue' && n.hasChildren === false)).toBe(true);
    } finally {
      await adapter.disconnect();
    }
  });

  test('5. children of a leaf (queue)', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const children = await adapter.children(queuePath(ORDERS_QUEUE), makeCtx());
      expect(children).toEqual([]);
    } finally {
      await adapter.disconnect();
    }
  });

  test('6. describe stays unsupported; definition shows the queue attributes', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(adapter.describe(queuePath(ORDERS_QUEUE), makeCtx())).rejects.toMatchObject({
        code: 'E_UNSUPPORTED',
      });

      // P23 D9: one GetQueueAttributes call, not a ReceiveMessage — opening the definition must
      // not receive or hide a single message (SPEC §5.1's "SQS reads are never automatic" rule).
      const countBefore = await adapter.count(
        { path: queuePath(ORDERS_QUEUE), filter: null },
        makeCtx(),
      );

      const def = await adapter.definition(queuePath(ORDERS_QUEUE), makeCtx());
      expect(def.kind).toBe('queue');
      expect(def.sections.map((s) => s.title)).toEqual(['Attributes']);
      const attrs = def.sections[0]?.rows ?? [];
      const names = attrs.map((r) => r.name);
      expect(names).toContain('VisibilityTimeout');
      expect(names).toContain('ApproximateNumberOfMessages');
      expect(names).toContain('QueueArn');
      // Sorted by name (D9) — a stable read, easy to scan.
      expect(names).toEqual([...names].sort());

      const countAfter = await adapter.count(
        { path: queuePath(ORDERS_QUEUE), filter: null },
        makeCtx(),
      );
      expect(countAfter.value).toBe(countBefore.value);
    } finally {
      await adapter.disconnect();
    }
  });

  test('7. read: polls messages off a queue, batch pagination', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readStream(
        adapter,
        {
          path: queuePath(ORDERS_QUEUE),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.position.strategy).toBe('batch');
      expect(page.position.hasMore).toBe(false);
      expect(page.position.nextToken).toBeNull();
      expect(page.position.prevToken).toBeNull();
      expect(page.rowCount).toBeGreaterThan(0);
      expect(page.rowCount).toBeLessThanOrEqual(ORDERS_MESSAGE_COUNT);
      expect(typeof page.visibilityTimeoutSeconds).toBe('number');

      const row = rowAt(page, 0);
      expect(row.key).toBeTruthy(); // MessageId
      expect(row.timestamp).not.toBeNull();
      expect(typeof (JSON.parse(row.body) as { seq: number }).seq).toBe('number');
      expect(row.attrs.SentTimestamp).toBeTruthy();
      expect(row.headers.source).toMatchObject({ StringValue: 'seed' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('8. read: repeated small polls eventually see every message', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const req = {
        path: queuePath(DRAIN_QUEUE),
        projection: null,
        filter: null,
        sort: null,
        pageSize: 2, // < DRAIN_MESSAGE_COUNT, so no single poll can see them all (D10/D12)
        cursor: { mode: 'offset' as const, offset: 0 },
      };
      let total = 0;
      for (let guard = 0; guard < DRAIN_MESSAGE_COUNT + 3 && total < DRAIN_MESSAGE_COUNT; guard++) {
        const page = await readStream(adapter, req, makeCtx());
        total += page.rowCount;
        if (page.rowCount === 0) break;
      }
      expect(total).toBe(DRAIN_MESSAGE_COUNT);
    } finally {
      await adapter.disconnect();
    }
  });

  test('9. read: an empty queue returns an empty page, not an error', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const page = await readStream(
        adapter,
        {
          path: queuePath(EMPTY_QUEUE),
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

  test('10. read: a nonexistent queue is E_QUERY, not E_NOT_FOUND', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await expect(
        readStream(
          adapter,
          {
            path: queuePath('this-queue-was-never-created'),
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
  });

  test('11. count: approximate, never exact (D6/D11)', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const result = await adapter.count({ path: queuePath(EMPTY_QUEUE), filter: null }, makeCtx());
      expect(result).toEqual({ value: 0, exact: false });
    } finally {
      await adapter.disconnect();
    }
  });

  test('12. preview/mutate: update/execute stay unsupported (D13, no canUpdate)', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // A delivered message can't be edited in place, only replaced by delete+resend
      // (sqsCaps's own comment) — insert/delete are covered end to end by test 17.
      expectSyncThrow(
        () =>
          adapter.preview({
            path: queuePath(ORDERS_QUEUE),
            ops: [{ kind: 'update', key: {}, changes: {} }],
          }),
        'E_UNSUPPORTED',
      );
      await expect(
        adapter.mutate(
          { path: queuePath(ORDERS_QUEUE), ops: [{ kind: 'update', key: {}, changes: {} }] },
          makeCtx(),
        ),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
      await expect(
        adapter.execute({ path: queuePath(ORDERS_QUEUE), statements: ['x'] }, makeCtx()),
      ).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    } finally {
      await adapter.disconnect();
    }
  });

  test('13. cancel is a permanent no-op (D14)', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      expect(await adapter.cancel(crypto.randomUUID())).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  test('14. read: an already-cancelled signal rejects before running anything', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const controller = new AbortController();
      controller.abort();
      const ctx: OpCtx = { opId: crypto.randomUUID(), signal: controller.signal, setCommand() {} };
      await expect(
        readStream(
          adapter,
          {
            path: queuePath(EMPTY_QUEUE),
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

  test('15. a second read/count on the same queue issues no second GetQueueUrl (F14/F22, D14)', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      const req = {
        path: queuePath(ORDERS_QUEUE),
        projection: null,
        filter: null,
        sort: null,
        pageSize: 10,
        cursor: { mode: 'offset' as const, offset: 0 },
      };
      const first = await countGetQueueUrlCalls(() => readStream(adapter, req, makeCtx()));
      expect(first.calls).toBe(1); // cache miss — resolveQueueUrl falls back to GetQueueUrl

      const second = await countGetQueueUrlCalls(() => readStream(adapter, req, makeCtx()));
      expect(second.calls).toBe(0); // cache hit

      const third = await countGetQueueUrlCalls(() =>
        adapter.count({ path: queuePath(ORDERS_QUEUE), filter: null }, makeCtx()),
      );
      expect(third.calls).toBe(0); // count() shares the same cache
    } finally {
      await adapter.disconnect();
    }
  });

  test('16. a disconnect/connect cycle re-resolves the queue URL', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      await readStream(
        adapter,
        {
          path: queuePath(ORDERS_QUEUE),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
    } finally {
      await adapter.disconnect();
    }

    // disconnect() clears the cache (D14) — a fresh connect() must resolve it again, not reuse a
    // URL cached against the now-destroyed client.
    await adapter.connect(fixture.config, makeCtx());
    try {
      const { calls } = await countGetQueueUrlCalls(() =>
        readStream(
          adapter,
          {
            path: queuePath(ORDERS_QUEUE),
            projection: null,
            filter: null,
            sort: null,
            pageSize: 10,
            cursor: { mode: 'offset', offset: 0 },
          },
          makeCtx(),
        ),
      );
      expect(calls).toBe(1);
    } finally {
      await adapter.disconnect();
    }
  });

  test('17. mutate: sending then deleting a message round-trips through the queue (canInsert/canDelete)', async () => {
    const adapter = await createAdapter('sqs', deps);
    await adapter.connect(fixture.config, makeCtx());
    try {
      // EMPTY_QUEUE (not ORDERS_QUEUE) so this doesn't perturb any other test's assumptions.
      const sendResult = await adapter.mutate(
        { path: queuePath(EMPTY_QUEUE), ops: [{ kind: 'insert', values: { $body: 'hello' } }] },
        makeCtx(),
      );
      expect(sendResult.affectedRows).toBe(1);

      const page = await readStream(
        adapter,
        {
          path: queuePath(EMPTY_QUEUE),
          projection: null,
          filter: null,
          sort: null,
          pageSize: 10,
          cursor: { mode: 'offset', offset: 0 },
        },
        makeCtx(),
      );
      expect(page.rowCount).toBe(1);
      const row = rowAt(page, 0);
      expect(row.body).toBe('hello');
      expect(row.key).toBeTruthy(); // MessageId — echoed back as the delete key below

      // The receipt handle this delete needs lives only in this adapter instance's in-memory map
      // (mutate.ts's own doc comment) — populated by the readStream poll just above, on the same
      // `adapter`, never round-tripped through the wire.
      const deleteResult = await adapter.mutate(
        {
          path: queuePath(EMPTY_QUEUE),
          ops: [{ kind: 'delete', key: { messageId: row.key as string } }],
        },
        makeCtx(),
      );
      expect(deleteResult.affectedRows).toBe(1);
    } finally {
      await adapter.disconnect();
    }
  });
});
