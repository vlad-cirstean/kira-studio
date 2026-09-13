import { describe, expect, test } from 'bun:test';
import {
  EDGE_STRIDE,
  type LayoutChunk,
  PATCH_STRIDE,
  PATCH_UNCHANGED,
  UNRESOLVED_ROW,
} from '@kira/git-core';
import { type EdgeSegment, LayoutStore } from './layoutStore.ts';

/** Builds a hand-crafted `LayoutChunk` — no real `layoutAppend()` pass, since this module's own
 *  doc comment frames `LayoutStore` as "unit-testable in bun test without a browser" independent
 *  of the layout algorithm that produces real chunks. `edges` is a flat list of
 *  `[fromRow, toRow, fromLane, toLane, color, kind]` tuples, already sorted by fromRow (the
 *  store's own invariant) since every edge here starts at `from`. `edgeIndex`'s CSR form follows
 *  mechanically: every row before `from + 1` (i.e. row `from` itself) contributes 0 edges to the
 *  running total, and the total from row `from + 1` onward is simply "all of them" (none of this
 *  test's edges start anywhere but row `from`). */
function buildChunk(
  from: number,
  to: number,
  edges: ReadonlyArray<readonly [number, number, number, number, number, number]>,
  laneCount = 2,
): LayoutChunk {
  const rowCount = to - from;
  const edgeData = new Uint32Array(edges.length * EDGE_STRIDE);
  for (const [i, edge] of edges.entries()) {
    edgeData.set(edge, i * EDGE_STRIDE);
  }
  const edgeIndex = new Uint32Array(rowCount + 1);
  for (let r = 1; r <= rowCount; r++) edgeIndex[r] = edges.length; // every edge starts at row `from`.
  return {
    from,
    to,
    laneOf: new Uint32Array(rowCount),
    colorOf: new Uint32Array(rowCount),
    edges: edgeData,
    edgeIndex,
    patches: new Uint32Array(0),
    laneCount,
    maxEdgeSpan: 0,
    transfer: [],
  };
}

function buildPatchChunk(
  from: number,
  to: number,
  patches: ReadonlyArray<readonly [number, number, number, number]>,
): LayoutChunk {
  const rowCount = to - from;
  const patchData = new Uint32Array(patches.length * PATCH_STRIDE);
  for (const [i, patch] of patches.entries()) {
    patchData.set(patch, i * PATCH_STRIDE);
  }
  return {
    from,
    to,
    laneOf: new Uint32Array(rowCount),
    colorOf: new Uint32Array(rowCount),
    edges: new Uint32Array(0),
    edgeIndex: new Uint32Array(rowCount + 1),
    patches: patchData,
    laneCount: 2,
    maxEdgeSpan: 0,
    transfer: [],
  };
}

// G30 round-1 performance review, finding #3: `#collectLongSegments` used to build a full
// `EdgeSegment` object (`readSegment`) for every candidate in `#longEdges` before checking
// whether it actually covers the queried row — an edge that closed long ago (its own `toRow`
// PATCHED to a real, short value well before the query row) is never removed from `#longEdges`
// (append-only, "long" membership is decided once at append time and frozen — see
// `isLongAtAppendTime`'s own doc comment), so it stayed a candidate, and its allocation, for
// every later row query for the rest of the store's life. The fix reads `toRow` directly out of
// the chunk's typed array and skips before allocating anything for a miss. This is a pure
// correctness-preserving optimization — this suite exists to prove exactly that: the observable
// result of `segmentsInRow` must be identical to what `coversRow`'s own literal definition would
// produce, for both a since-closed long edge and a genuinely still-open one.
describe('LayoutStore — long-edge segment collection stays correct after a patch closes one early', () => {
  test('a long edge closed by a later patch is excluded past its own toRow, but still included at/before it', () => {
    const store = new LayoutStore();

    // Chunk 0 (rows 0-2): two edges, BOTH unresolved at append time — both classified "long" and
    // added to #longEdges, regardless of what they eventually resolve to.
    const chunk0 = buildChunk(0, 3, [
      // edge0: will be patched to toRow=1 by chunk1 below — a long-at-append-time edge that
      // turns out to have closed almost immediately.
      [0, UNRESOLVED_ROW, 0, 0, 1, 0],
      // edge1: never patched — genuinely still open for the rest of the store's life (an edge to
      // a parent outside the loaded range).
      [0, UNRESOLVED_ROW, 1, 1, 2, 0],
    ]);
    store.append(chunk0);

    // Chunk 1 (rows 3-11): no edges of its own, but patches chunk0's edge0 (global index 0) to
    // toRow=1 — applied to chunk0's own live `edges` buffer before chunk1 is registered.
    const chunk1 = buildPatchChunk(3, 12, [[0, 1, PATCH_UNCHANGED, PATCH_UNCHANGED]]);
    store.append(chunk1);

    expect(store.rowCount).toBe(12);

    const out: EdgeSegment[] = [];

    // Row 11: deep into chunk1, long past edge0's own patched toRow=1. Only edge1 (still open)
    // should render — edge0 must be excluded, not merely "not crash".
    const countAt11 = store.segmentsInRow(11, out);
    expect(countAt11).toBe(1);
    expect(out[0]?.color).toBe(2); // edge1's own marker color — edge0 (color 1) must be absent.
    expect(out[0]?.toRow).toBe(UNRESOLVED_ROW);

    // Row 1: edge0's own toRow — inclusive (coversRow's own contract: "inclusive of both fromRow
    // and toRow"), so BOTH edges must render here.
    const out2: typeof out = [];
    const countAt1 = store.segmentsInRow(1, out2);
    expect(countAt1).toBe(2);
    const colorsAt1 = out2
      .slice(0, 2)
      .map((s) => s.color)
      .sort();
    expect(colorsAt1).toEqual([1, 2]);

    // Row 2: one past edge0's toRow=1 — edge0 must already be excluded here, not just from row
    // 11 onward (proving the boundary itself, not just "eventually" correct).
    const out3: typeof out = [];
    const countAt2 = store.segmentsInRow(2, out3);
    expect(countAt2).toBe(1);
    expect(out3[0]?.color).toBe(2);
  });

  test('a long edge that never resolves stays included at every row through the end of history', () => {
    const store = new LayoutStore();
    const chunk0 = buildChunk(0, 3, [[0, UNRESOLVED_ROW, 0, 0, 7, 0]]);
    store.append(chunk0);
    const chunk1 = buildChunk(3, 20, []); // no patches at all — the edge above is never resolved.
    store.append(chunk1);

    for (const row of [0, 2, 3, 10, 19]) {
      const out: EdgeSegment[] = [];
      const count = store.segmentsInRow(row, out);
      expect(count).toBe(1);
      expect(out[0]?.color).toBe(7);
    }
  });
});

// G31 round-2 performance review, finding #2: every open lane at a chunk boundary is added to
// #longEdges as UNRESOLVED_ROW (isLongAtAppendTime's own unconditional rule), and most resolve to
// a genuinely short span in the very next chunk — but #longEdges used to be a true append-only log,
// so each such chunk boundary left a permanent entry behind regardless, and #collectLongSegments
// scans every entry with fromRow <= row on every rendered row. Over many loaded chunks this grows
// without bound, in direct contradiction of the module doc's own "hundreds, not thousands" claim.
// This suite proves #longEdges' own size stays bounded by the genuinely-long-or-still-unresolved
// count, not by how many chunks have ever loaded — the actual quantity the growth claim is about.
describe('LayoutStore — #longEdges does not grow without bound as pending edges resolve short', () => {
  test('an edge that resolves short in the very next chunk is demoted out of #longEdges', () => {
    const store = new LayoutStore();
    const chunk0 = buildChunk(0, 1, [[0, UNRESOLVED_ROW, 0, 0, 1, 0]]);
    store.append(chunk0);
    expect(store.longEdgeCount).toBe(1); // unresolved at append time — long, as designed.

    // Resolves edge0 (global index 0) to toRow=1 — a span of 1, well under LONG_EDGE_ROWS.
    const chunk1 = buildPatchChunk(1, 2, [[0, 1, PATCH_UNCHANGED, PATCH_UNCHANGED]]);
    store.append(chunk1);
    expect(store.longEdgeCount).toBe(0); // demoted — no longer a permanent long-edge entry.

    // Still correctly reported, now via the CSR window instead of the long-edge scan.
    const out: EdgeSegment[] = [];
    expect(store.segmentsInRow(1, out)).toBe(1);
    expect(out[0]?.color).toBe(1);
  });

  test('loading many chunks whose pending edges each resolve short keeps #longEdges near zero, not O(chunks)', () => {
    const store = new LayoutStore();
    const chunkCount = 200;
    // Chunk c (rows [c, c+1)) opens one new unresolved edge of its own (global edge index c) AND
    // carries a patch resolving the PREVIOUS chunk's own edge (global index c-1) to toRow=c — a
    // span of 1, well under LONG_EDGE_ROWS. So by the time loading finishes, every edge but the
    // very last has been resolved short and demoted.
    for (let c = 0; c < chunkCount; c++) {
      const patches: Array<[number, number, number, number]> =
        c > 0 ? [[c - 1, c, PATCH_UNCHANGED, PATCH_UNCHANGED]] : [];
      const chunk: LayoutChunk = {
        ...buildChunk(c, c + 1, [[c, UNRESOLVED_ROW, 0, 0, c, 0]]),
        patches: new Uint32Array(patches.flat()),
      };
      store.append(chunk);
    }
    // #longEdges holds only the very last chunk's own still-genuinely-unresolved entry — not one
    // per chunk ever loaded (the pre-fix behavior this test would catch: longEdgeCount === 200).
    expect(store.longEdgeCount).toBe(1);
  });
});
