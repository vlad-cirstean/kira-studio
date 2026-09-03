import { describe, expect, test } from "bun:test";
import { EDGE_KIND_STRAIGHT, UNRESOLVED_ROW } from "../../../packages/core/src/graph/types.ts";
import { GEOMETRY } from "../../../packages/ui/src/graph/geometry.ts";
import type { EdgeSegment } from "../../../packages/ui/src/graph/layoutStore.ts";
import {
  edgeCommand,
  gutterWidth,
  laneX,
  planEdgePaths,
  planNode,
  type RowSlice,
} from "../../../packages/ui/src/graph/rowSvg.ts";

function segment(overrides: Partial<EdgeSegment> = {}): EdgeSegment {
  return {
    fromRow: 0,
    toRow: 1,
    fromLane: 0,
    toLane: 0,
    color: 0,
    kind: EDGE_KIND_STRAIGHT,
    ...overrides,
  };
}

function slice(overrides: Partial<RowSlice> = {}): RowSlice {
  return {
    row: 0,
    lane: 0,
    color: 0,
    laneCount: 1,
    nodeKind: "commit",
    segments: [],
    segmentCount: 0,
    ...overrides,
  };
}

const ROW_HEIGHT = 22;

describe("laneX", () => {
  test("lane 0 sits half a lane width past padLeft", () => {
    expect(laneX(0)).toBe(GEOMETRY.padLeft + GEOMETRY.laneWidth / 2);
  });

  test("scales linearly with lane index below the clamp", () => {
    expect(laneX(3)).toBe(GEOMETRY.padLeft + 3 * GEOMETRY.laneWidth + GEOMETRY.laneWidth / 2);
  });

  test("clamps to the twelfth lane's column rather than growing without bound", () => {
    const atClamp = laneX(GEOMETRY.maxLanes - 1);
    expect(laneX(GEOMETRY.maxLanes)).toBe(atClamp);
    expect(laneX(50)).toBe(atClamp);
  });
});

describe("gutterWidth", () => {
  test("zero lanes is zero width", () => {
    expect(gutterWidth(0)).toBe(0);
  });

  test("scales linearly below the clamp", () => {
    expect(gutterWidth(4)).toBe(4 * GEOMETRY.laneWidth);
  });

  test("clamps at maxLanes lanes' worth of width", () => {
    const atClamp = gutterWidth(GEOMETRY.maxLanes);
    expect(gutterWidth(GEOMETRY.maxLanes + 5)).toBe(atClamp);
  });
});

describe("edgeCommand", () => {
  test("row === fromRow, same lane: a straight vertical command from the node's centre to the overdrawn bottom", () => {
    const command = edgeCommand(
      segment({ fromRow: 5, toRow: 6, fromLane: 2, toLane: 2 }),
      5,
      ROW_HEIGHT,
    );
    expect(command).toBe(
      `M${GEOMETRY.padLeft + 2.5 * GEOMETRY.laneWidth},11 V${22 + GEOMETRY.overdraw}`,
    );
    expect(command).not.toContain("C");
  });

  test("row === fromRow, a different lane: a cubic bezier from the node's centre to the overdrawn bottom in the target lane", () => {
    const command = edgeCommand(
      segment({ fromRow: 5, toRow: 6, fromLane: 0, toLane: 2 }),
      5,
      ROW_HEIGHT,
    );
    expect(command).toContain("C");
    expect(command.startsWith(`M${laneXOf(0)},11`)).toBe(true);
    expect(command.endsWith(`${laneXOf(2)},${22 + GEOMETRY.overdraw}`)).toBe(true);
  });

  test("row === toRow (resolved): a run from the overdrawn top down to the node's centre, never past it", () => {
    const command = edgeCommand(
      segment({ fromRow: 3, toRow: 7, fromLane: 1, toLane: 1 }),
      7,
      ROW_HEIGHT,
    );
    expect(command).toBe(`M${laneXOf(1)},${-GEOMETRY.overdraw} V11`);
  });

  test("a pass-through row (strictly between fromRow and toRow): a full-height run, overdrawn at both ends", () => {
    const command = edgeCommand(
      segment({ fromRow: 3, toRow: 7, fromLane: 1, toLane: 1 }),
      5,
      ROW_HEIGHT,
    );
    expect(command).toBe(`M${laneXOf(1)},${-GEOMETRY.overdraw} V${22 + GEOMETRY.overdraw}`);
  });

  test("an unresolved edge (toRow === UNRESOLVED_ROW), queried below fromRow: the same full-height run as a pass-through row — it 'runs to the bottom of its row and stops' only because no further row exists to query past the loaded window", () => {
    const command = edgeCommand(
      segment({ fromRow: 3, toRow: UNRESOLVED_ROW, fromLane: 1, toLane: 1 }),
      4,
      ROW_HEIGHT,
    );
    expect(command).toBe(`M${laneXOf(1)},${-GEOMETRY.overdraw} V${22 + GEOMETRY.overdraw}`);
  });

  test("an unresolved edge's own fromRow still draws the departing arc, not a run", () => {
    const command = edgeCommand(
      segment({ fromRow: 4, toRow: UNRESOLVED_ROW, fromLane: 1, toLane: 1 }),
      4,
      ROW_HEIGHT,
    );
    expect(command).toBe(`M${laneXOf(1)},11 V${22 + GEOMETRY.overdraw}`);
  });
});

function laneXOf(lane: number): number {
  return GEOMETRY.padLeft + lane * GEOMETRY.laneWidth + GEOMETRY.laneWidth / 2;
}

describe("planEdgePaths", () => {
  test("no segments plans no paths", () => {
    expect(planEdgePaths(slice({ segmentCount: 0 }), ROW_HEIGHT)).toEqual([]);
  });

  test("§5.3's own invariant: multiple segments sharing a colour concatenate into ONE path plan, not one per segment", () => {
    const segments: EdgeSegment[] = [
      segment({ fromRow: 0, toRow: 1, fromLane: 0, toLane: 0, color: 3 }),
      segment({ fromRow: -1, toRow: 5, fromLane: 2, toLane: 2, color: 3 }), // a pass-through at row 0
      segment({ fromRow: 0, toRow: 1, fromLane: 4, toLane: 4, color: 3 }),
    ];
    const plans = planEdgePaths(slice({ row: 0, segments, segmentCount: 3 }), ROW_HEIGHT);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.color).toBe(3);
    // Three M-commands concatenated into one path's `d`, not three separate <path> elements.
    expect(plans[0]?.d.match(/M/g)).toHaveLength(3);
  });

  test("segments with different colours plan one path each", () => {
    const segments: EdgeSegment[] = [
      segment({ fromRow: 0, toRow: 1, color: 1 }),
      segment({ fromRow: 0, toRow: 1, color: 2 }),
    ];
    const plans = planEdgePaths(slice({ row: 0, segments, segmentCount: 2 }), ROW_HEIGHT);
    expect(plans.map((p) => p.color).sort()).toEqual([1, 2]);
  });

  test("two different lanes sharing a colour still concatenate into one path", () => {
    const segments: EdgeSegment[] = [
      segment({ fromRow: 0, toRow: 1, fromLane: 0, toLane: 0, color: 5 }),
      segment({ fromRow: 0, toRow: 1, fromLane: 9, toLane: 9, color: 5 }),
    ];
    const plans = planEdgePaths(slice({ row: 0, segments, segmentCount: 2 }), ROW_HEIGHT);
    expect(plans).toHaveLength(1);
  });

  test("only the first segmentCount entries of the reused segments buffer are read", () => {
    const segments: EdgeSegment[] = [
      segment({ fromRow: 0, toRow: 1, color: 1 }),
      segment({ fromRow: 0, toRow: 1, color: 99 }), // stale leftover from a previous row's call
    ];
    const plans = planEdgePaths(slice({ row: 0, segments, segmentCount: 1 }), ROW_HEIGHT);
    expect(plans.map((p) => p.color)).toEqual([1]);
  });
});

describe("planNode", () => {
  test("a row with no layout yet (lane undefined) plans nothing", () => {
    expect(planNode(slice({ lane: undefined }), ROW_HEIGHT)).toEqual([]);
  });

  test("an ordinary commit plans one filled dot at nodeRadius", () => {
    const plans = planNode(slice({ lane: 2, color: 4, nodeKind: "commit" }), ROW_HEIGHT);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      r: GEOMETRY.nodeRadius,
      color: 4,
      filled: true,
      dashed: false,
    });
    expect(plans[0]?.cx).toBe(laneXOf(2));
    expect(plans[0]?.cy).toBe(ROW_HEIGHT / 2);
  });

  test("a merge plans a filled dot plus an unfilled ring at mergeRadius", () => {
    const plans = planNode(slice({ lane: 0, color: 1, nodeKind: "merge" }), ROW_HEIGHT);
    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({ filled: true, r: GEOMETRY.nodeRadius });
    expect(plans[1]).toMatchObject({ filled: false, dashed: false, r: GEOMETRY.mergeRadius });
  });

  test("a stash plans exactly one unfilled, dashed ring — no companion filled dot", () => {
    const plans = planNode(slice({ lane: 0, color: 1, nodeKind: "stash" }), ROW_HEIGHT);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ filled: false, dashed: true, r: GEOMETRY.nodeRadius });
  });
});
