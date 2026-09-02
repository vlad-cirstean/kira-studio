import { describe, expect, test } from 'bun:test';
import { type RowSig, sameRowSig } from '../../frontend/src/views/grid/rowVm';

// P22 iter2 D4(ii): DataGrid.vue's renderRows reuses a row's previous RowVM object — the mechanism
// GridRow.vue's whole reference-stability bail-out depends on (rowVm.ts's own comment, F11) — only
// when sameRowSig says nothing relevant to that row changed. This is a "cache invalidation with
// rules that interact" per AGENTS.md's own test-worthy bar: eleven fields, each independently
// load-bearing, and it is exactly the kind of thing that quietly stops repainting a cell rather
// than throwing when one is missed — two real omissions (pageVersion, columnOrder) were only found
// by tests/ui/data-view.spec.ts and tests/ui/mutations.spec.ts going stale during development.

function baseSig(): RowSig {
  return {
    pageVersion: 1,
    pos: 5,
    gutterBase: 0,
    dirty: false,
    deleted: false,
    editingCol: -1,
    stagedEdit: undefined,
    cols: [0, 1, 2],
    columnOrder: ['a', 'b', 'c'],
    selection: null,
    matches: null,
    meta: null,
    rowColoring: false,
  };
}

describe('sameRowSig (P22 iter2 D4) — the reference-stability cache invalidation rule', () => {
  test('1. the exact same signature object compares equal to itself', () => {
    const sig = baseSig();
    expect(sameRowSig(sig, sig)).toBe(true);
  });

  test('2. an unrelated field, unchanged, does not defeat equality — a genuine cache-hit case', () => {
    // Same base object's own references (cols/columnOrder/selection/matches/meta) shared across
    // both sides — the realistic "renderRows called again, nothing about this row moved" case.
    const shared = baseSig();
    const a = { ...shared };
    const b = { ...shared, pos: a.pos }; // touches a field, writes back the identical value
    expect(sameRowSig(a, b)).toBe(true);
  });

  const fieldChanges: [keyof RowSig, unknown][] = [
    ['pageVersion', 2],
    ['pos', 6],
    ['gutterBase', 100],
    ['dirty', true],
    ['deleted', true],
    ['editingCol', 1],
    ['stagedEdit', { row: 5, changes: { a: '1' } }],
    ['cols', [0, 1, 2]], // a *new* array, same contents — reference changed, must invalidate
    ['columnOrder', ['a', 'b', 'c']], // same: reordering keeps content-equal but reference-new
    ['selection', { kind: 'cell', row: 5, col: 0 }],
    ['matches', {}],
    ['meta', {}],
    ['rowColoring', true],
  ];

  for (const [field, changedValue] of fieldChanges) {
    test(`3. every field is load-bearing — changing only "${field}" breaks equality`, () => {
      // Both sides share one base object's own references for every *other* field, so only the
      // named field actually differs between a and b.
      const shared = baseSig();
      const a = { ...shared };
      const b = { ...shared, [field]: changedValue };
      expect(sameRowSig(a, b)).toBe(false);
    });
  }

  test('4. reference fields (cols/columnOrder/selection/matches/meta) compare by identity, not by value', () => {
    // Two *different* array instances with identical contents must NOT compare equal — this is
    // deliberate (RowSig's own doc comment: cheap references, never a deep comparison), so this
    // locks in that the comparison really is === and not a content-aware equality that would
    // silently reintroduce the deep-comparison cost D4 exists to avoid.
    const shared = baseSig();
    const a = { ...shared, cols: [1, 2, 3] };
    const b = { ...shared, cols: [1, 2, 3] };
    expect(a.cols).not.toBe(b.cols); // sanity: genuinely different references
    expect(sameRowSig(a, b)).toBe(false);
  });

  test('5. the same object reference reused for a reference field compares equal (the cache-hit path)', () => {
    const shared = baseSig();
    const sharedCols = [4, 5, 6];
    const a = { ...shared, cols: sharedCols };
    const b = { ...shared, cols: sharedCols };
    expect(sameRowSig(a, b)).toBe(true);
  });

  test('6. stagedEdit undefined-vs-undefined (no staged edit on this row, either side) compares equal', () => {
    const shared = baseSig();
    const a = { ...shared, stagedEdit: undefined };
    const b = { ...shared, stagedEdit: undefined };
    expect(sameRowSig(a, b)).toBe(true);
  });
});
