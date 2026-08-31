import { describe, expect, test } from 'bun:test';
import { effect, isShallow } from 'vue';
import { createMatchIndex, createPageSearch } from '../../src/renderer/views/shared/page/search';

// P2 R1 regression: two related fixes to shared/page/search.ts (and SearchToolbar.vue's own
// goNext/goPrev, which this file can't reach directly since it's a .vue SFC — covered by their own
// "whole entry, never a nested mutation" comment instead).
//
// 1. searchState used to be a deep reactive() — every match object in every tab's `matches` array
//    (potentially thousands, for a large scan) got recursively wrapped in a reactivity Proxy for no
//    reason, since every writer replaces a tab's entry wholesale rather than mutating a field of an
//    existing one. It's shallowReactive now — test 1 confirms that directly, and test 2 confirms the
//    reactive contract that actually matters (a whole-entry replacement is still tracked) survived
//    the change.
// 2. createMatchIndex used to rebuild a Set<string> of `${row}:${col}` template-literal keys on every
//    recompute — a string allocation per match purely to fake an O(1) lookup a nested Map<number,
//    Set<C>> gets for free with native keys. Tests 3-5 exercise has()/isCurrent() against the new
//    Map-based implementation, including the string-typed `col` a key/value row uses.

describe('searchState reactivity (P2 R1)', () => {
  test('1. createPageSearch builds a shallow-reactive searchState, not a deep one', () => {
    const { searchState } = createPageSearch<{ row: number }>({
      runSearch: () => ({ done: Promise.resolve([]), cancel: () => {} }),
      pageVersion: { n: 0 },
      loadedRowCount: () => 0,
    });
    expect(isShallow(searchState)).toBe(true);
  });

  test("2. a whole-entry replacement (every real writer's own pattern) is still reactive", () => {
    const { searchState } = createPageSearch<{ row: number }>({
      runSearch: () => ({ done: Promise.resolve([]), cancel: () => {} }),
      pageVersion: { n: 0 },
      loadedRowCount: () => 0,
    });
    let seenIndex = -99;
    effect(() => {
      seenIndex = searchState.tab1?.index ?? -99;
    });
    expect(seenIndex).toBe(-99);

    searchState.tab1 = { matches: [{ row: 0 }], index: 0 };
    expect(seenIndex).toBe(0);

    // The exact shape goNext/goPrev now use: spread the previous entry, override index, reassign.
    searchState.tab1 = { ...searchState.tab1, index: 1 };
    expect(seenIndex).toBe(1);
  });
});

describe('createMatchIndex (P2 R1: Map-based, no string-key allocation)', () => {
  test('3. has() finds a matched (row, col) pair and misses everything else', () => {
    const state: Record<string, { matches: { row: number; col: number }[]; index: number }> = {
      tab1: {
        matches: [
          { row: 2, col: 0 },
          { row: 2, col: 3 },
          { row: 5, col: 1 },
        ],
        index: 0,
      },
    };
    const index = createMatchIndex(state, () => 'tab1');
    expect(index.value?.has(2, 0)).toBe(true);
    expect(index.value?.has(2, 3)).toBe(true);
    expect(index.value?.has(2, 1)).toBe(false); // right row, wrong col
    expect(index.value?.has(5, 1)).toBe(true);
    expect(index.value?.has(9, 0)).toBe(false); // row with no matches at all
  });

  test('4. isCurrent() identifies only the entry at the current index', () => {
    const state: Record<string, { matches: { row: number; col: number }[]; index: number }> = {
      tab1: {
        matches: [
          { row: 1, col: 0 },
          { row: 4, col: 2 },
        ],
        index: 1,
      },
    };
    const index = createMatchIndex(state, () => 'tab1');
    expect(index.value?.isCurrent(4, 2)).toBe(true);
    expect(index.value?.isCurrent(1, 0)).toBe(false);
  });

  test('5. works with a string-typed col, the key/value row shape', () => {
    const state: Record<
      string,
      { matches: { row: number; col: 'field' | 'value' }[]; index: number }
    > = {
      tab1: {
        matches: [
          { row: 0, col: 'field' },
          { row: 0, col: 'value' },
        ],
        index: -1,
      },
    };
    const index = createMatchIndex(state, () => 'tab1');
    expect(index.value?.has(0, 'field')).toBe(true);
    expect(index.value?.has(0, 'value')).toBe(true);
    expect(index.value?.has(1, 'field')).toBe(false);
  });

  test('6. an unknown tabId returns null rather than an empty index', () => {
    const state: Record<string, { matches: { row: number; col: number }[]; index: number }> = {};
    const index = createMatchIndex(state, () => 'missing');
    expect(index.value).toBeNull();
  });
});
