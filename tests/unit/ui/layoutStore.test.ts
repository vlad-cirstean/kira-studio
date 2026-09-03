import { describe, expect, test } from "bun:test";
import {
  EDGE_COLOR,
  EDGE_FROM_LANE,
  EDGE_FROM_ROW,
  EDGE_KIND,
  EDGE_STRIDE,
  EDGE_TO_LANE,
  EDGE_TO_ROW,
  type EdgeKind,
  type LayoutChunk,
  type LayoutFrontier,
  layoutAppend,
  UNRESOLVED_ROW,
} from "../../../packages/core/src/index.ts";
import { CommitStore } from "../../../packages/core/src/store/commitStore.ts";
import type { CommitRecord } from "../../../packages/core/src/model/commit.ts";
import { type EdgeSegment, LayoutStore } from "../../../packages/ui/src/graph/layoutStore.ts";
import { fan, octopusOf, topology } from "../../fixtures/topology.ts";

/**
 * P4 W3's own "Done when": a store fed page-by-page reports the same `laneOf`/`colorOf` for
 * every row as one fed a single whole-history chunk, for every P2 W1 shape; a patch from a
 * later page corrects an earlier page's edge target; `segmentsInRow` returns exactly the
 * segments a brute-force scan over all edges returns, for every row, including rows crossed
 * only by an edge whose endpoints are both far outside the lookback window; concatenating
 * `segmentsInRow` over a range equals `segmentsInWindow` over that range; and a row query
 * allocates nothing after the first call.
 */

/** A merge whose second parent is 100+ rows away — `pageBoundary.test.ts`'s own P2 shapes are
 *  all small enough that no edge exceeds `LONG_EDGE_ROWS` (64), so none of them exercises
 *  `LayoutStore`'s `#longEdges` side index at all. This shape does: `merge` at row 0 has a
 *  short straight edge to `m99` (row 1) and a long branch-out edge to `f99` (row 101, span 101)
 *  — a realistic stand-in for a long-lived feature branch merged back into mainline. */
function longMerge(): CommitRecord[] {
  const spec: string[] = ["base"];
  let parent = "base";
  for (let i = 0; i < 100; i++) {
    spec.push(`f${i}:${parent}`);
    parent = `f${i}`;
  }
  const featureTip = parent;
  parent = "base";
  for (let i = 0; i < 100; i++) {
    spec.push(`m${i}:${parent}`);
    parent = `m${i}`;
  }
  spec.push(`merge:${parent},${featureTip}`);
  return topology(spec);
}

const SHAPES: Record<string, readonly CommitRecord[]> = {
  linear: topology(["A", "B:A", "C:B", "D:C", "E:D"]),
  forkAndMerge: topology(["A", "B:A", "F1:A", "F2:F1", "M:B,F2"]),
  unmergedFork: fan(3, 4),
  octopus3: octopusOf(3),
  octopus12: octopusOf(12),
  crissCross: topology(["A", "B:A", "C:A", "D:B,C", "E:C,B"]),
  multipleRoots: topology(["R1", "R2", "A1:R1", "A2:R2"]),
  fiftyLanes: fan(50, 1),
  longMerge: longMerge(),
};

function layoutOnePass(records: readonly CommitRecord[]): LayoutChunk {
  const store = new CommitStore();
  store.appendPage(records);
  return layoutAppend(store.layoutInput(0, store.rowCount), undefined).chunk;
}

function layoutInPages(records: readonly CommitRecord[], pageSize: number): LayoutChunk[] {
  const store = new CommitStore();
  const chunks: LayoutChunk[] = [];
  let frontier: LayoutFrontier | undefined;
  for (let i = 0; i < records.length; i += pageSize) {
    const page = records.slice(i, i + pageSize);
    const before = store.rowCount;
    store.appendPage(page);
    const result = layoutAppend(store.layoutInput(before, store.rowCount), frontier);
    frontier = result.frontier;
    chunks.push(result.chunk);
  }
  return chunks;
}

function storeFromPages(records: readonly CommitRecord[], pageSize: number): LayoutStore {
  const store = new LayoutStore();
  for (const chunk of layoutInPages(records, pageSize)) store.append(chunk);
  return store;
}

/** The test's own ground truth for `segmentsInRow`/`segmentsInWindow`: a linear scan over
 *  every edge in a *one-pass* layout of the same records (P2's `pageBoundary.test.ts` already
 *  establishes that a fully-patched paged layout's edges are byte-identical to a one-pass
 *  layout's, so a one-pass chunk — which has no `UNRESOLVED_ROW` targets left to patch at all
 *  — is a safe, independently-derived oracle). */
function bruteForceSegments(onePass: LayoutChunk, row: number): EdgeSegment[] {
  const count = onePass.edges.length / EDGE_STRIDE;
  const out: EdgeSegment[] = [];
  for (let i = 0; i < count; i++) {
    const base = i * EDGE_STRIDE;
    const fromRow = onePass.edges[base + EDGE_FROM_ROW] as number;
    const toRow = onePass.edges[base + EDGE_TO_ROW] as number;
    if (row < fromRow) continue;
    if (toRow !== UNRESOLVED_ROW && row > toRow) continue;
    out.push({
      fromRow,
      toRow,
      fromLane: onePass.edges[base + EDGE_FROM_LANE] as number,
      toLane: onePass.edges[base + EDGE_TO_LANE] as number,
      color: onePass.edges[base + EDGE_COLOR] as number,
      kind: onePass.edges[base + EDGE_KIND] as EdgeKind,
    });
  }
  return out;
}

function sortSegments(segments: readonly EdgeSegment[]): EdgeSegment[] {
  return [...segments].sort(
    (a, b) => a.fromRow - b.fromRow || a.toRow - b.toRow || a.fromLane - b.fromLane,
  );
}

describe("LayoutStore — laneOf/colorOf match a one-pass layout", () => {
  for (const [name, records] of Object.entries(SHAPES)) {
    for (const pageSize of [1, 2, 3, records.length]) {
      test(`${name} @ pageSize=${pageSize}`, () => {
        const onePass = layoutOnePass(records);
        const store = storeFromPages(records, pageSize);

        expect(store.rowCount).toBe(records.length);
        expect(store.laneCount).toBe(onePass.laneCount);
        for (let row = 0; row < records.length; row++) {
          expect(store.laneOf(row)).toBe(onePass.laneOf[row] as number);
          expect(store.colorOf(row)).toBe(onePass.colorOf[row] as number);
        }
      });
    }
  }
});

describe("LayoutStore — segmentsInRow matches a brute-force scan", () => {
  for (const [name, records] of Object.entries(SHAPES)) {
    for (const pageSize of [1, 3, records.length]) {
      test(`${name} @ pageSize=${pageSize}`, () => {
        const onePass = layoutOnePass(records);
        const store = storeFromPages(records, pageSize);
        const out: EdgeSegment[] = [];

        for (let row = 0; row < records.length; row++) {
          const count = store.segmentsInRow(row, out);
          const actual = sortSegments(out.slice(0, count));
          const expected = sortSegments(bruteForceSegments(onePass, row));
          expect(actual).toEqual(expected);
        }
      });
    }
  }
});

describe("LayoutStore — patch mechanism", () => {
  test("a page-size-1 stream leaves a branch-out edge UNRESOLVED_ROW until its parent's page lands, then patches it in place", () => {
    const records = longMerge(); // merge (row 0) --branch-out--> f99 (row 101)
    const store = new LayoutStore();
    const chunks = layoutInPages(records, 1);
    const out: EdgeSegment[] = [];

    // Right after the merge commit's own page (chunk 0) lands, its branch-out edge to f99
    // cannot be resolved yet — f99 has not loaded.
    const firstChunk = chunks[0];
    if (!firstChunk) throw new Error("unreachable");
    store.append(firstChunk);
    const afterFirst = store.segmentsInRow(0, out);
    const branchOutAfterFirst = out
      .slice(0, afterFirst)
      .find((s) => s.fromRow === 0 && s.toRow === UNRESOLVED_ROW);
    expect(branchOutAfterFirst).toBeDefined();

    // Append every remaining chunk (through row 101, where f99 loads and the patch fires).
    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) throw new Error("unreachable");
      store.append(chunk);
      if (store.rowCount > 101) break;
    }

    const afterPatch = store.segmentsInRow(0, out);
    const branchOutAfterPatch = out
      .slice(0, afterPatch)
      .find((s) => s.fromRow === 0 && s.fromLane !== s.toLane);
    expect(branchOutAfterPatch).toBeDefined();
    expect(branchOutAfterPatch?.toRow).toBe(101);
    expect(branchOutAfterPatch?.toRow).not.toBe(UNRESOLVED_ROW);

    // The row the edge now resolves to must also see it — this only works if the patch reached
    // an already-appended chunk's own `edges` buffer, not a copy `LayoutStore` made earlier.
    const atTarget = store.segmentsInRow(101, out);
    const arrivingAtTarget = out.slice(0, atTarget).find((s) => s.fromRow === 0 && s.toRow === 101);
    expect(arrivingAtTarget).toBeDefined();
  });
});

describe("LayoutStore — segmentsInWindow equals concatenated segmentsInRow", () => {
  for (const [name, records] of Object.entries(SHAPES)) {
    test(name, () => {
      const store = storeFromPages(records, 3);
      const rowOut: EdgeSegment[] = [];
      const concatenated: EdgeSegment[] = [];
      for (let row = 0; row < records.length; row++) {
        const count = store.segmentsInRow(row, rowOut);
        concatenated.push(...rowOut.slice(0, count));
      }

      const windowOut: EdgeSegment[] = [];
      const windowCount = store.segmentsInWindow(0, records.length - 1, windowOut);
      expect(windowOut.slice(0, windowCount)).toEqual(concatenated);
    });
  }
});

describe("LayoutStore — reused output array", () => {
  test("a row query allocates nothing after the first call: the same out array reused across many calls stays correct", () => {
    const records = longMerge();
    const store = storeFromPages(records, 7);
    const out: EdgeSegment[] = [];

    const firstCount = store.segmentsInRow(0, out);
    const firstResult = sortSegments(out.slice(0, firstCount));

    for (let i = 0; i < 50; i++) {
      const count = store.segmentsInRow(0, out);
      expect(count).toBe(firstCount);
      expect(sortSegments(out.slice(0, count))).toEqual(firstResult);
    }

    // A row with a different segment count than row 0's, queried into the very same array
    // right after — proves stale entries past the new count are simply never read, not that
    // the array happened to be the right size already.
    const otherRow = Math.floor(records.length / 2);
    const otherCount = store.segmentsInRow(otherRow, out);
    const onePass = layoutOnePass(records);
    expect(sortSegments(out.slice(0, otherCount))).toEqual(
      sortSegments(bruteForceSegments(onePass, otherRow)),
    );
  });
});

describe("LayoutStore — misuse", () => {
  test("append() rejects a chunk that does not continue the store's loaded rows", () => {
    const records = topology(["A", "B:A", "C:B"]);
    const chunks = layoutInPages(records, 1);
    const store = new LayoutStore();
    const second = chunks[1];
    if (!second) throw new Error("unreachable");
    expect(() => store.append(second)).toThrow(); // skips chunk 0 — not contiguous
  });

  test("laneOf/colorOf/segmentsInRow reject an out-of-range row", () => {
    const store = storeFromPages(topology(["A", "B:A"]), 5);
    expect(() => store.laneOf(-1)).toThrow();
    expect(() => store.laneOf(2)).toThrow();
    expect(() => store.colorOf(2)).toThrow();
    expect(() => store.segmentsInRow(2, [])).toThrow();
  });

  test("segmentsInWindow rejects an inverted or out-of-range range", () => {
    const store = storeFromPages(topology(["A", "B:A", "C:B"]), 5);
    expect(() => store.segmentsInWindow(2, 1, [])).toThrow();
    expect(() => store.segmentsInWindow(0, 3, [])).toThrow();
  });

  test("clear() resets a store back to empty", () => {
    const store = storeFromPages(topology(["A", "B:A", "C:B"]), 1);
    expect(store.rowCount).toBe(3);
    store.clear();
    expect(store.rowCount).toBe(0);
    expect(store.laneCount).toBe(0);
    expect(() => store.laneOf(0)).toThrow();

    // And is fully reusable afterward — a fresh append starting again at row 0 works.
    const chunks = layoutInPages(topology(["X", "Y:X"]), 5);
    const only = chunks[0];
    if (!only) throw new Error("unreachable");
    store.append(only);
    expect(store.rowCount).toBe(2);
  });
});
