import { describe, expect, test } from 'bun:test';
import { wrapVersioned } from './envelope';
import {
  createRpcClient,
  createRpcServer,
  type EndpointConfig,
  type MessageChannelLike,
  type ServerHandlers,
} from './rpc';
import { createContractShapeAsserter } from './shape';

/** A neutral contract, standing in for a real module's own `Contract` (this file has no
 *  knowledge of Git or any other module — see F1/D5). Small on purpose: just enough surface
 *  (one plain request, one erroring request, one event, one stream) to exercise every frame kind
 *  the protocol carries. */
interface TestChunk {
  readonly seq: number;
}

type TestContract = {
  requests: {
    'thing.close': { params: { readonly id: string }; result: Record<string, never> };
    'thing.open': { params: { readonly path: string }; result: unknown };
  };
  events: {
    'thing.changed': { readonly id: string; readonly kind: string };
  };
  streams: {
    'thing.stream': { params: { readonly id: string }; chunk: TestChunk };
  };
};

const CONTRACT_VERSION = 1;
const config: EndpointConfig = {
  contractVersion: CONTRACT_VERSION,
  assertShape: createContractShapeAsserter({
    requests: new Set(['thing.close', 'thing.open']),
    events: new Set(['thing.changed']),
    streams: new Set(['thing.stream']),
  }),
};

function tick(times = 1): Promise<void> {
  return times <= 1
    ? new Promise((resolve) => setTimeout(resolve, 0))
    : tick(1).then(() => tick(times - 1));
}

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A real in-memory pipe: posting on one end synchronously invokes the other end's handler,
 *  after a `structuredClone` (with transfer, if given) so buffer-detach semantics are real. */
function createInMemoryChannelPair(): readonly [MessageChannelLike, MessageChannelLike] {
  let handlerA: ((message: unknown) => void) | undefined;
  let handlerB: ((message: unknown) => void) | undefined;
  let closedA = false;
  let closedB = false;

  const a: MessageChannelLike = {
    post(message, transfer) {
      if (closedA) return;
      const cloned = transfer
        ? structuredClone(message, { transfer: transfer as ArrayBuffer[] })
        : structuredClone(message);
      handlerB?.(cloned);
    },
    onMessage(handler) {
      handlerA = handler;
      return () => {
        if (handlerA === handler) handlerA = undefined;
      };
    },
    close() {
      closedA = true;
    },
  };
  const b: MessageChannelLike = {
    post(message, transfer) {
      if (closedB) return;
      const cloned = transfer
        ? structuredClone(message, { transfer: transfer as ArrayBuffer[] })
        : structuredClone(message);
      handlerA?.(cloned);
    },
    onMessage(handler) {
      handlerB = handler;
      return () => {
        if (handlerB === handler) handlerB = undefined;
      };
    },
    close() {
      closedB = true;
    },
  };
  return [a, b] as const;
}

function chunkFor(seq: number): TestChunk {
  return { seq };
}

function stubHandlers(
  requestOverrides: Partial<ServerHandlers<TestContract>['requests']> = {},
  streamOverrides: Partial<ServerHandlers<TestContract>['streams']> = {},
): ServerHandlers<TestContract> {
  const notImplemented = async (): Promise<never> => {
    throw new Error('not implemented in this test');
  };
  return {
    requests: {
      'thing.close': notImplemented,
      'thing.open': notImplemented,
      ...requestOverrides,
    },
    streams: {
      'thing.stream': notImplemented,
      ...streamOverrides,
    },
  };
}

describe('ipc rpc — request/response', () => {
  test("a request round-trips to its handler's result", async () => {
    const [a, b] = createInMemoryChannelPair();
    const handlers = stubHandlers({
      'thing.close': async ({ id }) => {
        expect(id).toBe('r1');
        return {};
      },
    });
    const server = createRpcServer<TestContract>(a, handlers, config);
    const client = createRpcClient<TestContract>(b, config);

    const result = await client.request('thing.close', { id: 'r1' });
    expect(result).toEqual({});

    client.dispose();
    server.dispose();
  });

  test("a request rejects with an RpcError carrying the handler's error kind", async () => {
    const [a, b] = createInMemoryChannelPair();
    class FakeDomainError extends Error {
      readonly kind = 'NotFound';
      constructor() {
        super('no such thing');
        this.name = 'DomainError';
      }
    }
    const handlers = stubHandlers({
      'thing.open': async () => {
        throw new FakeDomainError();
      },
    });
    const server = createRpcServer<TestContract>(a, handlers, config);
    const client = createRpcClient<TestContract>(b, config);

    await expect(client.request('thing.open', { path: '/nope' })).rejects.toMatchObject({
      name: 'RpcError',
      code: 'DomainError',
      kind: 'NotFound',
      message: 'no such thing',
    });

    client.dispose();
    server.dispose();
  });
});

describe('ipc rpc — events', () => {
  test('server.emit reaches every registered handler', async () => {
    const [a, b] = createInMemoryChannelPair();
    const server = createRpcServer<TestContract>(a, stubHandlers(), config);
    const client = createRpcClient<TestContract>(b, config);

    const seen: unknown[] = [];
    const unsubscribe = client.on('thing.changed', (payload) => seen.push(payload));

    server.emit('thing.changed', { id: 'r1', kind: 'refsChanged' });
    await tick();
    expect(seen).toEqual([{ id: 'r1', kind: 'refsChanged' }]);

    unsubscribe();
    server.emit('thing.changed', { id: 'r1', kind: 'worktreeChanged' });
    await tick();
    expect(seen).toHaveLength(1); // unsubscribed — did not receive the second event

    client.dispose();
    server.dispose();
  });
});

describe('ipc rpc — streams', () => {
  test('ten chunks arrive in order, and the server never runs ahead of its credit', async () => {
    const [a, b] = createInMemoryChannelPair();
    let emitCompleted = 0;
    const handlers = stubHandlers(
      {},
      {
        'thing.stream': async (_params, { emit }) => {
          for (let i = 0; i < 10; i++) {
            await emit(chunkFor(i));
            emitCompleted++;
          }
        },
      },
    );
    const server = createRpcServer<TestContract>(a, handlers, config);
    const client = createRpcClient<TestContract>(b, config);

    const received: number[] = [];
    const freeze = deferred<void>();
    let firstChunkFrozen = false;

    const streamPromise = client.stream('thing.stream', { id: 'r1' }, async (chunk) => {
      received.push(chunk.seq);
      if (!firstChunkFrozen) {
        firstChunkFrozen = true;
        await freeze.promise;
      }
    });

    // Let every microtask the server can run without more credit actually run.
    await tick(3);

    // Initial credit is small and fixed: the server can get ahead by only that much while the
    // client is stalled processing the first chunk — this is the whole point of W2's credit
    // mechanism, and the assertion that would fail if `emit` did not block on the gate.
    expect(emitCompleted).toBe(2);
    expect(received).toEqual([0]);

    freeze.resolve();
    await streamPromise;

    expect(received).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(emitCompleted).toBe(10);

    client.dispose();
    server.dispose();
  });

  test("cancel mid-stream stops delivery and resolves the client's promise cleanly", async () => {
    const [a, b] = createInMemoryChannelPair();
    let cancelled = false;
    const handlers = stubHandlers(
      {},
      {
        'thing.stream': async (_params, { signal, emit }) => {
          for (let i = 0; i < 5; i++) {
            if (signal.aborted) {
              cancelled = true;
              return;
            }
            await emit(chunkFor(i));
          }
        },
      },
    );
    const server = createRpcServer<TestContract>(a, handlers, config);
    const client = createRpcClient<TestContract>(b, config);

    const controller = new AbortController();
    const received: number[] = [];
    const freeze = deferred<void>();
    let frozen = false;
    const streamPromise = client.stream(
      'thing.stream',
      { id: 'r1' },
      async (chunk) => {
        received.push(chunk.seq);
        // Freeze on the first chunk so the stream is still genuinely in-flight (the server
        // has run out of its initial credit and is blocked) when we cancel it below.
        if (!frozen) {
          frozen = true;
          await freeze.promise;
        }
      },
      controller.signal,
    );

    await tick(2);
    controller.abort();
    await expect(streamPromise).resolves.toBeUndefined();
    await tick(2);
    freeze.resolve();
    await tick(2);

    expect(cancelled).toBe(true);
    // The second chunk had already been sent (it was inside the initial credit grant) but its
    // delivery to `onChunk` is skipped once the stream is marked done — a superseded/cancelled
    // stream must not keep calling the caller's callback after its promise has resolved.
    expect(received).toEqual([0]);

    client.dispose();
    server.dispose();
  });

  test('opening a second stream for the same method supersedes and cancels the first', async () => {
    const [a, b] = createInMemoryChannelPair();
    const cancelledIds: string[] = [];
    const handlers = stubHandlers(
      {},
      {
        'thing.stream': async (params, { signal, emit }) => {
          const { id } = params;
          for (let i = 0; i < 5; i++) {
            if (signal.aborted) {
              cancelledIds.push(id);
              return;
            }
            await emit(chunkFor(i));
          }
        },
      },
    );
    const server = createRpcServer<TestContract>(a, handlers, config);
    const client = createRpcClient<TestContract>(b, config);

    const firstReceived: number[] = [];
    const freezeFirst = deferred<void>();
    let firstFrozen = false;
    const firstPromise = client.stream('thing.stream', { id: 'r1' }, async (chunk) => {
      firstReceived.push(chunk.seq);
      if (!firstFrozen) {
        firstFrozen = true;
        await freezeFirst.promise;
      }
    });

    await tick(2); // first chunk delivered and frozen — the stream is genuinely still open

    const secondReceived: number[] = [];
    const secondPromise = client.stream('thing.stream', { id: 'r2' }, (chunk) => {
      secondReceived.push(chunk.seq);
    });

    await expect(firstPromise).resolves.toBeUndefined();
    await secondPromise;
    await tick(2);
    freezeFirst.resolve();
    await tick(2);

    expect(cancelledIds).toEqual(['r1']);
    expect(secondReceived).toEqual([0, 1, 2, 3, 4]);

    client.dispose();
    server.dispose();
  });
});

describe('ipc rpc — protocol integrity', () => {
  test('a version mismatch throws loudly on receipt', () => {
    const [a, b] = createInMemoryChannelPair();
    createRpcServer<TestContract>(a, stubHandlers(), config);
    const client = createRpcClient<TestContract>(b, config);
    void client; // keep the client's onMessage registered

    const badEnvelope = {
      version: CONTRACT_VERSION + 1,
      body: { t: 'evt', method: 'thing.changed', payload: {} },
    };
    expect(() => a.post(badEnvelope)).toThrow(/contract version mismatch/);
  });

  test('wrapVersioned frames delivered directly are otherwise ignored if unrecognised', () => {
    const [a, b] = createInMemoryChannelPair();
    createRpcServer<TestContract>(a, stubHandlers(), config);
    const client = createRpcClient<TestContract>(b, config);
    void client;

    // A server -> client-only frame delivered to the server is a protocol bug, not silently
    // dropped.
    expect(() =>
      b.post(wrapVersioned(config.contractVersion, { t: 'res', id: 1, ok: true, result: {} })),
    ).toThrow(/unexpected frame/);
  });

  test('disposing the server aborts every in-flight stream for that channel', async () => {
    const [a, b] = createInMemoryChannelPair();
    let aborted = false;
    const handlers = stubHandlers(
      {},
      {
        'thing.stream': async (_params, { signal, emit }) => {
          await emit(chunkFor(0));
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              resolve();
            });
          });
        },
      },
    );
    const server = createRpcServer<TestContract>(a, handlers, config);
    const client = createRpcClient<TestContract>(b, config);

    const received: number[] = [];
    const streamPromise = client.stream('thing.stream', { id: 'r1' }, (chunk) => {
      received.push(chunk.seq);
    });

    await tick(2);
    server.dispose();
    await tick(2);

    expect(aborted).toBe(true);
    expect(received).toEqual([0]);

    client.dispose();
    // The client's own stream promise never got an "end" frame (the channel died first) — it
    // is left pending by design (a disposed server is a channel-closed event the *client*
    // detects via its own dispose path in production; here we only assert the server's half).
    void streamPromise;
  });
});
