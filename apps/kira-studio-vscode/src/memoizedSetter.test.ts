import { describe, expect, test } from 'bun:test';
import { memoizedSetter } from './memoizedSetter.ts';

// G30 round-1 performance review, finding #10: updateContextKeys (reviewMarking.ts) used to call
// VS Code's own `setContext` command unconditionally on every editor selection change — a
// drag-select or multi-cursor move can fire that many times a second — even when the value hadn't
// actually changed. memoizedSetter is the pure skip-on-unchanged logic factored out so it's
// testable without an extension host.
describe('memoizedSetter', () => {
  test('the first call always reaches the underlying setter, even for a falsy value', () => {
    const calls: boolean[] = [];
    const set = memoizedSetter<boolean>((v) => calls.push(v));
    set(false);
    expect(calls).toEqual([false]);
  });

  test('a repeated identical value is skipped, not re-sent', () => {
    const calls: string[] = [];
    const set = memoizedSetter<string>((v) => calls.push(v));
    set('full');
    set('full');
    set('full');
    expect(calls).toEqual(['full']);
  });

  test('a changed value always reaches the underlying setter', () => {
    const calls: string[] = [];
    const set = memoizedSetter<string>((v) => calls.push(v));
    set('none');
    set('partial');
    set('partial');
    set('full');
    set('full');
    set('none');
    expect(calls).toEqual(['none', 'partial', 'full', 'none']);
  });

  test('two independently constructed setters track their own last value, not a shared one', () => {
    const callsA: boolean[] = [];
    const callsB: boolean[] = [];
    const setA = memoizedSetter<boolean>((v) => callsA.push(v));
    const setB = memoizedSetter<boolean>((v) => callsB.push(v));
    setA(true);
    setB(true); // B's own first call — must still reach its setter despite A already being true.
    expect(callsA).toEqual([true]);
    expect(callsB).toEqual([true]);
  });
});
