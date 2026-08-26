import { describe, expect, test } from 'bun:test';
import { columnOffsets, columnRangeExtractor } from '../../src/renderer/views/shared/page/columns';

// 10 columns, 100px each -> offsets = [0, 100, 200, ..., 1000].
const uniformOrder = Array.from({ length: 10 }, (_, i) => `c${i}`);
const uniformWidths = Object.fromEntries(uniformOrder.map((name) => [name, 100]));
const uniformOffsets = columnOffsets(uniformOrder, uniformWidths);

describe('columnRangeExtractor (P47 D5) — the rangeExtractor seam replacing visibleColumnRange', () => {
  test('1. zero overscan returns exactly the visible range, inclusive endIndex', () => {
    expect(columnRangeExtractor({ startIndex: 3, endIndex: 5 }, uniformOffsets, 0, 100)).toEqual([
      3, 4, 5,
    ]);
  });

  test('2. expands each side by whole columns until the pixel budget is covered', () => {
    // 250px overscan over 100px columns needs 3 columns (300px >= 250px) on each side.
    expect(columnRangeExtractor({ startIndex: 5, endIndex: 5 }, uniformOffsets, 250, 100)).toEqual([
      2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  test('3. clamps at column 0 on the left and the last column on the right', () => {
    expect(columnRangeExtractor({ startIndex: 0, endIndex: 9 }, uniformOffsets, 1000, 100)).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
  });

  test('4. maxOverscanColumns caps expansion even when the pixel budget is unmet', () => {
    expect(columnRangeExtractor({ startIndex: 5, endIndex: 5 }, uniformOffsets, 10_000, 2)).toEqual(
      [3, 4, 5, 6, 7],
    );
  });

  test('5. a column is 40-480px, not a fixed unit: one wide column can satisfy the whole budget', () => {
    const varOrder = ['a', 'b', 'c', 'd'];
    const varOffsets = columnOffsets(varOrder, { a: 40, b: 480, c: 40, d: 40 });
    expect(columnRangeExtractor({ startIndex: 0, endIndex: 0 }, varOffsets, 100, 100)).toEqual([
      0, 1,
    ]);
  });

  test('6. a table with no columns extracts no range', () => {
    expect(columnRangeExtractor({ startIndex: 0, endIndex: 0 }, [0], 500, 100)).toEqual([]);
  });

  test('7. a single-column table clamps on both sides at once, without duplicating index 0', () => {
    const oneColOffsets = columnOffsets(['only'], { only: 100 });
    expect(columnRangeExtractor({ startIndex: 0, endIndex: 0 }, oneColOffsets, 560, 12)).toEqual([
      0,
    ]);
  });
});
