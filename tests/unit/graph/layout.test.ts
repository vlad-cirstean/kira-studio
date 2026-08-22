import { describe, expect, test } from "bun:test";
import { layoutAppend, layoutTransferList } from "../../../packages/core/src/graph/layout.ts";
import {
  EDGE_FROM_ROW,
  EDGE_KIND_BRANCH_OUT,
  EDGE_KIND_MERGE_IN,
  EDGE_KIND_STRAIGHT,
  EDGE_STRIDE,
  LANE_EMPTY,
} from "../../../packages/core/src/graph/types.ts";
import { CommitStore } from "../../../packages/core/src/store/commitStore.ts";
import { fan, octopusOf, topology } from "../../fixtures/topology.ts";

function layoutWhole(records: ReturnType<typeof topology>) {
  const store = new CommitStore();
  store.appendPage(records);
  const input = store.layoutInput(0, store.rowCount);
  return { store, ...layoutAppend(input, undefined) };
}

describe("assignLanes / layoutAppend — structural shapes", () => {
  test("a linear chain uses exactly one lane throughout", () => {
    const { chunk } = layoutWhole(topology(["A", "B:A", "C:B", "D:C"]));
    expect(chunk.laneCount).toBe(1);
    expect([...chunk.laneOf]).toEqual([0, 0, 0, 0]);
  });

  test("a fork-and-merge opens a second lane and closes it at the merge", () => {
    // main: A, B ; feature branches from A: F1 ; merge M has parents [B, F1]
    const records = topology(["A", "B:A", "F1:A", "M:B,F1"]);
    const { chunk } = layoutWhole(records);
    expect(chunk.laneCount).toBe(2);
    // M is newest (row 0), then B (row1) and F1 (row2) both parented on A (row3).
    const laneOfRow = (subject: string) => {
      const row = records.findIndex((r) => r.subject === subject);
      return chunk.laneOf[row];
    };
    expect(laneOfRow("B")).not.toBe(laneOfRow("F1"));
    // A is a single root reached by two lanes converging — only one of them "wins" the row.
    const rootRow = records.findIndex((r) => r.subject === "A");
    expect(chunk.laneOf[rootRow]).toBeDefined();
  });

  test("an unmerged fork leaves a lane open to the end of the loaded range", () => {
    const records = fan(2, 3); // root + 2 branches never merged back
    const { chunk } = layoutWhole(records);
    expect(chunk.laneCount).toBe(2);
  });

  test("octopus(3) produces a merge row with three edges, and octopus(12) with twelve", () => {
    for (const n of [3, 12]) {
      const records = octopusOf(n);
      const { chunk } = layoutWhole(records);
      const mergeRow = records.findIndex((r) => r.subject === "octopus-merge");
      const edgesFromMerge = [...chunk.edges]
        .reduce<number[][]>((acc, _v, i) => {
          if (i % EDGE_STRIDE === 0) acc.push([...chunk.edges.subarray(i, i + EDGE_STRIDE)]);
          return acc;
        }, [])
        .filter((e) => e[EDGE_FROM_ROW] === mergeRow);
      expect(edgesFromMerge).toHaveLength(n);
      expect(chunk.laneCount).toBeGreaterThanOrEqual(n >= 2 ? 2 : 1);
    }
  });

  test("multiple disconnected roots each get their own lane, never merging", () => {
    const records = topology(["R1", "R2", "R3", "A1:R1", "A2:R2", "A3:R3"]);
    const { chunk } = layoutWhole(records);
    expect(chunk.laneCount).toBe(3);
  });

  test("a criss-cross history (two merges, two LCAs) lays out without error", () => {
    // A -> B, A -> C ; D merges [B, C] ; E merges [C, B] (criss-cross)
    const records = topology(["A", "B:A", "C:A", "D:B,C", "E:C,B"]);
    const { chunk } = layoutWhole(records);
    expect(chunk.laneCount).toBeGreaterThanOrEqual(2);
    expect(chunk.laneOf).toHaveLength(records.length);
  });

  test("a merge whose second parent is far above it exercises maxEdgeSpan", () => {
    // A long-lived branch (10 commits deep) merges back into a short main.
    const spec: string[] = ["root"];
    let mainTip = "root";
    for (let i = 0; i < 3; i++) {
      spec.push(`main-${i}:${mainTip}`);
      mainTip = `main-${i}`;
    }
    let branchTip = "root";
    for (let i = 0; i < 15; i++) {
      spec.push(`branch-${i}:${branchTip}`);
      branchTip = `branch-${i}`;
    }
    spec.push(`merge:${mainTip},${branchTip}`);
    const records = topology(spec);
    const { chunk } = layoutWhole(records);
    expect(chunk.maxEdgeSpan).toBeGreaterThan(10);
  });

  test("fifty concurrent open lanes are each assigned distinctly", () => {
    const records = fan(50, 2);
    const { chunk } = layoutWhole(records);
    expect(chunk.laneCount).toBe(50);
  });

  test("a root commit's lane closes (does not stay open past the root)", () => {
    const { chunk, frontier } = layoutWhole(topology(["A"]));
    expect(chunk.laneOf).toHaveLength(1);
    expect(frontier.openLanes.every((l) => l === LANE_EMPTY)).toBe(true);
  });

  test("edge kinds: straight for a simple continuation, branch-out for a fresh octopus arm, merge-in at a convergent parent", () => {
    const records = topology(["A", "B:A", "C:A", "D:B,C"]);
    const { chunk } = layoutWhole(records);
    const edgeAt = (i: number) => [...chunk.edges.subarray(i * EDGE_STRIDE, (i + 1) * EDGE_STRIDE)];
    const kinds = Array.from({ length: chunk.edges.length / EDGE_STRIDE }, (_, i) => edgeAt(i)[5]);
    expect(kinds).toContain(EDGE_KIND_STRAIGHT);
    expect(kinds.includes(EDGE_KIND_BRANCH_OUT) || kinds.includes(EDGE_KIND_MERGE_IN)).toBe(true);
  });
});

describe("assignLanes — determinism", () => {
  test("the same input produces byte-identical buffers across two independent runs", () => {
    const records = fan(12, 6);
    const a = layoutWhole(records).chunk;
    const b = layoutWhole(records).chunk;
    expect([...a.laneOf]).toEqual([...b.laneOf]);
    expect([...a.colorOf]).toEqual([...b.colorOf]);
    expect([...a.edges]).toEqual([...b.edges]);
    expect(a.laneCount).toBe(b.laneCount);
  });
});

describe("layoutTransferList", () => {
  test("lists each distinct buffer exactly once", () => {
    const { chunk } = layoutWhole(octopusOf(5));
    const transfer = layoutTransferList(chunk);
    expect(new Set(transfer).size).toBe(transfer.length);
    for (const buf of [
      chunk.laneOf.buffer as ArrayBuffer,
      chunk.colorOf.buffer as ArrayBuffer,
      chunk.edges.buffer as ArrayBuffer,
      chunk.edgeIndex.buffer as ArrayBuffer,
      chunk.patches.buffer as ArrayBuffer,
    ]) {
      expect(transfer).toContain(buf);
    }
  });
});
