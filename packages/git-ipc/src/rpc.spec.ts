import { describe, expect, test } from 'bun:test';
import { deferred, sleep } from '@workbench/testing/unit/async';
import { encodeStreamPayload } from './codec.ts';
import type { PackedCommitChunk, StreamChunkOf } from './contract.ts';
import { createRpcClient, type MessageChannelLike } from './rpc.ts';
import { CONTRACT_VERSION, unwrapVersioned, wrapVersioned } from './validate.ts';

/** N sequential macrotask ticks: some ordering assertions need more than one timer round. */
async function tick(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) await sleep(0);
}

/** In-memory pipe: posting on one end invokes the other end's handler after a structuredClone. */
function createChannelPair(): readonly [MessageChannelLike, MessageChannelLike] {
  const handlers: Array<((message: unknown) => void) | undefined> = [undefined, undefined];
  const end = (self: 0 | 1): MessageChannelLike => ({
    post(message) {
      handlers[1 - self]?.(structuredClone(message));
    },
    onMessage(handler) {
      handlers[self] = handler;
      return () => {
        if (handlers[self] === handler) handlers[self] = undefined;
      };
    },
    close() {},
  });
  return [end(0), end(1)] as const;
}

type Emit = (chunk: StreamChunkOf<'graph.stream'>) => Promise<void>;

interface PeerHandlers {
  readonly request?: (method: string, params: unknown) => Promise<unknown>;
  readonly stream?: (ctx: { signal: AbortSignal; emit: Emit }) => Promise<void>;
}

/** A test-local server: answers `req`, `open`, `credit` and `cancel` frames the way the Go
 *  server does, with credit-gated chunks. */
function createPeer(channel: MessageChannelLike, handlers: PeerHandlers) {
  const post = (body: unknown) => channel.post(wrapVersioned(body));
  const credit = new Map<number, { n: number; wake?: () => void }>();
  const aborts = new Map<number, AbortController>();

  channel.onMessage((raw) => {
    const frame = unwrapVersioned(raw as never) as Record<string, unknown> & {
      id: number;
      n: number;
      method: string;
      params: unknown;
    };
    const id = frame.id;
    switch (frame.t) {
      case 'req':
        handlers.request?.(frame.method, frame.params).then(
          (result) => post({ t: 'res', id, ok: true, result }),
          (e: { code?: string; message: string }) =>
            post({
              t: 'res',
              id,
              ok: false,
              error: { code: e.code ?? 'Error', message: e.message },
            }),
        );
        return;
      case 'open': {
        const controller = new AbortController();
        const gate = { n: 0 } as { n: number; wake?: () => void };
        aborts.set(id, controller);
        credit.set(id, gate);
        let seq = 0;
        const emit: Emit = async (chunk) => {
          while (gate.n === 0 && !controller.signal.aborted) {
            await new Promise<void>((resolve) => {
              gate.wake = resolve;
            });
          }
          if (controller.signal.aborted) return;
          gate.n--;
          post({ t: 'chunk', id, seq: seq++, chunk: encodeStreamPayload('graph.stream', chunk) });
        };
        void (handlers.stream?.({ signal: controller.signal, emit }) ?? Promise.resolve()).then(
          () => post({ t: 'end', id }),
        );
        return;
      }
      case 'credit': {
        const gate = credit.get(id);
        if (gate) {
          gate.n += frame.n;
          gate.wake?.();
        }
        return;
      }
      case 'cancel':
        aborts.get(id)?.abort();
        credit.get(id)?.wake?.();
        return;
    }
  });

  return {
    emitEvent: (method: string, payload: unknown) => post({ t: 'evt', method, payload }),
  };
}

function emptyPackedChunk(): PackedCommitChunk {
  return {
    from: 0,
    to: 0,
    shaWidthBytes: 20,
    shas: new ArrayBuffer(0),
    parentOffsets: new ArrayBuffer(4),
    parentShas: new ArrayBuffer(0),
    identityIds: new ArrayBuffer(0),
    times: new ArrayBuffer(0),
    subjectBytes: new ArrayBuffer(0),
    subjectOffsets: new ArrayBuffer(4),
    dictionaryBase: 0,
    dictionary: [],
    decorations: [],
  };
}

function chunkFor(seq: number): StreamChunkOf<'graph.stream'> {
  return {
    repoId: 'r1',
    seq,
    from: seq,
    to: seq + 1,
    source: 'git',
    remaining: 0,
    exhausted: false,
    commits: emptyPackedChunk(),
  };
}

describe('ipc rpc client — request/response', () => {
  test("a request round-trips to the peer's result", async () => {
    const [a, b] = createChannelPair();
    createPeer(a, {
      request: async (method, params) => {
        expect(method).toBe('repo.close');
        expect(params).toEqual({ repoId: 'r1' });
        return {};
      },
    });
    const client = createRpcClient(b);

    expect(await client.request('repo.close', { repoId: 'r1' })).toEqual({});
    client.dispose();
  });

  test("a request rejects with an RpcError carrying the peer's error code", async () => {
    const [a, b] = createChannelPair();
    createPeer(a, {
      request: async () => {
        throw Object.assign(new Error('no such repo'), { code: 'E_BAD_REQUEST' });
      },
    });
    const client = createRpcClient(b);

    await expect(client.request('repo.open', { path: '/nope' })).rejects.toMatchObject({
      name: 'RpcError',
      code: 'E_BAD_REQUEST',
      message: 'no such repo',
    });
    client.dispose();
  });
});

describe('ipc rpc client — events', () => {
  test('an event reaches registered handlers until unsubscribed', async () => {
    const [a, b] = createChannelPair();
    const peer = createPeer(a, {});
    const client = createRpcClient(b);

    const seen: unknown[] = [];
    const unsubscribe = client.on('repo.changed', (payload) => seen.push(payload));

    peer.emitEvent('repo.changed', { repoId: 'r1', kind: 'refsChanged' });
    await tick();
    expect(seen).toEqual([{ repoId: 'r1', kind: 'refsChanged' }]);

    unsubscribe();
    peer.emitEvent('repo.changed', { repoId: 'r1', kind: 'worktreeChanged' });
    await tick();
    expect(seen).toHaveLength(1);
    client.dispose();
  });
});

describe('ipc rpc client — streams', () => {
  test('ten chunks arrive in order, and the peer never runs ahead of the granted credit', async () => {
    const [a, b] = createChannelPair();
    let emitCompleted = 0;
    createPeer(a, {
      stream: async ({ emit }) => {
        for (let i = 0; i < 10; i++) {
          await emit(chunkFor(i));
          emitCompleted++;
        }
      },
    });
    const client = createRpcClient(b);

    const received: number[] = [];
    const freeze = deferred<void>();
    let frozen = false;
    const done = client.stream('graph.stream', { repoId: 'r1' }, async (chunk) => {
      received.push((chunk as StreamChunkOf<'graph.stream'>).seq);
      if (!frozen) {
        frozen = true;
        await freeze.promise;
      }
    });

    await tick(3);
    // Initial credit is 2: the peer gets that far ahead while the client is stalled on chunk 0.
    expect(emitCompleted).toBe(2);
    expect(received).toEqual([0]);

    freeze.resolve();
    await done;
    expect(received).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    client.dispose();
  });

  test('cancel mid-stream stops delivery and resolves the promise cleanly', async () => {
    const [a, b] = createChannelPair();
    let cancelled = false;
    createPeer(a, {
      stream: async ({ signal, emit }) => {
        for (let i = 0; i < 5; i++) {
          if (signal.aborted) {
            cancelled = true;
            return;
          }
          await emit(chunkFor(i));
        }
      },
    });
    const client = createRpcClient(b);

    const controller = new AbortController();
    const received: number[] = [];
    const done = client.stream(
      'graph.stream',
      { repoId: 'r1' },
      (chunk) => {
        received.push((chunk as StreamChunkOf<'graph.stream'>).seq);
        controller.abort();
      },
      controller.signal,
    );
    await done;
    await tick(2);

    expect(received).toEqual([0]);
    expect(cancelled || received.length < 5).toBe(true);
    client.dispose();
  });

  test('concurrent streams on one client complete independently', async () => {
    const [a, b] = createChannelPair();
    createPeer(a, {
      stream: async ({ emit }) => {
        for (let i = 0; i < 3; i++) await emit(chunkFor(i));
      },
    });
    const client = createRpcClient(b);

    const first: number[] = [];
    const second: number[] = [];
    await Promise.all([
      client.stream('graph.stream', { repoId: 'r1' }, (c) => {
        first.push((c as StreamChunkOf<'graph.stream'>).seq);
      }),
      client.stream('graph.stream', { repoId: 'r2' }, (c) => {
        second.push((c as StreamChunkOf<'graph.stream'>).seq);
      }),
    ]);

    expect(first).toEqual([0, 1, 2]);
    expect(second).toEqual([0, 1, 2]);
    client.dispose();
  });

  test('rawStreamChunks delivers the still-wire-shaped chunk without decoding it', async () => {
    const [a, b] = createChannelPair();
    createPeer(a, {
      stream: async ({ emit }) => {
        await emit(chunkFor(0));
      },
    });
    const client = createRpcClient(b, { rawStreamChunks: true });

    const received: unknown[] = [];
    await client.stream('graph.stream', { repoId: 'r1' }, (chunk) => {
      received.push(chunk);
    });

    const envelope = received[0] as { commits: { $fb: string; d: ArrayBuffer } };
    expect(envelope.commits.$fb).toBe('gitwire/1');
    expect(envelope.commits.d).toBeInstanceOf(ArrayBuffer);
    client.dispose();
  });

  test('a throwing onChunk rejects the stream promise instead of wedging it', async () => {
    const [a, b] = createChannelPair();
    createPeer(a, {
      stream: async ({ emit }) => {
        for (let i = 0; i < 5; i++) await emit(chunkFor(i));
      },
    });
    const client = createRpcClient(b);

    const boom = new Error('bad chunk');
    await expect(
      client.stream('graph.stream', { repoId: 'r1' }, () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
    client.dispose();
  });
});

describe('ipc rpc client — protocol integrity', () => {
  test('a contract version mismatch throws loudly on receipt', () => {
    const [a, b] = createChannelPair();
    const client = createRpcClient(b);
    void client;

    const badEnvelope = {
      version: CONTRACT_VERSION + 1,
      body: { t: 'evt', method: 'repo.changed', payload: {} },
    };
    expect(() => a.post(badEnvelope)).toThrow(/contract version mismatch/);
  });
});
