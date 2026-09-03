import { describe, expect, test } from "bun:test";
import { GEOMETRY } from "../../../packages/ui/src/graph/geometry.ts";
import { laneAt } from "../../../packages/ui/src/graph/hitTest.ts";

describe("laneAt", () => {
  test("the gutter's left edge (inside padLeft, before any lane) reads as lane 0", () => {
    expect(laneAt(0)).toBe(0);
    expect(laneAt(GEOMETRY.padLeft - 1)).toBe(0);
  });

  test("the first pixel of a lane's own column reads as that lane", () => {
    expect(laneAt(GEOMETRY.padLeft)).toBe(0);
    expect(laneAt(GEOMETRY.padLeft + GEOMETRY.laneWidth)).toBe(1);
    expect(laneAt(GEOMETRY.padLeft + 3 * GEOMETRY.laneWidth)).toBe(3);
  });

  test("the last pixel of a lane's column still reads as that lane, not the next", () => {
    expect(laneAt(GEOMETRY.padLeft + GEOMETRY.laneWidth - 1)).toBe(0);
  });

  test("an x at or past the clamped twelfth lane's column reads as the twelfth lane", () => {
    const twelfthLaneStart = GEOMETRY.padLeft + (GEOMETRY.maxLanes - 1) * GEOMETRY.laneWidth;
    expect(laneAt(twelfthLaneStart)).toBe(GEOMETRY.maxLanes - 1);
  });

  test("an x past the gutter entirely (e.g. in the message column) clamps to the last lane", () => {
    expect(laneAt(GEOMETRY.padLeft + GEOMETRY.maxLanes * GEOMETRY.laneWidth + 500)).toBe(
      GEOMETRY.maxLanes - 1,
    );
  });

  test("a negative offset clamps to lane 0 rather than going negative", () => {
    expect(laneAt(-50)).toBe(0);
  });
});
