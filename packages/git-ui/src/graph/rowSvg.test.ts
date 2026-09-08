import { describe, expect, test } from 'bun:test';
import { isHeadDecoration, planNode, type RowSlice } from './rowSvg.ts';

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
    expect(shapes.every((s) => !s.isHeadRing)).toBe(true);
  });

  test('an ordinary commit that is HEAD gets the dot plus an additive, unfilled ring', () => {
    const shapes = planNode(baseSlice({ isHead: true }), 22);
    expect(shapes).toHaveLength(2);
    const ring = shapes.find((s) => s.isHeadRing);
    expect(ring).toBeDefined();
    expect(ring?.filled).toBe(false);
    expect(ring?.dashed).toBe(false);
  });

  test('a merge commit that is HEAD keeps both its own shapes and gains the ring — precedence untouched', () => {
    const shapes = planNode(baseSlice({ nodeKind: 'merge', isHead: true }), 22);
    expect(shapes).toHaveLength(3);
    expect(shapes.filter((s) => s.isHeadRing)).toHaveLength(1);
  });

  test('a stash row that is HEAD keeps its own dashed ring and gains the head ring too', () => {
    const shapes = planNode(baseSlice({ nodeKind: 'stash', isHead: true }), 22);
    expect(shapes).toHaveLength(2);
    expect(shapes.some((s) => s.dashed && !s.isHeadRing)).toBe(true);
    expect(shapes.some((s) => s.isHeadRing)).toBe(true);
  });

  test('a row with no layout yet (lane undefined) draws nothing, HEAD or not', () => {
    expect(planNode(baseSlice({ lane: undefined, isHead: true }), 22)).toHaveLength(0);
  });
});
