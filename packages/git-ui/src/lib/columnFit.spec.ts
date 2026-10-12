import { describe, expect, test } from 'bun:test';
import { type ColumnFitInput, fitColumns, maxDragWidth } from './columnFit.ts';

const base: ColumnFitInput = {
  stored: { graph: 95, author: 120, date: 100 },
  available: 800,
  graphFloor: 40,
  graphAuto: false,
  minAuthor: 40,
  minDate: 60,
  minMessage: 120,
  compact: false,
};
const with_ = (over: Partial<ColumnFitInput>): ColumnFitInput => ({ ...base, ...over });

describe('fitColumns', () => {
  const cases: readonly [string, ColumnFitInput, Record<string, number>][] = [
    ['fits untouched', base, { graph: 95, author: 120, date: 100, message: 485 }],
    [
      'shrinks author first',
      with_({ available: 400 }),
      { graph: 95, author: 85, date: 100, message: 120 },
    ],
    [
      'then date once author hits its minimum',
      with_({ available: 300 }),
      { graph: 95, author: 40, date: 60, message: 105 },
    ],
    [
      'sub-minimum viewport: message 0, graph kept',
      with_({ available: 150 }),
      { graph: 95, author: 40, date: 60, message: 0 },
    ],
    [
      'compact ignores author and date',
      with_({ compact: true, available: 300 }),
      { graph: 95, author: 120, date: 100, message: 205 },
    ],
    [
      'auto mode uses the floor even below stored',
      with_({ graphAuto: true, graphFloor: 56 }),
      { graph: 56, author: 120, date: 100, message: 524 },
    ],
    [
      'user mode uses max(stored, floor)',
      with_({ graphFloor: 120 }),
      { graph: 120, author: 120, date: 100, message: 460 },
    ],
  ];
  test.each(cases)('%s', (_name, input, expected) => {
    expect(fitColumns(input)).toMatchObject(expected);
  });
});

describe('maxDragWidth', () => {
  const full = fitColumns(base);
  test('full mode leaves minMessage', () => {
    expect(maxDragWidth('graph', full, base)).toBe(800 - 120 - 220);
    expect(maxDragWidth('author', full, base)).toBe(800 - 120 - 195);
    expect(maxDragWidth('date', full, base)).toBe(800 - 120 - 215);
  });
  test('compact counts only the graph', () => {
    const input = with_({ compact: true });
    const fit = fitColumns(input);
    expect(maxDragWidth('graph', fit, input)).toBe(600);
    expect(maxDragWidth('author', fit, input)).toBe(800 - 120 - 95);
  });
  test('never below the column minimum or above 600', () => {
    const tight = with_({ available: 200 });
    expect(maxDragWidth('graph', fitColumns(tight), tight)).toBe(40);
    const wide = with_({ available: 3000 });
    expect(maxDragWidth('date', fitColumns(wide), wide)).toBe(600);
  });
});
