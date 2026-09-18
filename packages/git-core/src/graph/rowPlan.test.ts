import { describe, expect, test } from 'bun:test';
import { CommitStore } from '../store/commitStore.ts';
import { buildRowPlan, identityRowPlan, projectLayoutInput, type TipRef } from './rowPlan.ts';

/**
 * P93 §8.1: `rowPlan.ts` clears `CLAUDE.md`'s unit-test bar on its own — priority propagation and
 * group-major ordering interact, index math (display-vs-store) has real boundaries, contraction
 * has several interacting rules of its own (§4.1/§4.3), and "final on arrival" is an
 * incremental-arrival invariant invisible in the output of any single call.
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

  test('every row renders when collapse is disabled, however large a group is', () => {
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
    const plan = buildRowPlan(store, [tip(0, 'main'), tip(2, 'feature', 'feature/x')], noOptions);
    expect(plan.length).toBe(store.rowCount);
    for (let d = 0; d < plan.length; d++) expect(plan.entryAt(d).kind).toBe('commit');
  });
});

describe('buildRowPlan — contraction (§4.1/§4.3)', () => {
  /** Same shape as the ordering fixtures above: `main` (tip row 0) chains 0 -> 1 -> 7 (row 7 the
   *  shared root); `feature` (tip row 2) chains 2 -> 3 -> 4 -> 5 -> 6 -> 7. Group 0 (main) claims
   *  rows 0, 1, 7 — exactly `MIN_COLLAPSIBLE`, so it never collapses either way. Group 1 (feature)
   *  claims rows 2, 3, 4, 5, 6 — 5 members, collapsing to tip (2), a placeholder hiding 3/4/5, and
   *  oldest (6). */
  function records() {
    return [
      commit(0, [1]),
      commit(1, [7]),
      commit(2, [3]),
      commit(3, [4]),
      commit(4, [5]),
      commit(5, [6]),
      commit(6, [7]),
      commit(7, []),
    ];
  }
  function tips(): TipRef[] {
    return [tip(0, 'main'), tip(2, 'feature', 'feature/x')];
  }

  test('a group of more than MIN_COLLAPSIBLE members collapses to tip, placeholder, oldest', () => {
    const store = new CommitStore();
    store.appendPage(records());
    const plan = buildRowPlan(store, tips(), { ...noOptions, collapseEnabled: true });

    expect(plan.length).toBe(6); // group 0's 3 rows + group 1's tip/placeholder/oldest
    expect(plan.entryAt(plan.displayRowOf(2)).kind).toBe('commit'); // tip
    expect(plan.entryAt(plan.displayRowOf(6)).kind).toBe('commit'); // oldest

    const placeholderDisplayRow = plan.containingDisplayRow(4);
    const placeholder = plan.entryAt(placeholderDisplayRow);
    expect(placeholder.kind).toBe('collapsed');
    expect(placeholder.hiddenCount).toBe(3);
    expect(placeholder.storeRow).toBe(3); // the first hidden row

    for (const row of [3, 4, 5]) {
      expect(plan.displayRowOf(row)).toBe(-1); // hidden — no display row of its own
      expect(plan.containingDisplayRow(row)).toBe(placeholderDisplayRow);
    }
  });

  test('a group of exactly MIN_COLLAPSIBLE members never collapses', () => {
    // `feature` (tip row 1) chains 1 -> 2 -> 3 -> 4 (row 4 the shared root, claimed by `main`) —
    // exactly 3 own members.
    const store = new CommitStore();
    store.appendPage([
      commit(0, [4]),
      commit(1, [2]),
      commit(2, [3]),
      commit(3, [4]),
      commit(4, []),
    ]);
    const plan = buildRowPlan(store, [tip(0, 'main'), tip(1, 'feature')], {
      ...noOptions,
      collapseEnabled: true,
    });
    expect(plan.length).toBe(store.rowCount);
    for (let d = 0; d < plan.length; d++) expect(plan.entryAt(d).kind).toBe('commit');
  });

  test('group 0 never collapses, however many members it has', () => {
    const store = new CommitStore();
    store.appendPage([
      commit(0, [1]),
      commit(1, [2]),
      commit(2, [3]),
      commit(3, [4]),
      commit(4, []),
    ]);
    const plan = buildRowPlan(store, [tip(0, 'main')], { ...noOptions, collapseEnabled: true });
    expect(plan.length).toBe(store.rowCount);
    for (let d = 0; d < plan.length; d++) expect(plan.entryAt(d).kind).toBe('commit');
  });

  test('a key in the expanded set renders its group in full', () => {
    const store = new CommitStore();
    store.appendPage(records());
    const plan = buildRowPlan(store, tips(), {
      expandedKeys: new Set(['feature']),
      collapseEnabled: true,
      revision: 1,
    });
    expect(plan.length).toBe(store.rowCount);
    for (let d = 0; d < plan.length; d++) expect(plan.entryAt(d).kind).toBe('commit');
  });

  test('expanding one group restores its rows in order and leaves the other group alone', () => {
    const store = new CommitStore();
    store.appendPage(records());
    const collapsed = buildRowPlan(store, tips(), { ...noOptions, collapseEnabled: true });
    const expanded = buildRowPlan(store, tips(), {
      expandedKeys: new Set(['feature']),
      collapseEnabled: true,
      revision: 2,
    });

    expect(expanded.length).toBe(store.rowCount);
    const featureDisplayRows = [2, 3, 4, 5, 6].map((row) => expanded.displayRowOf(row));
    expect(featureDisplayRows).toEqual([...featureDisplayRows].sort((a, b) => a - b));
    for (const row of [2, 3, 4, 5, 6]) {
      expect(expanded.entryAt(expanded.displayRowOf(row)).kind).toBe('commit');
    }
    for (const row of [0, 1, 7]) {
      expect(collapsed.entryAt(collapsed.displayRowOf(row)).groupIndex).toBe(0);
      expect(expanded.entryAt(expanded.displayRowOf(row)).groupIndex).toBe(0);
    }
  });

  test('a placeholder projects no internal link, no duplicate, and nothing pointing earlier', () => {
    const store = new CommitStore();
    store.appendPage(records());
    const plan = buildRowPlan(store, tips(), { ...noOptions, collapseEnabled: true });
    const input = projectLayoutInput(plan, store.layoutInput(0, store.rowCount));

    const placeholderDisplayRow = plan.containingDisplayRow(4);
    const start = input.parentOffsets[placeholderDisplayRow];
    const end = input.parentOffsets[placeholderDisplayRow + 1];
    const targets = Array.from(input.parentRows.subarray(start, end));

    for (const target of targets) expect(target).toBeGreaterThan(placeholderDisplayRow);
    expect(new Set(targets).size).toBe(targets.length);
    // Exactly one kept link: down to the oldest row (6), the placeholder's only non-internal,
    // non-upward parent target.
    expect(targets).toEqual([plan.displayRowOf(6)]);
  });
});

describe('projectLayoutInput', () => {
  /** `main` (tip row 0): 0 -> 1 -> 7 (row 7 the shared root). `feature` (tip row 2): 2 -> 3 -> 4
   *  -> 5 -> 6 -> 7 — row 6, feature's own oldest, forks off row 7, which display-order places
   *  *earlier* (group 0 beats group 1) — the one upward link in this fixture, at row 6. */
  function records() {
    return [
      commit(0, [1]),
      commit(1, [7]),
      commit(2, [3]),
      commit(3, [4]),
      commit(4, [5]),
      commit(5, [6]),
      commit(6, [7]),
      commit(7, []),
    ];
  }
  function tips(): TipRef[] {
    return [tip(0, 'main'), tip(2, 'feature', 'feature/x')];
  }

  test('every projected link points strictly down, and the fork row reports its target', () => {
    const store = new CommitStore();
    store.appendPage(records());
    const plan = buildRowPlan(store, tips(), noOptions);
    const input = projectLayoutInput(plan, store.layoutInput(0, store.rowCount));

    expect(input.from).toBe(0);
    expect(input.to).toBe(plan.length);
    for (let d = 0; d < plan.length; d++) {
      const start = input.parentOffsets[d];
      const end = input.parentOffsets[d + 1];
      for (let slot = start; slot < end; slot++) {
        expect(input.parentRows[slot]).toBeGreaterThan(d);
      }
    }
    // Row 6's parent (row 7) lands in the higher-priority group, earlier in display order —
    // dropped from the CSR and surfaced as this row's fork stub instead.
    const forkDisplayRow = plan.displayRowOf(6);
    const targetDisplayRow = plan.displayRowOf(7);
    expect(plan.forkParentOf(forkDisplayRow)).toBe(targetDisplayRow);
    const start = input.parentOffsets[forkDisplayRow];
    const end = input.parentOffsets[forkDisplayRow + 1];
    expect(Array.from(input.parentRows.subarray(start, end))).not.toContain(targetDisplayRow);
  });

  test('the identity plan projects every link unchanged (downward only)', () => {
    const store = new CommitStore();
    store.appendPage(records());
    const base = store.layoutInput(0, store.rowCount);
    const plan = identityRowPlan(store.rowCount);
    const input = projectLayoutInput(plan, base);

    expect(Array.from(input.parentOffsets)).toEqual(Array.from(base.parentOffsets));
    expect(Array.from(input.parentRows)).toEqual(Array.from(base.parentRows));
    for (let d = 0; d < plan.length; d++) expect(plan.forkParentOf(d)).toBe(-1);
  });
});
