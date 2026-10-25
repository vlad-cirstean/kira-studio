import { describe, expect, test } from 'bun:test';
import { CommitStore } from '../store/commitStore.ts';
import { localTopoOrder } from './displayOrder.ts';
import type { LayoutInput } from './types.ts';

/**
 * Clears `CLAUDE.md`'s unit-test bar: chain, stack and readiness rules interact, and the
 * paging case is an incremental-arrival behavior invisible in any single call.
 *
 * Fixtures give each commit its store row (date order, children first) and list parent rows;
 * `-1` is an unloaded parent.
 */

function inputOf(parents: readonly (readonly number[])[]): LayoutInput {
  const offsets = new Uint32Array(parents.length + 1);
  const flat: number[] = [];
  for (let row = 0; row < parents.length; row++) {
    offsets[row] = flat.length;
    flat.push(...parents[row]);
  }
  offsets[parents.length] = flat.length;
  return {
    from: 0,
    to: parents.length,
    parentOffsets: offsets,
    parentRows: Int32Array.from(flat),
    resolvedParentSlots: new Uint32Array(0),
  };
}

const unresolvedSha = (row: number) => `unresolved-${row}`;
const order = (parents: readonly (readonly number[])[]) =>
  Array.from(localTopoOrder(inputOf(parents), unresolvedSha));

// Rows: 0 f3, 1 m6, 2 m5, 3 m4, 4 m3, 5 m2, 6 x2, 7 f2, 8 x1, 9 f1, 10 m1, 11 m0.
// `feat` (f1 f2 f3) and `fix` (x1 x2) fork from m1 and interleave in date order.
const FORK = [[7], [2], [3], [4], [5], [10], [8], [9], [10], [10], [11], []];

describe('localTopoOrder', () => {
  test('no interleaving siblings: output equals store order', () => {
    const linear = [[1], [2], [3], []];
    expect(order(linear)).toEqual([0, 1, 2, 3]);
    // A fork whose branches do not interleave: x1 x2 then f1 f2.
    expect(order([[1], [3], [3], [4], []])).toEqual([0, 1, 2, 3, 4]);
  });

  test('sibling branches that interleave become contiguous, in date order otherwise', () => {
    // f3 m6 m5 m4 m3 m2 x2 x1 f2 f1 m1 m0
    expect(order(FORK)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 7, 9, 10, 11]);
  });

  test('a merged branch sits contiguous below its merge', () => {
    // 0 m4, 1 merge-fa, 2 fa3, 3 m3, 4 fa2, 5 m2, 6 fa1, 7 m1, 8 m0
    const merged = [[1], [3, 2], [4], [5], [6], [7], [7], [8], []];
    // m4 merge-fa fa3 fa2 fa1 m3 m2 m1 m0
    expect(order(merged)).toEqual([0, 1, 2, 4, 6, 3, 5, 7, 8]);
  });

  test('three siblings with nested starts finish innermost first', () => {
    // 0-2 a1 b1 c1, 3-5 a2 b2 c2, 6-8 a3 b3 c3, 9 fork, 10 root
    const nested = [[3], [4], [5], [6], [7], [8], [9], [9], [9], [10], []];
    expect(order(nested)).toEqual([0, 1, 2, 5, 8, 4, 7, 3, 6, 9, 10]);
  });

  test('a fork parent loaded by a later page yields the one-page order', () => {
    const sha = (row: number) => row.toString(16).padStart(40, '0');
    const records = FORK.map((parents, row) => ({
      sha: sha(row),
      parents: parents.map(sha),
      author: { name: 'A', email: 'a@example.com', timestamp: 1000 - row },
      committer: { name: 'A', email: 'a@example.com', timestamp: 1000 - row },
      subject: `c${row}`,
      decoration: [],
    }));
    const planOf = (store: CommitStore) =>
      Array.from(
        localTopoOrder(
          store.layoutInput(0, store.rowCount),
          (row) => store.commitAt(row).parents[0],
        ),
      );

    const paged = new CommitStore();
    paged.appendPage(records.slice(0, 9));
    // Fork parents unloaded: f2's and the fix/main chains' bottoms do not share a key yet.
    expect(planOf(paged)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    paged.appendPage(records.slice(9));

    const whole = new CommitStore();
    whole.appendPage(records);
    expect(planOf(paged)).toEqual(planOf(whole));
    expect(planOf(whole)).toEqual(order(FORK));
  });

  test('property: random children-first DAGs yield a permutation with parents after children', () => {
    let seed = 0x2f6e2b1;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(rand() * 60);
      const parents: number[][] = [];
      for (let row = 0; row < n; row++) {
        const links: number[] = [];
        const wanted = rand() < 0.1 ? 0 : rand() < 0.2 ? 2 : 1;
        for (let i = 0; i < wanted; i++) {
          const target = row + 1 + Math.floor(rand() * 8);
          if (target < n && !links.includes(target)) links.push(target);
          else if (target >= n && rand() < 0.5 && !links.includes(-1)) links.push(-1);
        }
        parents.push(links);
      }
      const result = order(parents);
      expect([...result].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
      const position = new Int32Array(n);
      result.forEach((row, index) => {
        position[row] = index;
      });
      for (let row = 0; row < n; row++) {
        for (const parent of parents[row]) {
          if (parent >= 0) expect(position[parent]).toBeGreaterThan(position[row]);
        }
      }
    }
  });
});
