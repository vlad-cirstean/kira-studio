import { describe, expect, test } from 'bun:test';
import { encodeFrame, type FrameSpec } from '../support/encodeFrame';
import { createFakeSocket, type FakeSocket } from './support/fakeSocket';
import { setSocketFactory } from './support/wailsRuntime';

// port.ts calls Stream('engine') once at module scope (P57 §4.1), so every test in this file
// drives the one resulting connection through the same fake — matching how the real module
// actually uses the runtime, rather than one fresh socket per test. The factory must be set
// before the dynamic import below: that import is what actually triggers port.ts's module-scope
// Stream('engine') call, for the whole test process (see support/wailsRuntime.ts).
const socket: FakeSocket = createFakeSocket();
setSocketFactory(() => socket);

const { ready, request, onPortEvent } = await import('../../frontend/src/bridge/port');

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

// port.ts now always JSON.stringifies before calling send (P11 edit 3) — socket.sent holds that
// string, real Stream or this fake alike (fakeSocket.ts's own doc comment on `sent`).
function lastSent(): SentRequest {
  return JSON.parse(socket.sent.at(-1) as string) as SentRequest;
}

// FlatBuffers frames aren't JSON — every response/event this file feeds to socket.__message must
// be a real encoded ArrayBuffer, built through the same generated wire code port.ts's decodeFrame
// reads (encodeFrame is the test-support mirror of Go's own encode.go/frame.go, P11 step 15).
function frameBuffer(spec: FrameSpec): ArrayBuffer {
  const { bytes } = encodeFrame(spec);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// Flips the "KIF1" file identifier (bytes 4-8 of a finished buffer) so wire.Frame.bufferHasIdentifier
// fails — decodeFrame's one no-fallback throw (P11 D1/D5).
function corruptIdentifier(bytes: Uint8Array): ArrayBuffer {
  const copy = bytes.slice();
  copy.set([0, 0, 0, 0], 4);
  return copy.buffer as ArrayBuffer;
}

describe('apps/kira-studio/frontend/src/bridge/port.ts — the Stream transport (P57 D2/D3, P11)', () => {
  test('1. a request issued before the stream opens is not sent until it does', async () => {
    const p = request('ping');
    expect(socket.sent).toHaveLength(0); // CONNECTING: send() would throw on the real socket
    socket.__open();
    await ready;
    await flush();
    expect(socket.sent).toHaveLength(1);
    const sent = lastSent();
    expect(sent.op).toBe('ping');
    socket.__message(
      frameBuffer({
        kind: 'res',
        id: sent.id,
        ok: true,
        payload: { type: 'ping', enginePid: 4321, at: 999 },
      }),
    );
    await expect(p).resolves.toEqual({ pong: true, enginePid: 4321, at: 999 });
  });

  test('2. two concurrent requests resolve independently by id', async () => {
    const p1 = request('a');
    const p2 = request('b');
    await flush();
    const [reqA, reqB] = socket.sent.slice(-2).map((v) => JSON.parse(v as string) as SentRequest);
    // Answered out of order — resolution must key off `id`, not arrival order.
    socket.__message(
      frameBuffer({
        kind: 'res',
        id: reqB.id,
        ok: true,
        payload: { type: 'mutate', affectedRows: 222 },
      }),
    );
    socket.__message(
      frameBuffer({
        kind: 'res',
        id: reqA.id,
        ok: true,
        payload: { type: 'mutate', affectedRows: 111 },
      }),
    );
    await expect(p1).resolves.toEqual({ affectedRows: 111 });
    await expect(p2).resolves.toEqual({ affectedRows: 222 });
  });

  test('3. an error frame rejects with its code', async () => {
    const p = request('boom');
    await flush();
    const sent = lastSent();
    socket.__message(
      frameBuffer({
        kind: 'res',
        id: sent.id,
        ok: false,
        error: { message: 'PG is not connected', code: 'E_DISCONNECTED' },
      }),
    );
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
    const sent = lastSent();
    socket.__message(
      frameBuffer({ kind: 'res', id: sent.id, ok: true, payload: { type: 'empty' } }),
    );
    await never;
  });

  test('5. events fan out to every subscriber on a topic, and unsubscribe works', () => {
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    const offA = onPortEvent('connection:state', (p) => seenA.push(p));
    const offB = onPortEvent('connection:state', (p) => seenB.push(p));
    socket.__message(
      frameBuffer({
        kind: 'evt',
        topic: 'connection:state',
        payload: { type: 'mutate', affectedRows: 1 },
      }),
    );
    expect(seenA).toEqual([{ affectedRows: 1 }]);
    expect(seenB).toEqual([{ affectedRows: 1 }]);
    offA();
    socket.__message(
      frameBuffer({
        kind: 'evt',
        topic: 'connection:state',
        payload: { type: 'mutate', affectedRows: 2 },
      }),
    );
    expect(seenA).toEqual([{ affectedRows: 1 }]);
    expect(seenB).toEqual([{ affectedRows: 1 }, { affectedRows: 2 }]);
    offB();
  });

  // P11: a chunk buffer can no longer be malformed independently of the rest of the frame the way
  // base64 JSON allowed (§6.2) — the one throw decodeFrame has left with no fallback is a mismatched
  // "KIF1" file identifier (D1/D5), which can't be tied back to a specific pending request (the id
  // itself lives inside the very envelope that failed to parse). The fix is the same shape as
  // P2 R2's original one: port.ts's onmessage wraps `decodeFrame` in a try/catch so a synchronous
  // throw during DOM event dispatch can't go uncaught — the corrupt frame is dropped instead, and
  // a later, valid frame for the same id still settles the promise normally.
  test('8. a response frame with a corrupt file identifier is dropped, not left hanging forever', async () => {
    const p = request('read', null, { timeoutMs: null });
    await flush();
    const sent = lastSent();
    const good = encodeFrame({
      kind: 'res',
      id: sent.id,
      ok: true,
      payload: { type: 'mutate', affectedRows: 1 },
    });
    expect(() => socket.__message(corruptIdentifier(good.bytes))).not.toThrow();
    socket.__message(
      frameBuffer({
        kind: 'res',
        id: sent.id,
        ok: true,
        payload: { type: 'mutate', affectedRows: 7 },
      }),
    );
    await expect(p).resolves.toEqual({ affectedRows: 7 });
  });

  // The 'evt' branch has the same hazard, but there is no pending promise to reject for an event —
  // the only correct move is to drop the one corrupt event rather than let the throw propagate
  // (which would abort the fan-out to every *other* subscriber on the topic too).
  test('9. an event frame with a corrupt file identifier drops just that event', () => {
    const seen: unknown[] = [];
    const off = onPortEvent('bad-event', (p) => seen.push(p));
    const good = encodeFrame({
      kind: 'evt',
      topic: 'bad-event',
      payload: { type: 'mutate', affectedRows: 1 },
    });
    expect(() => socket.__message(corruptIdentifier(good.bytes))).not.toThrow();
    expect(seen).toEqual([]);
    socket.__message(
      frameBuffer({
        kind: 'evt',
        topic: 'bad-event',
        payload: { type: 'mutate', affectedRows: 2 },
      }),
    );
    expect(seen).toEqual([{ affectedRows: 2 }]);
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
