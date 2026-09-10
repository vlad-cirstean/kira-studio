import { describe, expect, test } from 'bun:test';
import { EDGE_KIND_MERGE_IN, EDGE_KIND_STRAIGHT } from '@kira/git-core';
import { GEOMETRY } from './geometry.ts';
import type { EdgeSegment } from './layoutStore.ts';
import { edgeCommand, isHeadDecoration, laneX, planNode, type RowSlice } from './rowSvg.ts';

function baseSlice(overrides: Partial<RowSlice> = {}): RowSlice {
  return {
    row: 0,
    lane: 0,
    color: 0,
    laneCount: 1,
    nodeKind: 'commit',
    segments: [],
    segmentCount: 0,
    isHead: false,
    ...overrides,
  };
}

describe('isHeadDecoration', () => {
  test('true for the head decoration kind', () => {
    expect(isHeadDecoration({ kind: 'head' })).toBe(true);
  });

  test('true for a branch decoration whose own isHead is true (detached HEAD included)', () => {
    expect(isHeadDecoration({ kind: 'branch', name: 'main', isHead: true })).toBe(true);
  });

  test('false for a branch decoration that is not HEAD', () => {
    expect(isHeadDecoration({ kind: 'branch', name: 'main', isHead: false })).toBe(false);
  });

  test('false for a tag/stash decoration', () => {
    expect(isHeadDecoration({ kind: 'tag', name: 'v1' })).toBe(false);
    expect(isHeadDecoration({ kind: 'stash', index: 0 })).toBe(false);
  });
});

describe('planNode — G19 D1 HEAD ring', () => {
  test('an ordinary commit that is not HEAD draws just its dot', () => {
    const shapes = planNode(baseSlice(), 22);
    expect(shapes).toHaveLength(1);
    expect(shapes.every((s) => !s.isHeadRing && !s.isHeadHalo)).toBe(true);
  });

  // G-UX (item 1): the halo is additive alongside the ring, both gated on the identical
  // `slice.isHead` — every "gains the ring" case below now also gains exactly one halo shape.
  test('an ordinary commit that is HEAD gets the dot plus an additive halo and unfilled ring', () => {
    const shapes = planNode(baseSlice({ isHead: true }), 22);
    expect(shapes).toHaveLength(3);
    const ring = shapes.find((s) => s.isHeadRing);
    expect(ring).toBeDefined();
    expect(ring?.filled).toBe(false);
    expect(ring?.dashed).toBe(false);
    const halo = shapes.find((s) => s.isHeadHalo);
    expect(halo).toBeDefined();
    expect(halo?.filled).toBe(true);
    expect(halo?.r).toBe(GEOMETRY.headHaloRadius);
  });

  test('a merge commit that is HEAD keeps both its own shapes and gains the halo and ring — precedence untouched', () => {
    const shapes = planNode(baseSlice({ nodeKind: 'merge', isHead: true }), 22);
    expect(shapes).toHaveLength(4);
    expect(shapes.filter((s) => s.isHeadRing)).toHaveLength(1);
    expect(shapes.filter((s) => s.isHeadHalo)).toHaveLength(1);
  });

  test('a stash row that is HEAD keeps its own dashed ring and gains the halo and head ring too', () => {
    const shapes = planNode(baseSlice({ nodeKind: 'stash', isHead: true }), 22);
    expect(shapes).toHaveLength(3);
    expect(shapes.some((s) => s.dashed && !s.isHeadRing)).toBe(true);
    expect(shapes.some((s) => s.isHeadRing)).toBe(true);
    expect(shapes.some((s) => s.isHeadHalo)).toBe(true);
  });

  test('a row with no layout yet (lane undefined) draws nothing, HEAD or not', () => {
    expect(planNode(baseSlice({ lane: undefined, isHead: true }), 22)).toHaveLength(0);
  });

  // G21 D1: F1's own remaining gap — a merge commit at HEAD used to have its HEAD ring painted
  // at the identical centre and radius as its merge ring (both were `GEOMETRY.mergeRadius`),
  // erasing the merge indicator. The HEAD ring now uses its own, strictly larger radius.
  test('a merge commit that is HEAD draws four shapes at four distinct radii', () => {
    const shapes = planNode(baseSlice({ nodeKind: 'merge', isHead: true }), 22);
    expect(shapes).toHaveLength(4);
    const radii = shapes.map((s) => s.r);
    expect(new Set(radii).size).toBe(4);
    const ring = shapes.find((s) => s.isHeadRing);
    const mergeRing = shapes.find((s) => !s.isHeadRing && !s.isHeadHalo && !s.filled);
    expect(ring?.r).toBe(GEOMETRY.headRingRadius);
    expect(mergeRing?.r).toBe(GEOMETRY.mergeRadius);
    // The real assertion: the head ring must be strictly larger, so it clears the merge ring
    // instead of painting over it.
    expect(ring?.r).toBeGreaterThan(mergeRing?.r ?? Number.POSITIVE_INFINITY);
  });

  // G-UX (item 1): buildRowSvg paints the halo UNDER the row's own edges — this only tests
  // planNode's own output order (halo shapes first), which is what buildRowSvg partitions on.
  test("the halo shape is planNode's own first entry, so buildRowSvg can paint it before edges", () => {
    const shapes = planNode(baseSlice({ isHead: true }), 22);
    expect(shapes[0]?.isHeadHalo).toBe(true);
  });
});

describe('edgeCommand — G21 D3c EDGE_KIND_MERGE_IN', () => {
  const rowHeight = 22;

  function mergeInSegment(overrides: Partial<EdgeSegment> = {}): EdgeSegment {
    return {
      fromRow: 3,
      toRow: 5,
      fromLane: 1,
      toLane: 0,
      color: 0,
      kind: EDGE_KIND_MERGE_IN,
      ...overrides,
    };
  }

  test('its own row (fromRow): a vertical run in fromLane, centre to bottom — no bend yet', () => {
    const d = edgeCommand(mergeInSegment(), 3, rowHeight);
    // A vertical run ("V", no curve "C") starting at the row's centre, in fromLane (1) — not
    // toLane (0), unlike the ordinary straight/branch-out case.
    expect(d).not.toContain('C');
    expect(d.startsWith(`M${laneX(1)},${rowHeight / 2}`)).toBe(true);
  });

  test('a pass-through row: a full-height vertical run, still in fromLane', () => {
    const d = edgeCommand(mergeInSegment(), 4, rowHeight);
    expect(d).not.toContain('C');
    expect(d.startsWith(`M${laneX(1)},${-GEOMETRY.overdraw}`)).toBe(true);
  });

  test('its target row (toRow): the bend — a curve from fromLane into toLane, top to centre', () => {
    const d = edgeCommand(mergeInSegment(), 5, rowHeight);
    expect(d).toContain('C');
    // Starts at the top of the row in fromLane (mirroring the ordinary case's own start-at-
    // centre-in-fromLane) and ends at the row's own centre in toLane — the node it converges
    // into — not the bottom.
    expect(d.startsWith(`M${laneX(1)},${-GEOMETRY.overdraw}`)).toBe(true);
    expect(d.endsWith(`${laneX(0)},${rowHeight / 2}`)).toBe(true);
  });

  test('a straight edge is unaffected by the merge-in branch — unchanged shape', () => {
    const segment = mergeInSegment({ kind: EDGE_KIND_STRAIGHT, fromLane: 0, toLane: 0 });
    const d = edgeCommand(segment, 3, rowHeight);
    expect(d).not.toContain('C'); // same lane, no bend needed either way
    expect(d.startsWith(`M${laneX(0)},${rowHeight / 2}`)).toBe(true);
  });
});
