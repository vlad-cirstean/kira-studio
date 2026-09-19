// P94 pass 3 §4.3, shape 4 first pattern: SlickGridHost.vue's onPaste's pure target-resolution
// and cell-staging logic, lifted out with everything it needs passed in explicitly (§4.2) —
// never reaching back into the SFC's own reactive scope. The SFC keeps the guard clauses, the
// clipboard read, and these two calls.
import type { TabularPage } from '@shared/protocol/page';
import type { Selection } from '../shared/slick/selection';
import { addInsertRow, pendingFor, stageEdit, stageInsertValue } from './pendingChanges';
import { pasteTargetRows } from './slick/rowValues';

export interface PasteTarget {
  startCol: number;
  /** The page row a pasted row `ri` (0-based, within the clipboard's own rows) lands on, or
   *  `undefined`/negative to skip it (a `range` paste's own target list can run out before the
   *  clipboard does, `pasteTargetRows`'s own contract). */
  rowAt: (ri: number) => number | undefined;
}

/** D5/finding 3 round 2's target resolution: `startRow`/`startCol` come from the selection's own
 *  anchor (row-kind starts at its lowest row and column 0); only a `range` paste needs
 *  `pasteTargetRows`'s filtered-rows walk — a `cell` paste only ever grows downward from one
 *  already-visible row, and a `row` paste targets the user's own explicit gutter-click rows,
 *  neither affected by the active filter the same way a contiguous range would be. */
export function resolvePasteTarget(
  sel: Extract<Selection, { kind: 'cell' | 'range' | 'row' }>,
  page: TabularPage,
  displayRows: readonly number[] | null,
  pastedRowCount: number,
): PasteTarget {
  const startRow =
    sel.kind === 'row' ? Math.min(...sel.rows) : sel.kind === 'range' ? sel.anchorRow : sel.row;
  const startCol = sel.kind === 'row' ? 0 : sel.kind === 'range' ? sel.anchorCol : sel.col;
  const rangeTargetRows =
    sel.kind === 'range'
      ? pasteTargetRows(displayRows, page.rowCount, startRow, pastedRowCount)
      : null;
  return {
    startCol,
    rowAt: (ri) => (rangeTargetRows ? rangeTargetRows[ri] : startRow + ri),
  };
}

function columnIsGenerated(page: TabularPage, name: string): boolean {
  return page.columns.find((c) => c.name === name)?.generated ?? false;
}

/** One clipboard row's own cells, staged at `startCol..` — an existing page row via `stageEdit`,
 *  a new one (`isNewRow`) via `stageInsertValue`, skipping a generated column either way. */
function stagePastedRow(
  tabId: string,
  page: TabularPage,
  columns: readonly string[],
  startCol: number,
  row: number,
  isNewRow: boolean,
  insertId: string | undefined,
  cols: readonly string[],
): void {
  for (let ci = 0; ci < cols.length; ci++) {
    const name = columns[startCol + ci];
    if (!name) continue;
    if (isNewRow) {
      if (insertId && !columnIsGenerated(page, name)) {
        stageInsertValue(tabId, insertId, name, cols[ci] as string);
      }
    } else {
      stageEdit(tabId, row, name, cols[ci] as string);
    }
  }
}

/** Stages every pasted cell (`parsed`, one string[] per clipboard row) at `target`'s rows/
 *  columns — an existing page row via `stageEdit`, a new row (`row >= page.rowCount`) via
 *  `addInsertRow`/`stageInsertValue`. P2 R2: a paste landing on a display row that already has a
 *  staged insert updates that insert's `values` in place rather than always appending a sibling
 *  — `pending.inserts` is positional (`inserts[row - page.rowCount]`). Returns every display row
 *  whose insert (new or already-staged) this call touched — the caller's own render/invalidate
 *  pass needs both (C9/§5 D9 rule 1: a reused insert's `<input>` needs invalidating too). */
export function applyPastedCells(
  tabId: string,
  page: TabularPage,
  columns: readonly string[],
  target: PasteTarget,
  parsed: readonly (readonly string[])[],
): ReadonlySet<number> {
  // P36 D28: the server computes a generated column's value — an explicit paste into one is
  // silently dropped rather than staged into an insert the server would then reject outright.
  const insertColumns = columns.filter((name) => !columnIsGenerated(page, name));
  const insertIds = new Map<number, string>();
  const pending = pendingFor(tabId);

  for (let ri = 0; ri < parsed.length; ri++) {
    const row = target.rowAt(ri);
    if (row === undefined || row < 0) continue;
    const isNewRow = row >= page.rowCount;
    let insertId = insertIds.get(row);
    if (isNewRow && insertId === undefined) {
      insertId = pending?.inserts[row - page.rowCount]?.id ?? addInsertRow(tabId, insertColumns);
      insertIds.set(row, insertId);
    }
    stagePastedRow(tabId, page, columns, target.startCol, row, isNewRow, insertId, parsed[ri]);
  }
  return new Set(insertIds.keys());
}
