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

const { ready, request, onPortEvent, reviveChunks } = await import(
  '../../frontend/src/bridge/port'
);

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

describe('apps/kira-studio/frontend/src/bridge/port.ts — the JSONStream transport (P57 D2/D3)', () => {
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

  test('6. a base64-encoded TextColumnChunk is revived into real typed arrays', async () => {
    // Every buffer crosses the wire as base64 of its exact little-endian bytes (page.Chunk's
    // MarshalJSON, P58 D5) — decoded straight into the typed array's backing buffer. The Node
    // engine's index-keyed JSON.stringify shape this used to also cover, and the decode branch for
    // it, are both gone (P58f D8) — base64 is the only shape port.ts's toTypedArray accepts now.
    const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    const wireEncoded = {
      page: {
        kind: 'tabular',
        columns: [{ name: 'id' }],
        chunks: [
          {
            data: toBase64(new Uint8Array([97, 98])),
            offsets: toBase64(new Uint8Array(new Uint32Array([0, 1, 2]).buffer)),
            nulls: toBase64(new Uint8Array([0])),
            truncated: toBase64(new Uint8Array(0)),
          },
        ],
      },
      source: 'server',
    };
    const p = request('read');
    await flush();
    const sent = socket.sent.at(-1) as SentRequest;
    socket.__message({ kind: 'res', id: sent.id, ok: true, payload: wireEncoded });
    const result = (await p) as typeof wireEncoded;
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

  // P2 R1: toTypedArray's decode has two paths — Uint8Array.fromBase64 where the runtime has it
  // (Bun does, exercised by every other test in this file already), and the original atob()+
  // charCodeAt loop as a fallback for a webview that doesn't. This test is the only one that
  // actually drives that fallback: it removes fromBase64 for its own duration so the loop is what
  // runs, proving the two paths decode to the exact same bytes rather than just trusting the
  // fallback code compiles.
  test('7. base64 decode falls back to the atob() loop when Uint8Array.fromBase64 is unavailable', () => {
    const original = Uint8Array.fromBase64;
    // biome-ignore lint/suspicious/noExplicitAny: simulating a webview without this TC39 method
    (Uint8Array as any).fromBase64 = undefined;
    try {
      const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
      const chunk = {
        data: toBase64(new Uint8Array([10, 20, 30])),
        offsets: toBase64(new Uint8Array(new Uint32Array([0, 3]).buffer)),
        nulls: toBase64(new Uint8Array([1])),
        truncated: toBase64(new Uint8Array(0)),
      };
      const revived = reviveChunks(chunk) as {
        data: Uint8Array;
        offsets: Uint32Array;
        nulls: Uint8Array;
        truncated: Uint32Array;
      };
      expect(revived.data).toBeInstanceOf(Uint8Array);
      expect(Array.from(revived.data)).toEqual([10, 20, 30]);
      expect(revived.offsets).toBeInstanceOf(Uint32Array);
      expect(Array.from(revived.offsets)).toEqual([0, 3]);
      expect(Array.from(revived.nulls)).toEqual([1]);
      expect(revived.truncated.length).toBe(0);
    } finally {
      Uint8Array.fromBase64 = original;
    }
  });

  // P2 R2: reviveChunks throws on a malformed chunk (bad base64, a buffer whose byte length isn't
  // a multiple of the typed array's element size, ...) — genuinely reachable on a corrupt or
  // truncated frame. Before this fix, that throw happened after the pending entry (and its
  // timeout) were already deleted, from inside DOM event dispatch, which swallows it — the
  // request's promise then never settled at all. This chunk's offsets buffer is 3 bytes (not a
  // multiple of 4), which trips `new Uint32Array(buffer)`'s own RangeError deterministically,
  // regardless of which base64 decode path toTypedArray takes.
  test('8. a malformed chunk in a response rejects the request instead of hanging forever', async () => {
    const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    const p = request('read');
    await flush();
    const sent = socket.sent.at(-1) as SentRequest;
    socket.__message({
      kind: 'res',
      id: sent.id,
      ok: true,
      payload: {
        data: toBase64(new Uint8Array([1, 2])),
        offsets: toBase64(new Uint8Array([1, 2, 3])),
        nulls: toBase64(new Uint8Array([0])),
        truncated: toBase64(new Uint8Array(0)),
      },
    });
    await expect(p).rejects.toThrow();
  });

  // The 'evt' branch has the same hazard, but there is no pending promise to reject for an event —
  // the only correct move is to drop the one malformed event rather than let the throw propagate
  // (which would abort the fan-out to every *other* subscriber on the topic too).
  test('9. a malformed chunk in an event payload drops just that event', () => {
    const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    const seen: unknown[] = [];
    const off = onPortEvent('bad-event', (p) => seen.push(p));
    expect(() => {
      socket.__message({
        kind: 'evt',
        topic: 'bad-event',
        payload: {
          data: toBase64(new Uint8Array([1, 2])),
          offsets: toBase64(new Uint8Array([1, 2, 3])),
          nulls: toBase64(new Uint8Array([0])),
          truncated: toBase64(new Uint8Array(0)),
        },
      });
    }).not.toThrow();
    expect(seen).toEqual([]);
    off();
  });

  // Terminal: closing the stream is not reversible in this module, so this runs last.
  test('10. close rejects every pending request, and later requests reject immediately', async () => {
    const pending = request('during-close');
    await flush();
    socket.__close();
    await expect(pending).rejects.toThrow('engine stream closed before this request answered');
    await expect(request('after-close')).rejects.toThrow('engine stream is closed');
  });
});
