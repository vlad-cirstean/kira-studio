/**
 * The phase's most important invariant (docs/plans/P2.md W9): laying a topology out page by
 * page must produce byte-identical buffers to laying it out in one pass, once patches are
 * applied. A full re-layout-from-zero design would trivially satisfy this; the incremental
 * design here only does if the patch mechanism is right, so this is the test that actually
 * exercises it.
 */
import { describe, expect, test } from 'bun:test';
import { layoutAppend } from '../src/graph/layout';
import {
  EDGE_STRIDE,
  EDGE_TO_ROW,
  type LayoutChunk,
  type LayoutFrontier,
} from '../src/graph/types';
import type { CommitRecord } from '../src/model/commit';
import { CommitStore } from '../src/store/commitStore';
import { fan, octopusOf, topology } from './topology';

/** Concatenates every chunk's edges (global-index-contiguous by construction) into one buffer,
 *  then applies every chunk's own `patches` — the same "fix up an earlier chunk" step a real
 *  consumer would perform once it holds every chunk. */
function reassembleEdges(chunks: readonly LayoutChunk[]): Uint32Array {
  const totalEdges = chunks.reduce((sum, c) => sum + c.edges.length / EDGE_STRIDE, 0);
  const out = new Uint32Array(totalEdges * EDGE_STRIDE);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk.edges, offset);
    offset += chunk.edges.length;
  }
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.patches.length; i += 2) {
      const globalEdgeIndex = chunk.patches[i] as number;
      const toRow = chunk.patches[i + 1] as number;
      out[globalEdgeIndex * EDGE_STRIDE + EDGE_TO_ROW] = toRow;
    }
  }
  return out;
}

function layoutOnePass(records: readonly CommitRecord[]) {
  const store = new CommitStore();
  store.appendPage(records);
  const { chunk } = layoutAppend(store.layoutInput(0, store.rowCount), undefined);
  return chunk;
}

function layoutInPages(records: readonly CommitRecord[], pageSize: number) {
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

function combinedLaneAndColor(chunks: readonly LayoutChunk[]): { lane: number[]; color: number[] } {
  const lane: number[] = [];
  const color: number[] = [];
  for (const chunk of chunks) {
    lane.push(...chunk.laneOf);
    color.push(...chunk.colorOf);
  }
  return { lane, color };
}

const SHAPES: Record<string, readonly CommitRecord[]> = {
  linear: topology(['A', 'B:A', 'C:B', 'D:C', 'E:D']),
  forkAndMerge: topology(['A', 'B:A', 'F1:A', 'F2:F1', 'M:B,F2']),
  unmergedFork: fan(3, 4),
  octopus3: octopusOf(3),
  octopus12: octopusOf(12),
  crissCross: topology(['A', 'B:A', 'C:A', 'D:B,C', 'E:C,B']),
  multipleRoots: topology(['R1', 'R2', 'A1:R1', 'A2:R2']),
  fiftyLanes: fan(50, 1),
};

describe('page-by-page layout equals one-pass layout', () => {
  for (const [name, records] of Object.entries(SHAPES)) {
    for (const pageSize of [1, 2, 3, records.length]) {
      test(`${name} @ pageSize=${pageSize}`, () => {
        const onePass = layoutOnePass(records);
        const paged = layoutInPages(records, pageSize);

        const onePassLaneColor = { lane: [...onePass.laneOf], color: [...onePass.colorOf] };
        const pagedLaneColor = combinedLaneAndColor(paged);
        expect(pagedLaneColor.lane).toEqual(onePassLaneColor.lane);
        expect(pagedLaneColor.color).toEqual(onePassLaneColor.color);

        const pagedEdges = reassembleEdges(paged);
        expect([...pagedEdges]).toEqual([...onePass.edges]);

        const pagedLaneCount = Math.max(...paged.map((c) => c.laneCount));
        expect(pagedLaneCount).toBe(onePass.laneCount);
      });
    }
  }
});

describe('page-by-page layout at scale', () => {
  test('largeBranchy-style fan(200, 20) at 5000-equivalent-ish page size matches one pass', () => {
    const records = fan(20, 20); // 20 branches * 20 depth + root = 401 commits
    const onePass = layoutOnePass(records);
    const paged = layoutInPages(records, 37); // an awkward page size, deliberately not a divisor
    const pagedLaneColor = combinedLaneAndColor(paged);
    expect(pagedLaneColor.lane).toEqual([...onePass.laneOf]);
    expect(pagedLaneColor.color).toEqual([...onePass.colorOf]);
    expect([...reassembleEdges(paged)]).toEqual([...onePass.edges]);
  });
});
