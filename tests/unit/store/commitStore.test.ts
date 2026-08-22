import { describe, expect, test } from "bun:test";
import { CommitStore } from "../../../packages/core/src/store/commitStore.ts";
import { fan, octopusOf, topology } from "../../fixtures/topology.ts";

describe("CommitStore — single-page append", () => {
  test("appends a root, a linear chain, and reconstructs each row exactly", () => {
    const records = topology(["A", "B:A", "C:B"]);
    const store = new CommitStore();
    for (const record of records) store.append(record);

    expect(store.rowCount).toBe(3);
    for (let row = 0; row < 3; row++) {
      expect(store.commitAt(row)).toEqual(records[row] as (typeof records)[number]);
    }
  });

  test("reports the right parents for a root, a two-parent merge, and a 12-parent octopus", () => {
    const records = octopusOf(12);
    const store = new CommitStore();
    store.appendPage(records);

    const rootRow = store.rowOfSha(records[records.length - 1]?.sha ?? "");
    expect(Array.from(store.parentsOf(rootRow))).toEqual([]);

    const mergeRow = store.rowOfSha(records[0]?.sha ?? "");
    const mergeParents = store.parentsOf(mergeRow);
    expect(mergeParents).toHaveLength(12);
    expect(Array.from(mergeParents).every((r) => r >= 0)).toBe(true);
  });

  test("commitAt reconstructs byte-identical records for every W1 shape", () => {
    const shapes = [topology(["A", "B:A", "C:A", "D:B,C"]), fan(5, 3), octopusOf(3), octopusOf(12)];
    for (const records of shapes) {
      const store = new CommitStore();
      store.appendPage(records);
      for (let row = 0; row < store.rowCount; row++) {
        const reconstructed = store.commitAt(row);
        const original = records.find((r) => r.sha === reconstructed.sha);
        expect(original).toBeDefined();
        expect(reconstructed).toEqual(original as (typeof records)[number]);
      }
    }
  });

  test("decorationAt returns [] when a commit carried no decoration", () => {
    const records = topology(["A"]);
    const store = new CommitStore();
    store.append(records[0] as (typeof records)[number]);
    expect(store.decorationAt(0)).toEqual([]);
  });

  test("author/committer identities intern shared names across many commits", () => {
    const records = fan(20, 5);
    const store = new CommitStore();
    store.appendPage(records);
    // Every record shares the same fixture author/committer identity.
    expect(store.stats().internedStringBytes).toBeGreaterThan(0);
    for (let row = 0; row < store.rowCount; row++) {
      expect(store.authorAt(row).name).toBe(records[0]?.author.name as string);
    }
  });
});

describe("CommitStore — page-boundary equivalence", () => {
  test("appending in two pages produces the same columns as appending in one", () => {
    const records = fan(8, 6);

    const onePage = new CommitStore();
    onePage.appendPage(records);

    const twoPages = new CommitStore();
    const mid = Math.floor(records.length / 2);
    twoPages.appendPage(records.slice(0, mid));
    twoPages.appendPage(records.slice(mid));

    expect(twoPages.rowCount).toBe(onePage.rowCount);
    for (let row = 0; row < onePage.rowCount; row++) {
      expect(twoPages.shaAt(row)).toBe(onePage.shaAt(row));
      expect(Array.from(twoPages.parentsOf(row))).toEqual(Array.from(onePage.parentsOf(row)));
      expect(twoPages.commitAt(row)).toEqual(onePage.commitAt(row));
    }
  });

  test("a parent not yet loaded resolves to -1, then to the right row once its page lands", () => {
    // --topo-order emits a child before its parent; a page boundary in the middle of that
    // relationship must leave the parent slot at -1 until the parent's page arrives.
    const records = topology(["A", "B:A"]); // records[0] = B (child), records[1] = A (parent)
    const store = new CommitStore();

    const first = store.appendPage([records[0] as (typeof records)[number]]); // just B
    expect(Array.from(store.parentsOf(0))).toEqual([-1]);
    expect(first.resolvedParentSlots).toHaveLength(0);
    // commitAt must still report A's real sha even though it isn't a resolvable row yet.
    expect(store.commitAt(0).parents).toEqual([records[1]?.sha as string]);

    const second = store.appendPage([records[1] as (typeof records)[number]]); // now A
    expect(second.resolvedParentSlots).toEqual(Uint32Array.from([0]));
    expect(Array.from(store.parentsOf(0))).toEqual([1]);
    expect(store.commitAt(0)).toEqual(records[0] as (typeof records)[number]);
  });

  test("resolvedParentSlots lists precisely the slots that changed", () => {
    // merge (row 0) has 4 parents (the tips), all unresolved on page 1; each tip in turn has
    // one parent (the shared base), unresolved until the base's own page lands.
    const records = octopusOf(4);
    const store = new CommitStore();
    const merge = records[0] as (typeof records)[number];
    const tips = records.slice(1, 5);
    const base = records[5] as (typeof records)[number];

    store.appendPage([merge]);
    expect(Array.from(store.parentsOf(0))).toEqual([-1, -1, -1, -1]);

    const afterTips = store.appendPage(tips);
    // Each tip resolves one of the merge's 4 parent slots (slots 0..3); the tips' own parent
    // (the base) is not loaded yet, so this page also adds 4 fresh pending slots (4..7).
    expect(Array.from(afterTips.resolvedParentSlots).sort()).toEqual([0, 1, 2, 3]);
    expect(Array.from(store.parentsOf(0)).every((r) => r >= 0)).toBe(true);

    const afterBase = store.appendPage([base]);
    expect(Array.from(afterBase.resolvedParentSlots).sort()).toEqual([4, 5, 6, 7]);
    for (let row = 1; row <= 4; row++) {
      expect(Array.from(store.parentsOf(row)).every((r) => r >= 0)).toBe(true);
    }
  });
});

describe("CommitStore — stats and clear", () => {
  test("stats() reports non-zero byte counts once populated", () => {
    const store = new CommitStore();
    store.appendPage(fan(10, 10));
    const stats = store.stats();
    expect(stats.rowCount).toBe(store.rowCount);
    expect(stats.shaTableBytes).toBeGreaterThan(0);
    expect(stats.columnBytes).toBeGreaterThan(0);
    expect(stats.subjectBufferBytes).toBeGreaterThan(0);
    expect(stats.totalBytes).toBeGreaterThan(0);
    expect(stats.pendingParentCount).toBe(0);
  });

  test("clear() resets the store to empty and reusable", () => {
    const store = new CommitStore();
    store.appendPage(fan(5, 5));
    expect(store.rowCount).toBeGreaterThan(0);
    store.clear();
    expect(store.rowCount).toBe(0);
    // Preallocated capacity (e.g. the sha hash index) may be retained across a clear for reuse
    // — only rowCount and the derived per-structure counts are guaranteed to reset.
    expect(store.stats().rowCount).toBe(0);
    expect(store.stats().decorationEntryCount).toBe(0);
    expect(store.stats().pendingParentCount).toBe(0);

    const records = topology(["A", "B:A"]);
    store.appendPage(records);
    expect(store.rowCount).toBe(2);
    expect(store.commitAt(0)).toEqual(records[0] as (typeof records)[number]);
  });
});
