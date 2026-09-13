import { describe, expect, test } from 'bun:test';
import { assignLanes } from './lanes.ts';
import {
  EDGE_COLOR,
  EDGE_FROM_LANE,
  EDGE_FROM_ROW,
  EDGE_KIND,
  EDGE_KIND_MERGE_IN,
  EDGE_KIND_STRAIGHT,
  EDGE_STRIDE,
  EDGE_TO_LANE,
  EDGE_TO_ROW,
  type LayoutFrontier,
  type LayoutInput,
  PATCH_EDGE_INDEX,
  PATCH_KIND,
  PATCH_STRIDE,
  PATCH_TO_LANE,
  PATCH_TO_ROW,
  PATCH_UNCHANGED,
} from './types.ts';

/**
 * G21 D3/D14: the first test in `src/graph` — F3's own worked example ("the canonical `feature`
 * off `main`"), root-caused in the phase's Findings: `feature`'s oldest commit (row 3) has parent
 * row 5, the shared merge base; `main`'s row 4 also parents row 5. Before D3, row 3's edge was
 * left claiming its own (feature's) lane all the way to row 5, disconnected from the commit it
 * converges into. D3 patches it to bend into row 5's actual lane and reclassifies it
 * `EDGE_KIND_MERGE_IN`.
 *
 * Six commits, topo order (row 0 newest), every row single-parent except the root:
 *   row 0 --> row 1 --> row 4 --\
 *                                 row 5 (root)
 *   row 2 --> row 3 -------------/
 *
 * Simulated by hand once as a single pass and once paged in two calls, split between row 3 (the
 * branch's last commit) and row 5 (the merge base) — exactly where the patch has to travel
 * through `LayoutChunk.patches` rather than being resolved in place, the path most likely to be
 * wrong. Row 3's own edge (global index 3) ends up patched *twice* across the page boundary in
 * this scenario — once for `toRow` (a plain parent resolving), once for `toLane`/`kind` (the
 * convergence itself) — which is exactly the case `PATCH_UNCHANGED`'s per-field sentinel exists
 * to keep independent.
 */

function edgeAt(edges: Uint32Array, localIndex: number) {
  const base = localIndex * EDGE_STRIDE;
  return {
    fromRow: edges[base + EDGE_FROM_ROW],
    toRow: edges[base + EDGE_TO_ROW],
    fromLane: edges[base + EDGE_FROM_LANE],
    toLane: edges[base + EDGE_TO_LANE],
    color: edges[base + EDGE_COLOR],
    kind: edges[base + EDGE_KIND],
  };
}

describe('assignLanes — G21 D3 merge-in convergence', () => {
  test('one pass: the converging edge bends into the claiming lane and is reclassified merge-in', () => {
    const input: LayoutInput = {
      from: 0,
      to: 6,
      parentOffsets: Uint32Array.from([0, 1, 2, 3, 4, 5, 5]),
      parentRows: Int32Array.from([1, 4, 3, 5, 5]),
      resolvedParentSlots: Uint32Array.from([]),
    };

    const { laneOf, edgeBuffer } = assignLanes(input, undefined);
    expect(Array.from(laneOf)).toEqual([0, 0, 1, 1, 0, 0]);

    const built = edgeBuffer.build(0, 6);
    expect(built.patches.length).toBe(0); // one pass: every patch lands in place, none cross-chunk

    // Edge index 3 is row 3's own edge (the fourth `append` call: row0, row1, row2, row3).
    const converging = edgeAt(built.edges, 3);
    expect(converging.fromRow).toBe(3);
    expect(converging.toRow).toBe(5);
    expect(converging.fromLane).toBe(1);
    // The real assertion this phase is about: the edge now bends into lane 0 (where row 5 was
    // actually claimed), not the lane it started in.
    expect(converging.toLane).toBe(0);
    expect(converging.kind).toBe(EDGE_KIND_MERGE_IN);

    // main's own row 1 -> row 4 edge (index 1) is an ordinary straight run, untouched by D3.
    const straight = edgeAt(built.edges, 1);
    expect(straight.fromRow).toBe(1);
    expect(straight.toRow).toBe(4);
    expect(straight.toLane).toBe(0);
    expect(straight.kind).toBe(EDGE_KIND_STRAIGHT);
  });

  test("paged: split between the branch's last commit and the merge base equals the one-pass run", () => {
    // Chunk 1 (rows 0-3): row 4/5 have not been appended to the store yet, so row 1's and row
    // 3's own parent links (both eventually -> row 4 / row 5) are still unresolved.
    const chunk1Input: LayoutInput = {
      from: 0,
      to: 4,
      parentOffsets: Uint32Array.from([0, 1, 2, 3, 4]),
      parentRows: Int32Array.from([1, -1, 3, -1]),
      resolvedParentSlots: Uint32Array.from([]),
    };
    const chunk1 = assignLanes(chunk1Input, undefined);
    expect(Array.from(chunk1.laneOf)).toEqual([0, 0, 1, 1]);
    const built1Preliminary = chunk1.edgeBuffer.build(0, 4);
    // Row 1's and row 3's edges are still dangling at this point — exactly what the second
    // chunk's patches exist to fix up.
    expect(edgeAt(built1Preliminary.edges, 1).toRow).toBe(0xffffffff);
    expect(edgeAt(built1Preliminary.edges, 3).toRow).toBe(0xffffffff);

    // Chunk 2 (rows 4-5): row 4/5 are now appended, so slots 1 and 3 resolve (both named in
    // resolvedParentSlots), and row 4's own parent (slot 4, brand new) is resolved directly.
    const chunk2Input: LayoutInput = {
      from: 4,
      to: 6,
      parentOffsets: Uint32Array.from([0, 1, 2, 3, 4, 5, 5]),
      parentRows: Int32Array.from([1, 4, 3, 5, 5]),
      resolvedParentSlots: Uint32Array.from([1, 3]),
    };
    const chunk2 = assignLanes(chunk2Input, chunk1.frontier as LayoutFrontier);
    expect(Array.from(chunk2.laneOf)).toEqual([0, 0]);

    const built2 = chunk2.edgeBuffer.build(4, 6);
    // Three patch records travel through chunk 2's own `patches`, all naming edges that live in
    // chunk 1 (global indices < 4): slot 1's resolution (edge 1 -> toRow 4), slot 3's resolution
    // (edge 3 -> toRow 5), and the convergence discovered at row 5 (edge 3 -> toLane 0,
    // kind merge-in) — the same edge patched twice, for two independent fields.
    expect(built2.patches.length).toBe(3 * PATCH_STRIDE);
    const records = [];
    for (let i = 0; i < built2.patches.length; i += PATCH_STRIDE) {
      records.push({
        edgeIndex: built2.patches[i + PATCH_EDGE_INDEX],
        toRow: built2.patches[i + PATCH_TO_ROW],
        toLane: built2.patches[i + PATCH_TO_LANE],
        kind: built2.patches[i + PATCH_KIND],
      });
    }
    expect(records).toEqual([
      { edgeIndex: 1, toRow: 4, toLane: PATCH_UNCHANGED, kind: PATCH_UNCHANGED },
      { edgeIndex: 3, toRow: 5, toLane: PATCH_UNCHANGED, kind: PATCH_UNCHANGED },
      { edgeIndex: 3, toRow: PATCH_UNCHANGED, toLane: 0, kind: EDGE_KIND_MERGE_IN },
    ]);

    // Apply every patch the way `LayoutStore.#applyPatches` does — write into chunk 1's own
    // edges buffer, in order, skipping whichever field a given record leaves unchanged — and
    // confirm the paged run then equals the one-pass run exactly, edge for edge.
    const built1 = chunk1.edgeBuffer.build(0, 4);
    const patchedEdges = Uint32Array.from(built1.edges);
    for (const record of records) {
      const base = record.edgeIndex * EDGE_STRIDE;
      if (record.toRow !== PATCH_UNCHANGED) patchedEdges[base + EDGE_TO_ROW] = record.toRow;
      if (record.toLane !== PATCH_UNCHANGED) patchedEdges[base + EDGE_TO_LANE] = record.toLane;
      if (record.kind !== PATCH_UNCHANGED) patchedEdges[base + EDGE_KIND] = record.kind;
    }

    const onePass = assignLanes(
      {
        from: 0,
        to: 6,
        parentOffsets: Uint32Array.from([0, 1, 2, 3, 4, 5, 5]),
        parentRows: Int32Array.from([1, 4, 3, 5, 5]),
        resolvedParentSlots: Uint32Array.from([]),
      },
      undefined,
    );
    const onePassBuilt = onePass.edgeBuffer.build(0, 6);

    expect(Array.from(patchedEdges)).toEqual(
      Array.from(onePassBuilt.edges.subarray(0, 4 * EDGE_STRIDE)),
    );
    expect(Array.from(built2.edges)).toEqual(
      Array.from(onePassBuilt.edges.subarray(4 * EDGE_STRIDE)),
    );

    const patchedConverging = edgeAt(patchedEdges, 3);
    expect(patchedConverging.toRow).toBe(5);
    expect(patchedConverging.toLane).toBe(0);
    expect(patchedConverging.kind).toBe(EDGE_KIND_MERGE_IN);
  });
});
