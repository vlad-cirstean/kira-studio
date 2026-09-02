// dataSource.ts transitively imports pendingChanges.ts -> bridge/data.ts -> bridge/port.ts, which
// reaches '/wails/runtime.js' at module scope — see support/window.ts's own comment for why this
// import must come first, and why dataSource.ts itself is a dynamic import below rather than a
// static one (sigma-count-refresh.spec.ts's own precedent for the same hazard).
import './support/window';

import { describe, expect, test } from 'bun:test';

const { dataLength, rowHandleAt } = await import('../../frontend/src/views/grid/slick/dataSource');
type DisplayRowIndex = Parameters<typeof rowHandleAt>[0];

// P22 spike C3: display-position <-> page-row translation across a filter, the insert-row region
// past the page end, and the "handle must be truthy" invariant — exactly AGENTS.md's own bar for a
// dedicated unit test ("cursor/pagination arithmetic with real boundary cases").

describe('rowHandleAt/dataLength (P22 spike D1) — display-position -> RowHandle translation', () => {
  test('1. unfiltered: identity — pos === row, no insertId', () => {
    const idx: DisplayRowIndex = { displayRows: null, pageRowCount: 100 };
    expect(rowHandleAt(idx, [], 0)).toEqual({ row: 0, pos: 0 });
    expect(rowHandleAt(idx, [], 42)).toEqual({ row: 42, pos: 42 });
    expect(dataLength(idx, 0)).toBe(100);
  });

  test('2. filtered: a display position maps through displayRows to its page row', () => {
    const idx: DisplayRowIndex = { displayRows: [3, 7, 9, 40], pageRowCount: 100 };
    expect(rowHandleAt(idx, [], 0)).toEqual({ row: 3, pos: 0 });
    expect(rowHandleAt(idx, [], 2)).toEqual({ row: 9, pos: 2 });
    expect(rowHandleAt(idx, [], 3)).toEqual({ row: 40, pos: 3 });
    expect(dataLength(idx, 0)).toBe(4);
  });

  test('3. the insert region starts exactly at displayRowCount and carries the insert id', () => {
    const idx: DisplayRowIndex = { displayRows: null, pageRowCount: 10 };
    const inserts = [{ id: 'a' }, { id: 'b' }];
    // Position 10 (the first past the 10 real rows) is the first insert.
    expect(rowHandleAt(idx, inserts, 10)).toEqual({ row: 10, pos: 10, insertId: 'a' });
    expect(rowHandleAt(idx, inserts, 11)).toEqual({ row: 11, pos: 11, insertId: 'b' });
    expect(dataLength(idx, inserts.length)).toBe(12);
  });

  test("4. the insert region's row identity is page.rowCount + offset, matching onPaste's own rule", () => {
    // A filter shrinks the display-row count but the insert region's row identity is still keyed
    // off pageRowCount (the real row count), not the filtered display count (P24 D5's own rule,
    // reused here — see DataGrid.vue's own template comment on the pending-insert row's identity).
    const idx: DisplayRowIndex = { displayRows: [3, 7], pageRowCount: 100 };
    const inserts = [{ id: 'only' }];
    expect(rowHandleAt(idx, inserts, 2)).toEqual({ row: 100, pos: 2, insertId: 'only' });
  });

  test('5. an insert position past the known inserts array still returns a truthy, frozen handle', () => {
    // F1's own guard: appendCellHtml/appendRowHtml require getItem to return something truthy for
    // every position getLength() reports — a stale count must never produce a falsy handle.
    const idx: DisplayRowIndex = { displayRows: null, pageRowCount: 5 };
    const handle = rowHandleAt(idx, [], 5);
    expect(handle).toBeTruthy();
    expect(Object.isFrozen(handle)).toBe(true);
    expect(handle.insertId).toBeUndefined();
  });

  test('6. every handle produced is frozen — nothing downstream can mutate a RowHandle', () => {
    const idx: DisplayRowIndex = { displayRows: [1, 2, 3], pageRowCount: 10 };
    expect(Object.isFrozen(rowHandleAt(idx, [], 1))).toBe(true);
    expect(Object.isFrozen(rowHandleAt(idx, [{ id: 'x' }], 3))).toBe(true);
  });

  test('7. an empty page (no rows, no inserts) has zero length and the boundary position is still handled', () => {
    const idx: DisplayRowIndex = { displayRows: null, pageRowCount: 0 };
    expect(dataLength(idx, 0)).toBe(0);
    const handle = rowHandleAt(idx, [], 0);
    expect(handle).toEqual({ row: 0, pos: 0 });
  });
});
