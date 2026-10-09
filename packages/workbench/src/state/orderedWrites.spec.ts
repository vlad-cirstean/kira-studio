import { describe, expect, test } from 'bun:test';
import { createOrderedWriter } from './orderedWrites';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** A send whose completions the test releases by hand, out of band. */
function manualSend() {
  const calls: { id: string; text: string; done: () => void; fail: (e: unknown) => void }[] = [];
  const send = (id: string, bytes: Uint8Array) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ id, text: dec(bytes), done: resolve, fail: reject });
    });
  return { calls, send };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createOrderedWriter', () => {
  test('an idle id sends at once; keys typed while in flight coalesce in order', async () => {
    const { calls, send } = manualSend();
    const w = createOrderedWriter(send, () => {});
    for (const ch of 'echo') w.write('a', enc(ch));
    expect(calls.map((c) => c.text)).toEqual(['e']);

    calls[0].done();
    await tick();
    expect(calls.map((c) => c.text)).toEqual(['e', 'cho']);

    calls[1].done();
    await tick();
    w.write('a', enc('!'));
    expect(calls.map((c) => c.text)).toEqual(['e', 'cho', '!']);
  });

  test('ids do not block each other', () => {
    const { calls, send } = manualSend();
    const w = createOrderedWriter(send, () => {});
    w.write('a', enc('1'));
    w.write('b', enc('2'));
    expect(calls.map((c) => `${c.id}:${c.text}`)).toEqual(['a:1', 'b:2']);
  });

  test('a failed write is reported and later chunks still send', async () => {
    const { calls, send } = manualSend();
    const errors: unknown[] = [];
    const w = createOrderedWriter(send, (_id, e) => errors.push(e));
    w.write('a', enc('x'));
    w.write('a', enc('y'));
    calls[0].fail(new Error('boom'));
    await tick();
    expect(errors).toHaveLength(1);
    expect(calls.map((c) => c.text)).toEqual(['x', 'y']);
  });

  test('drop discards queued chunks and a later write starts a fresh lane', async () => {
    const { calls, send } = manualSend();
    const w = createOrderedWriter(send, () => {});
    w.write('a', enc('x'));
    w.write('a', enc('queued'));
    w.drop('a');
    calls[0].done();
    await tick();
    expect(calls.map((c) => c.text)).toEqual(['x']);

    w.write('a', enc('again'));
    expect(calls.map((c) => c.text)).toEqual(['x', 'again']);
  });
});
