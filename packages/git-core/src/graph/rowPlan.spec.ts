import { describe, expect, test } from 'bun:test';
import { CommitStore } from '../store/commitStore.ts';
import { buildRowPlan, identityRowPlan, projectLayoutInput, type TipRef } from './rowPlan.ts';

/**
 * `rowPlan.ts` clears `CLAUDE.md`'s unit-test bar on its own — priority propagation and
 * per-run contraction interact, index math (display-vs-store) has real boundaries, contraction
 * has several interacting rules of its own, and "final on arrival" is an
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

  test('display order is store order here and deterministic across rebuilds', () => {
    const store = new CommitStore();
    store.appendPage(records());
    const planA = buildRowPlan(store, tips(), noOptions);
    const planB = buildRowPlan(store, tips(), { ...noOptions, revision: 2 });
    const orderA = Array.from({ length: planA.length }, (_, d) => planA.storeRowAt(d));
    const orderB = Array.from({ length: planB.length }, (_, d) => planB.storeRowAt(d));
    expect(orderA).toEqual(orderB);
    // No interleaving siblings: groups do not reorder anything.
    expect(orderA).toEqual([0, 1, 2, 3]);
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
   *  claims rows 2, 3, 4, 5, 6 — 5 members, collapsing to tip (2) and a placeholder hiding 3/4/5/6. */
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

  test('a group of more than MIN_COLLAPSIBLE members collapses to tip then placeholder', () => {
    const store = new CommitStore();
    store.appendPage(records());
    const plan = buildRowPlan(store, tips(), { ...noOptions, collapseEnabled: true });

    expect(plan.length).toBe(5); // group 0's 3 rows + group 1's tip/placeholder
    expect(plan.entryAt(plan.displayRowOf(2)).kind).toBe('commit'); // tip

    const placeholderDisplayRow = plan.containingDisplayRow(4);
    const placeholder = plan.entryAt(placeholderDisplayRow);
    expect(placeholder.kind).toBe('collapsed');
    expect(placeholder.hiddenCount).toBe(4);
    expect(placeholder.storeRow).toBe(3); // the first hidden row

    for (const row of [3, 4, 5, 6]) {
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
    // Exactly one kept link: down to the root (7), the placeholder's only non-internal,
    // non-upward parent target.
    expect(targets).toEqual([plan.displayRowOf(7)]);
  });
});

describe('buildRowPlan — collapse per run', () => {
  /** `main` M0 ... M1 R; branch B's rows come in two runs of `r1` and `r2` rows, separated by
   *  3-row runs of branch C (forking from a different commit, so B and C never regroup). Display
   *  order equals store order. */
  function interleaved(r1: number, r2: number) {
    const kinds = [
      'M0',
      ...Array<string>(r1).fill('B'),
      ...Array<string>(3).fill('C'),
      ...Array<string>(r2).fill('B'),
      ...Array<string>(3).fill('C'),
      'M1',
      'R',
    ];
    const m1 = kinds.length - 2;
    const root = kinds.length - 1;
    const records = kinds.map((kind, i) => {
      if (kind === 'M0') return commit(i, [m1]);
      if (kind === 'M1') return commit(i, [root]);
      if (kind === 'R') return commit(i, []);
      const next = kinds.indexOf(kind, i + 1);
      return commit(i, [next >= 0 ? next : kind === 'B' ? root : m1]);
    });
    const tips = [tip(0, 'main'), tip(1, 'b'), tip(1 + r1, 'c')];
    return { records, tips };
  }
  const collapseOn = { expandedKeys: new Set<string>(), collapseEnabled: true, revision: 1 };
  const kindsOf = (plan: ReturnType<typeof buildRowPlan>) =>
    Array.from({ length: plan.length }, (_, d) => plan.entryAt(d).kind);

  test('two separate runs of one group each contract on their own', () => {
    const { records, tips } = interleaved(4, 4);
    const store = new CommitStore();
    store.appendPage(records);
    const plan = buildRowPlan(store, tips, collapseOn);

    // M0, [b tip, placeholder], C x3, [b tip, placeholder], C x3, M1, R
    expect(plan.length).toBe(1 + 2 + 3 + 2 + 3 + 2);
    const placeholders = kindsOf(plan).filter((k) => k === 'collapsed');
    expect(placeholders).toHaveLength(2);
    for (let d = 0; d < plan.length; d++) {
      const entry = plan.entryAt(d);
      if (entry.kind === 'collapsed') {
        expect(entry.hiddenCount).toBe(3);
        expect(plan.groupKeyAt(d)).toBe('b');
      }
    }
  });

  test('a run of exactly MIN_COLLAPSIBLE stays full while its sibling run collapses', () => {
    const { records, tips } = interleaved(3, 4);
    const store = new CommitStore();
    store.appendPage(records);
    const plan = buildRowPlan(store, tips, collapseOn);
    expect(kindsOf(plan).filter((k) => k === 'collapsed')).toHaveLength(1);
    expect(plan.length).toBe(store.rowCount - 2);
  });

  test('expanding the key expands every run of the group', () => {
    const { records, tips } = interleaved(4, 4);
    const store = new CommitStore();
    store.appendPage(records);
    const plan = buildRowPlan(store, tips, { ...collapseOn, expandedKeys: new Set(['b']) });
    expect(kindsOf(plan)).not.toContain('collapsed');
    expect(plan.length).toBe(store.rowCount);
  });

  test('a collapsed plan projects only downward links', () => {
    const { records, tips } = interleaved(4, 4);
    const store = new CommitStore();
    store.appendPage(records);
    const plan = buildRowPlan(store, tips, collapseOn);
    const input = projectLayoutInput(plan, store.layoutInput(0, store.rowCount));
    for (let d = 0; d < plan.length; d++) {
      for (let slot = input.parentOffsets[d]; slot < input.parentOffsets[d + 1]; slot++) {
        expect(input.parentRows[slot]).toBeGreaterThan(d);
      }
    }
  });
});

describe('projectLayoutInput', () => {
  /** `main` (tip row 0): 0 -> 1 -> 7 (row 7 the shared root). `feature` (tip row 2): 2 -> 3 -> 4
   *  -> 5 -> 6 -> 7. */
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

  test('every projected link points strictly down, fork edge included', () => {
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
    // Row 6 forks off row 7: an ordinary downward link.
    const forkDisplayRow = plan.displayRowOf(6);
    const start = input.parentOffsets[forkDisplayRow];
    const end = input.parentOffsets[forkDisplayRow + 1];
    expect(Array.from(input.parentRows.subarray(start, end))).toEqual([plan.displayRowOf(7)]);
  });

  test('the identity plan projects every link unchanged (downward only)', () => {
    const store = new CommitStore();
    store.appendPage(records());
    const base = store.layoutInput(0, store.rowCount);
    const plan = identityRowPlan(store.rowCount);
    const input = projectLayoutInput(plan, base);

    expect(Array.from(input.parentOffsets)).toEqual(Array.from(base.parentOffsets));
    expect(Array.from(input.parentRows)).toEqual(Array.from(base.parentRows));
  });
});

describe('displayRowOf — P108 F1 (range-tolerant, not an assert)', () => {
  function records() {
    return [commit(0, [1]), commit(1, [])];
  }
  function tips(): TipRef[] {
    return [tip(0, 'main')];
  }

  test('a store row beyond storeLength returns -1 instead of throwing (identityRowPlan(0))', () => {
    // The exact plan a fresh mount holds before its first chunk lands (`GraphViewState`'s own
    // initial `shallowRef(identityRowPlan(0))`) — a persisted scroll position (even row 0) used
    // to assert here.
    const plan = identityRowPlan(0);
    expect(plan.storeLength).toBe(0);
    expect(() => plan.displayRowOf(0)).not.toThrow();
    expect(plan.displayRowOf(0)).toBe(-1);
  });

  test('a store row beyond storeLength returns -1 instead of throwing (buildRowPlan)', () => {
    const store = new CommitStore();
    store.appendPage(records());
    const plan = buildRowPlan(store, tips(), noOptions);
    expect(plan.storeLength).toBe(2);
    expect(() => plan.displayRowOf(5)).not.toThrow();
    expect(plan.displayRowOf(5)).toBe(-1);
    expect(plan.displayRowOf(-1)).toBe(-1);
    // Every row this plan actually covers still resolves normally.
    expect(plan.displayRowOf(0)).toBeGreaterThanOrEqual(0);
    expect(plan.displayRowOf(1)).toBeGreaterThanOrEqual(0);
  });
});
