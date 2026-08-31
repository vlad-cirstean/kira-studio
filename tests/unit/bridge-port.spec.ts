import { describe, expect, test } from 'bun:test';
import { createFakeSocket, type FakeSocket } from './support/fakeSocket';
import { setSocketFactory } from './support/wailsRuntime';

// port.ts calls JSONStream('engine') once at module scope (P57 §4.1), so every test in this file
// drives the one resulting connection through the same fake — matching how the real module
// actually uses the runtime, rather than one fresh socket per test. The factory must be set
// before the dynamic import below: that import is what actually triggers port.ts's module-scope
// JSONStream('engine') call, for the whole test process (see support/wailsRuntime.ts).
const socket: FakeSocket = createFakeSocket();
setSocketFactory(() => socket);

const { ready, request, onPortEvent } = await import('../../src/renderer/bridge/port');

// request() gates its send on `ready` via a .then() registered synchronously but resolved on a
// later microtask; awaiting `ready` itself is not enough to guarantee that .then has *also* run,
// so tests flush an extra microtask tick before reading socket.sent.
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

interface SentRequest {
  kind: 'req';
  id: number;
  op: string;
  payload: unknown;
}

describe('src/renderer/bridge/port.ts — the JSONStream transport (P57 D2/D3)', () => {
  test('1. a request issued before the stream opens is not sent until it does', async () => {
    const p = request('ping');
    expect(socket.sent).toHaveLength(0); // CONNECTING: send() would throw on the real socket
    socket.__open();
    await ready;
    await flush();
    expect(socket.sent).toHaveLength(1);
    const sent = socket.sent[0] as SentRequest;
    expect(sent.op).toBe('ping');
    socket.__message({ kind: 'res', id: sent.id, ok: true, payload: { pong: true } });
    await expect(p).resolves.toEqual({ pong: true });
  });

  test('2. two concurrent requests resolve independently by id', async () => {
    const p1 = request('a');
    const p2 = request('b');
    await flush();
    const [reqA, reqB] = socket.sent.slice(-2) as SentRequest[];
    // Answered out of order — resolution must key off `id`, not arrival order.
    socket.__message({ kind: 'res', id: reqB.id, ok: true, payload: 'B' });
    socket.__message({ kind: 'res', id: reqA.id, ok: true, payload: 'A' });
    await expect(p1).resolves.toBe('A');
    await expect(p2).resolves.toBe('B');
  });

  test('3. an error frame rejects with its code', async () => {
    const p = request('boom');
    await flush();
    const sent = socket.sent.at(-1) as SentRequest;
    socket.__message({
      kind: 'res',
      id: sent.id,
      ok: false,
      error: { message: 'PG is not connected', code: 'E_DISCONNECTED' },
    });
    await expect(p).rejects.toMatchObject({
      message: 'PG is not connected',
      code: 'E_DISCONNECTED',
    });
  });

  test('4. a request times out per its own timeoutMs, and timeoutMs: null never does', async () => {
    const p = request('slow', null, { timeoutMs: 10 });
    await expect(p).rejects.toThrow('engine request "slow" timed out');

    const never = request('no-timeout', null, { timeoutMs: null });
    const sentinel = Symbol('still pending');
    const race = await Promise.race([never, new Promise((r) => setTimeout(() => r(sentinel), 50))]);
    expect(race).toBe(sentinel);
    // Answer it so the test doesn't leave a dangling pending entry for later tests.
    await flush();
    const sent = socket.sent.at(-1) as SentRequest;
    socket.__message({ kind: 'res', id: sent.id, ok: true, payload: null });
    await never;
  });

  test('5. events fan out to every subscriber on a topic, and unsubscribe works', () => {
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    const offA = onPortEvent('connection:state', (p) => seenA.push(p));
    const offB = onPortEvent('connection:state', (p) => seenB.push(p));
    socket.__message({ kind: 'evt', topic: 'connection:state', payload: { id: 1 } });
    expect(seenA).toEqual([{ id: 1 }]);
    expect(seenB).toEqual([{ id: 1 }]);
    offA();
    socket.__message({ kind: 'evt', topic: 'connection:state', payload: { id: 2 } });
    expect(seenA).toEqual([{ id: 1 }]);
    expect(seenB).toEqual([{ id: 1 }, { id: 2 }]);
    offB();
  });

  test('6. a JSON-round-tripped TextColumnChunk is revived into real typed arrays', async () => {
    // JSON.stringify on a Uint8Array/Uint32Array serialises it as a plain object keyed "0","1",...
    // (TypedArrays are not Array.isArray) — exactly what JSON.parse hands back to onmessage, since
    // JSONStream's own decode is a plain JSON.parse. Found live: a real data:read response failed
    // downstream with "chunk.data is not a Uint8Array" (protocol/page.ts's assertChunkStructure)
    // until reviveChunks (P57 finding, discovered by the C1 boot proof) fixed it.
    const jsonRoundTripped = {
      page: {
        kind: 'tabular',
        columns: [{ name: 'id' }],
        chunks: [
          {
            data: { 0: 97, 1: 98 },
            offsets: { 0: 0, 1: 1, 2: 2 },
            nulls: { 0: 0 },
            truncated: {},
          },
        ],
      },
      source: 'server',
    };
    const p = request('read');
    await flush();
    const sent = socket.sent.at(-1) as SentRequest;
    socket.__message({ kind: 'res', id: sent.id, ok: true, payload: jsonRoundTripped });
    const result = (await p) as typeof jsonRoundTripped;
    const chunk = result.page.chunks[0] as unknown as {
      data: Uint8Array;
      offsets: Uint32Array;
      nulls: Uint8Array;
      truncated: Uint32Array;
    };
    expect(chunk.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(chunk.data)).toEqual([97, 98]);
    expect(chunk.offsets).toBeInstanceOf(Uint32Array);
    expect(Array.from(chunk.offsets)).toEqual([0, 1, 2]);
    expect(chunk.nulls).toBeInstanceOf(Uint8Array);
    expect(chunk.truncated).toBeInstanceOf(Uint32Array);
    expect(chunk.truncated.length).toBe(0);
  });

  // Terminal: closing the stream is not reversible in this module, so this runs last.
  test('7. close rejects every pending request, and later requests reject immediately', async () => {
    const pending = request('during-close');
    await flush();
    socket.__close();
    await expect(pending).rejects.toThrow('engine stream closed before this request answered');
    await expect(request('after-close')).rejects.toThrow('engine stream is closed');
  });
});
