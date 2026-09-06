// P21 round 3 performance finding 2: findRanges(doc, query) allocated a full lowercase copy of
// `doc` and walked it, with no memoisation, and was called for the *same* (doc, query) pair up to
// five times per keystroke (ResponseFindBar.vue's matchCounts + scrollToCurrent,
// ResponsePane.vue's perTargetHighlighters, rangeHighlightPlugin's own constructor/update). The fix
// hoists the actual match-position walk behind a small bounded cache keyed on (doc, query) —
// `currentIndex` only relabels which position gets the "current" class, so it never needs to bust
// the cache. findRanges.ts imports nothing that reaches window/bridge, so no window stub is needed.
import { describe, expect, test } from 'bun:test';
import { findRanges } from '../../frontend/src/editor/findRanges';

// Each test uses its own distinct doc text so the module-level position cache (shared across every
// test in this file, by design — it's the same cache the real app shares across calls) never lets
// one test's cache entry answer for another's.
function uniqueDoc(seed: string): string {
  return `${seed} needle here, and a second needle later, plus NEEDLE in caps.`;
}

describe('findRanges correctness (unchanged by the memoisation)', () => {
  test('finds every case-insensitive occurrence, ascending by position', () => {
    const doc = uniqueDoc('correctness-1');
    const ranges = findRanges(doc, 'needle');
    expect(ranges).toHaveLength(3);
    expect(ranges.every((r) => r.class === 'cm-kira-find-match')).toBe(true);
    expect(ranges[0]?.from).toBeLessThan(ranges[1]?.from ?? 0);
    expect(ranges[1]?.from).toBeLessThan(ranges[2]?.from ?? 0);
    for (const r of ranges) {
      expect(doc.slice(r.from, r.to).toLowerCase()).toBe('needle');
    }
  });

  test('currentIndex marks exactly one range as current, by position order', () => {
    const doc = uniqueDoc('correctness-2');
    const ranges = findRanges(doc, 'needle', 1);
    expect(ranges.map((r) => r.class)).toEqual([
      'cm-kira-find-match',
      'cm-kira-find-match-current',
      'cm-kira-find-match',
    ]);
  });

  test('empty query returns no matches', () => {
    expect(findRanges(uniqueDoc('correctness-3'), '')).toEqual([]);
  });

  test('a query with no occurrence returns no matches', () => {
    expect(findRanges(uniqueDoc('correctness-4'), 'zzz-not-present')).toEqual([]);
  });

  test('an out-of-range currentIndex marks nothing current (still valid ranges)', () => {
    const doc = uniqueDoc('correctness-5');
    const ranges = findRanges(doc, 'needle', 99);
    expect(ranges.every((r) => r.class === 'cm-kira-find-match')).toBe(true);
  });
});

describe('findRanges memoisation (finding 2)', () => {
  test('a second call with the same (doc, query) does not re-lowercase the document', () => {
    const doc = uniqueDoc('memo-1');
    let calls = 0;
    const original = String.prototype.toLowerCase;
    // biome-ignore lint/suspicious/noExplicitAny: instrumenting a built-in for one assertion
    (String.prototype as any).toLowerCase = function (this: string) {
      if (this === doc) calls++;
      return original.call(this);
    };
    try {
      findRanges(doc, 'needle');
      expect(calls).toBe(1); // the first call actually walks the document
      findRanges(doc, 'needle');
      expect(calls).toBe(1); // the second call for the same pair reuses the cached positions
      findRanges(doc, 'needle', 2); // a different currentIndex is still a cache hit
      expect(calls).toBe(1);
    } finally {
      String.prototype.toLowerCase = original;
    }
  });

  test('a different query on the same doc is a cache miss (re-lowercases)', () => {
    const doc = uniqueDoc('memo-2');
    let calls = 0;
    const original = String.prototype.toLowerCase;
    // biome-ignore lint/suspicious/noExplicitAny: instrumenting a built-in for one assertion
    (String.prototype as any).toLowerCase = function (this: string) {
      if (this === doc) calls++;
      return original.call(this);
    };
    try {
      findRanges(doc, 'needle');
      findRanges(doc, 'second');
      expect(calls).toBe(2);
    } finally {
      String.prototype.toLowerCase = original;
    }
  });

  test('the position cache is bounded — a 5th distinct (doc, query) evicts the oldest entry', () => {
    const docs = Array.from({ length: 5 }, (_, i) => uniqueDoc(`memo-bounded-${i}`));
    for (const d of docs) findRanges(d, 'needle');

    let calls = 0;
    const original = String.prototype.toLowerCase;
    const first = docs[0];
    // biome-ignore lint/suspicious/noExplicitAny: instrumenting a built-in for one assertion
    (String.prototype as any).toLowerCase = function (this: string) {
      if (this === first) calls++;
      return original.call(this);
    };
    try {
      // The cache holds at most 4 entries, so the 1st doc's entry was evicted by the 5th call
      // above — asking for it again must re-walk it, not serve a stale/absent cache slot.
      findRanges(first ?? '', 'needle');
      expect(calls).toBe(1);
    } finally {
      String.prototype.toLowerCase = original;
    }
  });
});
