import { describe, expect, test } from 'bun:test';
import { decode, dedupeTransferList, encode } from './codec';

/**
 * Round-trips a message through the codec, over a real `MessageChannel` so the ArrayBuffer case
 * exercises actual structured-clone transfer semantics rather than an in-process stand-in.
 */
async function roundTrip<T>(message: T, transfer: readonly ArrayBuffer[]): Promise<T> {
  const { port1, port2 } = new MessageChannel();
  const received = new Promise<T>((resolve) => {
    port2.onmessage = (event) => resolve(decode(event.data as T));
  });
  port1.postMessage(message, transfer as ArrayBuffer[]);
  const result = await received;
  port1.close();
  port2.close();
  return result;
}

/** A neutral fixture shaped like `@kira/git-ipc`'s own `PackedCommitChunk` — seven nested
 *  `ArrayBuffer` fields, some empty, one carrying real content — without naming anything Git's.
 *  What this proves (the codec's `collectTransferables` walk finds every buffer, however deep,
 *  and a transport really transfers rather than clones them) is a property of the walk, not of
 *  any one module's contract. */
interface SevenBufferFixture {
  readonly label: string;
  readonly a: ArrayBuffer;
  readonly b: ArrayBuffer;
  readonly c: ArrayBuffer;
  readonly d: ArrayBuffer;
  readonly e: ArrayBuffer;
  readonly f: ArrayBuffer;
  readonly g: ArrayBuffer;
}

function emptyFixture(): SevenBufferFixture {
  return {
    label: 'fixture',
    a: new ArrayBuffer(0),
    b: new ArrayBuffer(4),
    c: new ArrayBuffer(0),
    d: new ArrayBuffer(0),
    e: new ArrayBuffer(0),
    f: new ArrayBuffer(0),
    g: new ArrayBuffer(4),
  };
}

describe('ipc codec', () => {
  test('transfers every nested buffer rather than copying it', async () => {
    const fixture = emptyFixture();
    const a = new ArrayBuffer(20 * 3);
    new Uint8Array(a).fill(0xab);
    const withRealBuffer: SevenBufferFixture = { ...fixture, a };

    const { payload, transfer } = encode(withRealBuffer);
    // Every ArrayBuffer field of the fixture is collected, including the empty ones.
    expect(transfer).toHaveLength(7);
    expect(transfer[0]).toBe(a);
    expect(dedupeTransferList(transfer)).toBe(transfer);

    const result = await roundTrip(payload, transfer);

    // Transferred (not cloned): the original buffer is detached after postMessage.
    expect(a.byteLength).toBe(0);
    expect(result.a.byteLength).toBe(60);
    expect(new Uint8Array(result.a).every((b) => b === 0xab)).toBe(true);
  });

  test('dedupeTransferList throws on a buffer listed twice', () => {
    const buffer = new ArrayBuffer(4);
    expect(() => dedupeTransferList([buffer, buffer])).toThrow(/appears twice/);
  });
});
