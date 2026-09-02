import { describe, expect, test } from 'bun:test';
import { clampColumnOverscan } from '../../frontend/src/views/grid/slick/kiraSlickGrid';

// P22 spike C4: KiraSlickGrid.getRenderedRange's own row-bounds arithmetic is rowRangeBounds,
// already covered by row-range.spec.ts (C1) — this file covers only what that one doesn't: the
// column-axis overscan clamp (D4's third bullet), which needs no live SlickGrid/DOM to exercise.

describe('clampColumnOverscan (P22 spike D4) — the column-axis overscan clamp', () => {
  test('1. expands both sides by overscanPx when there is room', () => {
    expect(clampColumnOverscan(1000, 1500, 560, 10_000)).toEqual({ leftPx: 440, rightPx: 2060 });
  });

  test('2. clamps the left side at 0 rather than going negative', () => {
    expect(clampColumnOverscan(200, 1500, 560, 10_000)).toEqual({ leftPx: 0, rightPx: 2060 });
  });

  test('3. clamps the right side at the canvas width rather than exceeding it', () => {
    expect(clampColumnOverscan(1000, 1500, 560, 1800)).toEqual({ leftPx: 440, rightPx: 1800 });
  });

  test('4. both sides clamp simultaneously on a canvas narrower than the overscan budget', () => {
    expect(clampColumnOverscan(100, 900, 560, 700)).toEqual({ leftPx: 0, rightPx: 700 });
  });
});
