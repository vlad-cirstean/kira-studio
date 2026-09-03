import { describe, expect, test } from "bun:test";
import { GEOMETRY, graphColumnWidth } from "../../../packages/ui/src/graph/geometry.ts";

/** W6's own column table: `padLeft + min(laneCount, MAX_LANES) × laneWidth + gutterPad`. */
describe("graphColumnWidth", () => {
  test("a lane count of 0 is just the padding", () => {
    expect(graphColumnWidth(0)).toBe(GEOMETRY.padLeft + GEOMETRY.gutterPad);
  });

  test("scales linearly with lane count below the clamp", () => {
    expect(graphColumnWidth(1)).toBe(GEOMETRY.padLeft + GEOMETRY.laneWidth + GEOMETRY.gutterPad);
    expect(graphColumnWidth(3)).toBe(
      GEOMETRY.padLeft + 3 * GEOMETRY.laneWidth + GEOMETRY.gutterPad,
    );
  });

  test("clamps at maxLanes rather than growing without bound", () => {
    const atClamp = graphColumnWidth(GEOMETRY.maxLanes);
    expect(graphColumnWidth(GEOMETRY.maxLanes + 1)).toBe(atClamp);
    expect(graphColumnWidth(50)).toBe(atClamp);
  });
});
