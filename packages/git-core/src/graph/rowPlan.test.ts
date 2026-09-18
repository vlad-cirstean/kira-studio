import { describe, expect, test } from 'bun:test';
import { CommitStore } from '../store/commitStore.ts';
import { buildRowPlan, type TipRef } from './rowPlan.ts';

/**
 * P93 §8.1: `rowPlan.ts` clears `CLAUDE.md`'s unit-test bar on its own — priority propagation and
 * group-major ordering interact, index math (display-vs-store) has real boundaries, and "final on
 * arrival" is an incremental-arrival invariant invisible in the output of any single call.
 * Contraction's own cases (§4.1/§4.3) land alongside that logic, in a later commit over this same
 * file.
 *
 * Every fixture below numbers commits so a commit's own number equals its own store row — the
 * store assigns rows in append order, and every fixture appends in ascending commit-number order,
 * so `sha(n)` always lands at store row `n`. That keeps `displayRowOf(n)`/`containingDisplayRow(n)`
 * calls below readable as "commit n" without a second row-index translation in the test itself.
 */

function sha(n: number): string {
  return n.toString(16).padStart(40, '0');
}

function commit(n: number, parents: number[]) {
  return {
    sha: sha(n),
    parents: parents.map(sha),
    author: { name: 'A', email: 'a@example.com', timestamp: 1000 - n },
    committer: { name: 'A', email: 'a@example.com', timestamp: 1000 - n },
    subject: `c${n}`,
    decoration: [],
  };
}

function tip(n: number, key: string, label = key): TipRef {
  return { sha: sha(n), key, label };
}

const noOptions = { expandedKeys: new Set<string>(), collapseEnabled: false, revision: 1 };

describe('buildRowPlan — assignment and ordering', () => {
  /**
   * `main` (checked out, tip row 0) chains 0 -> 1 -> 3 (row 3 the shared root). `feature` forks
   * from the same root: tip row 2 -> 3. Row 3 is reachable from both — group 0 (the
   * higher-priority group) wins it.
   */
  function records() {
    return [commit(0, [1]), commit(1, [3]), commit(2, [3]), commit(3, [])];
  }
  function tips(): TipRef[] {
    return [tip(0, 'main'), tip(2, 'feature', 'feature/x')];
  }

  test('final on arrival: one page vs three pages agree on every row', () => {
    const recs = records();

    const onePage = new CommitStore();
    onePage.appendPage(recs);
    const planOnePage = buildRowPlan(onePage, tips(), noOptions);

    const threePages = new CommitStore();
    threePages.appendPage([recs[0]]);
    threePages.appendPage([recs[1], recs[2]]);
    threePages.appendPage([recs[3]]);
    const planThreePages = buildRowPlan(threePages, tips(), noOptions);

    for (let row = 0; row < recs.length; row++) {
      expect(planOnePage.entryAt(planOnePage.displayRowOf(row)).groupIndex).toBe(
        planThreePages.entryAt(planThreePages.displayRowOf(row)).groupIndex,
      );
    }
  });

  test('priority propagation: shared ancestor lands in the higher-priority group', () => {
    const store = new CommitStore();
    store.appendPage(records());
    const plan = buildRowPlan(store, tips(), noOptions);
    // rows 0/1 (main's own chain) and row 3 (shared root, reachable from both) -> group 0.
    expect(plan.entryAt(plan.displayRowOf(0)).groupIndex).toBe(0);
    expect(plan.entryAt(plan.displayRowOf(1)).groupIndex).toBe(0);
    expect(plan.entryAt(plan.displayRowOf(3)).groupIndex).toBe(0);
    // row 2 (feature's own commit, reachable only from feature) -> group 1.
    expect(plan.entryAt(plan.displayRowOf(2)).groupIndex).toBe(1);
  });

  test('a row no tip reaches lands in the synthetic other group', () => {
    const store = new CommitStore();
    store.appendPage([commit(0, [1]), commit(1, [])]);
    const plan = buildRowPlan(store, [tip(9, 'main')], noOptions);
    expect(plan.entryAt(plan.displayRowOf(0)).groupIndex).toBe(1); // 'other' = tips.length
    expect(plan.entryAt(plan.displayRowOf(1)).groupIndex).toBe(1);
  });

  test('ordering is group-major, store order within a group, and deterministic across rebuilds', () => {
    const store = new CommitStore();
    store.appendPage(records());
    const planA = buildRowPlan(store, tips(), noOptions);
    const planB = buildRowPlan(store, tips(), { ...noOptions, revision: 2 });
    const orderA = Array.from({ length: planA.length }, (_, d) => planA.storeRowAt(d));
    const orderB = Array.from({ length: planB.length }, (_, d) => planB.storeRowAt(d));
    expect(orderA).toEqual(orderB);
    // Group 0 (rows 0, 1, 3) entirely before group 1 (row 2).
    expect(orderA).toEqual([0, 1, 3, 2]);
  });

  test('every row renders (identity collapse — contraction lands in a later commit)', () => {
    const store = new CommitStore();
    store.appendPage([
      commit(0, [1]),
      commit(1, [7]),
      commit(2, [3]),
      commit(3, [4]),
      commit(4, [5]),
      commit(5, [6]),
      commit(6, [7]),
      commit(7, []),
    ]);
    const plan = buildRowPlan(store, [tip(0, 'main'), tip(2, 'feature', 'feature/x')], {
      ...noOptions,
      collapseEnabled: true,
    });
    expect(plan.length).toBe(store.rowCount);
    for (let d = 0; d < plan.length; d++) expect(plan.entryAt(d).kind).toBe('commit');
  });
});
