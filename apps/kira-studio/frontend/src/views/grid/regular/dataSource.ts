import { GUTTER_WIDTH } from '../../shared/page/columns';
import { type GridSnapshot, rowAtDisplayPosition, textAt } from './snapshot';

/** regular-table's own `CellScalar`, restated so this file imports no types from the library. */
type CellScalar = number | string | boolean | null;

/** The subset of regular-table's `DataResponse` this bridge produces (dist/esm/types.d.ts:215). */
export interface WindowResponse {
  data: CellScalar[][];
  num_columns: number;
  num_rows: number;
  row_height: number;
  row_headers: CellScalar[][];
  column_headers: CellScalar[][];
  num_row_headers: number;
  num_column_headers: number;
}

/**
 * P22 regular-table spike — the data-source seam, following the same shape the SlickGrid plan's
 * §6 D1 established: every cell access routes through the app's **existing** frozen-page /
 * decode-cache / staged-edit pipeline (`page.ts`'s `cell()`, via `snapshot.ts`'s `textAt`), and no
 * row is ever materialised.
 *
 * The one difference from SlickGrid's seam is imposed by regular-table's API rather than chosen:
 * `DataListener` is `(x0, y0, x1, y1) => Promise<DataResponse>` and `DataResponse.data` is
 * *columnar* (`data[x][y]`), so the bridge does build one array per visible column per draw. That
 * is O(visible window), not O(page) — roughly 15 arrays of ~30 strings for a full window — and
 * every element in them is a memoised string the decode cache already owns, so nothing is decoded,
 * copied or allocated per *cell*. The arrays are deliberately freshly allocated rather than pooled:
 * regular-table's own `_fetchMissingColumns` can call the listener a second time *within one draw*
 * and concatenate both responses' `data`, so a pooled buffer keyed by relative column index would
 * alias across the two halves of a single render.
 */
export function createDataListener(
  getSnapshot: () => GridSnapshot,
): (x0: number, y0: number, x1: number, y1: number) => Promise<WindowResponse> {
  return (x0, y0, x1, y1) => {
    const snapshot = getSnapshot();
    const numColumns = snapshot.columnOrder.length;
    const numRows = snapshot.displayRowCount;

    const startCol = Math.max(0, Math.min(x0, numColumns));
    const endCol = Math.max(startCol, Math.min(x1, numColumns));
    const startRow = Math.max(0, Math.min(y0, numRows));
    const endRow = Math.max(startRow, Math.min(y1, numRows));

    const data: CellScalar[][] = [];
    for (let x = startCol; x < endCol; x++) {
      const column: CellScalar[] = [];
      for (let pos = startRow; pos < endRow; pos++) {
        column.push(textAt(snapshot, rowAtDisplayPosition(snapshot, pos), x));
      }
      data.push(column);
    }

    // One level of row headers: the gutter's own row number (P24 D4 — the row's position in the
    // whole result set, so it must add back the rows earlier pages skipped).
    const rowHeaders: CellScalar[][] = [];
    for (let pos = startRow; pos < endRow; pos++) {
      rowHeaders.push([String(rowAtDisplayPosition(snapshot, pos) + snapshot.rowNumberBase + 1)]);
    }

    const columnHeaders: CellScalar[][] = [];
    for (let x = startCol; x < endCol; x++) columnHeaders.push([snapshot.columnOrder[x] ?? '']);

    return Promise.resolve({
      data,
      num_columns: numColumns,
      num_rows: numRows,
      // Returned rather than left to regular-table's own hidden-probe measurement
      // (`_probe_row_height`, scroll_panel.ts): the app already owns the density setting, and a
      // measured value would make the whole virtual-panel height depend on a forced layout.
      row_height: snapshot.rowHeight,
      row_headers: rowHeaders,
      column_headers: columnHeaders,
      num_row_headers: 1,
      num_column_headers: 1,
    });
  };
}

/**
 * The `size_key -> px` override map regular-table's `restoreColumnSizes` takes, built from the
 * app's own measured/stored widths so the two engines lay out identically and an A/B cannot be
 * won by rendering narrower columns.
 *
 * `size_key` is `row_headers_length + display column` (table.ts:240,
 * `size_key = _virtual_x + Math.floor(x0)`), so key 0 is the gutter and key `1 + c` is display
 * column `c`.
 */
export function columnSizeOverrides(
  columnOrder: readonly string[],
  widths: Record<string, number>,
): Record<number, number> {
  const sizes: Record<number, number> = { 0: GUTTER_WIDTH };
  for (let c = 0; c < columnOrder.length; c++) {
    const width = widths[columnOrder[c] as string];
    if (width !== undefined) sizes[c + 1] = width;
  }
  return sizes;
}
