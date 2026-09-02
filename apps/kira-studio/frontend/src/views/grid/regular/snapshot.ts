import type { ColumnDescriptor, TabularPage } from '@shared/protocol/page';
import { pageColumnIndexFor } from '../../shared/page/columns';
import { cell } from '../page';
import { stagedValue } from '../pendingChanges';

/**
 * P22 regular-table spike — the render-pass snapshot.
 *
 * The one rule the whole bridge exists to hold (docs/ARCHITECTURE.md's "no Vue reactivity on row
 * data", and the SlickGrid plan's §6 D1 statement of it): nothing reachable from a `DataListener`
 * or a style pass may be a `ref`/`reactive`, and nothing may read `pageVersion` — both run *inside*
 * regular-table's render, where touching reactive state could re-enter it. The host resolves every
 * reactive input **once**, into this frozen plain object, and hands it over; the listener and the
 * style pass only ever read it.
 *
 * It is also what keeps the bridge O(1) per cell: `pageColumns` resolves the display -> page column
 * mapping once per snapshot instead of per cell, and `valueAt` below routes every read through the
 * app's existing `cell()` (page.ts), whose decode/view caches are what P5 C1's retained-bytes gate
 * measures. Nothing here materialises a row.
 */
export interface GridSnapshot {
  readonly tabId: string;
  readonly page: TabularPage | null;
  readonly columnOrder: readonly string[];
  /** Index into `page.columns`/`page.chunks` per display column; -1 for a column that is gone. */
  readonly pageColumns: readonly number[];
  readonly descriptors: readonly (ColumnDescriptor | undefined)[];
  /** Right-aligned (numeric) per display column — `alignmentFor`, resolved once. */
  readonly alignRight: readonly boolean[];
  /** Per-display-column type colour, '' when row colouring is off or the class has none. */
  readonly columnColors: readonly string[];
  /** search.ts's `matchedRows` — `null` when unfiltered, else the ascending visible page rows. */
  readonly displayRows: readonly number[] | null;
  /** `displayRows.length`, or the page's own `rowCount` when unfiltered. */
  readonly displayRowCount: number;
  /** Added to a page row index for the gutter's own number (earlier pages' rows). */
  readonly rowNumberBase: number;
  readonly rowHeight: number;
}

export const EMPTY_SNAPSHOT: GridSnapshot = Object.freeze({
  tabId: '',
  page: null,
  columnOrder: [],
  pageColumns: [],
  descriptors: [],
  alignRight: [],
  columnColors: [],
  displayRows: null,
  displayRowCount: 0,
  rowNumberBase: 0,
  rowHeight: 28,
});

export interface SnapshotInput {
  tabId: string;
  page: TabularPage | null;
  columnOrder: string[];
  displayRows: number[] | null;
  rowNumberBase: number;
  rowHeight: number;
  colorForColumn: (name: string) => string;
  alignmentFor: (descriptor: ColumnDescriptor) => 'left' | 'right';
}

export function buildSnapshot(input: SnapshotInput): GridSnapshot {
  const { page, columnOrder } = input;
  const pageColumns: number[] = [];
  const descriptors: (ColumnDescriptor | undefined)[] = [];
  const alignRight: boolean[] = [];
  const columnColors: string[] = [];
  const byName = new Map<string, ColumnDescriptor>();
  for (const c of page?.columns ?? []) byName.set(c.name, c);

  for (let i = 0; i < columnOrder.length; i++) {
    const name = columnOrder[i] as string;
    const descriptor = byName.get(name);
    pageColumns.push(page ? pageColumnIndexFor(page, columnOrder, i) : -1);
    descriptors.push(descriptor);
    alignRight.push(descriptor ? input.alignmentFor(descriptor) === 'right' : false);
    columnColors.push(input.colorForColumn(name));
  }

  return Object.freeze({
    tabId: input.tabId,
    page,
    columnOrder,
    pageColumns,
    descriptors,
    alignRight,
    columnColors,
    displayRows: input.displayRows,
    displayRowCount: input.displayRows ? input.displayRows.length : (page?.rowCount ?? 0),
    rowNumberBase: input.rowNumberBase,
    rowHeight: input.rowHeight,
  });
}

/** Display position -> page row index. Identity when unfiltered (P24 D3's own split). */
export function rowAtDisplayPosition(snapshot: GridSnapshot, pos: number): number {
  const dr = snapshot.displayRows;
  return dr ? (dr[pos] ?? pos) : pos;
}

/** Page row index -> display position. Mirrors DataGrid.vue's own binary search, including its
 *  "a row filtered out from under a live selection lands on the nearest visible one" fallback. */
export function displayPositionOf(snapshot: GridSnapshot, row: number): number {
  const dr = snapshot.displayRows;
  if (!dr) return row;
  let lo = 0;
  let hi = dr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((dr[mid] as number) < row) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, Math.max(0, dr.length - 1));
}

export interface CellValue {
  text: string;
  isNull: boolean;
  truncated: boolean;
  staged: boolean;
}

const NULL_VALUE: CellValue = Object.freeze({
  text: '',
  isNull: true,
  truncated: false,
  staged: false,
});

/**
 * The text regular-table renders into a pooled `<td>` — the hot path, called once per visible cell
 * per draw, and deliberately allocation-free.
 *
 * `cell()` (page.ts) memoises the decoded string per `(row, col)`, so a repeat read of the same
 * cell returns the **identical string reference**. That is what lets regular-table's `_draw_td`
 * skip its `textContent` write entirely (`if (metadata.value !== val)`, tbody.ts:58) for a cell
 * whose value did not change — the single most important property of this bridge, since it is what
 * makes a horizontal-only or partially-overlapping redraw cost nothing per unchanged cell.
 *
 * NULL renders as the literal string 'NULL' rather than the incumbent's `<span class="cell-null">`
 * child, because `_draw_td`'s element branch would `appendChild` a fresh node per NULL cell per
 * draw — exactly the per-cell DOM construction this spike exists to avoid. The style pass tags the
 * cell `.null`/`data-null` instead, and CSS supplies the muted italic treatment.
 */
export function textAt(snapshot: GridSnapshot, row: number, displayCol: number): string {
  const name = snapshot.columnOrder[displayCol];
  if (name === undefined) return NULL_TEXT;
  const staged = stagedValue(snapshot.tabId, row, name);
  if (staged !== undefined) return staged ?? NULL_TEXT;
  const pageCol = snapshot.pageColumns[displayCol] ?? -1;
  if (!snapshot.page || pageCol < 0) return NULL_TEXT;
  const view = cell(snapshot.tabId, row, pageCol);
  return view.isNull ? NULL_TEXT : view.text;
}

export const NULL_TEXT = 'NULL';

/**
 * One cell's full state, as DataGrid.vue's own `displayCell` resolves it: the staged-edit overlay
 * first, then the page's decode/view-cached `CellView`. Used by the style pass and by the context
 * menu / clipboard paths, never by the render hot path (see `textAt`).
 */
export function valueAt(snapshot: GridSnapshot, row: number, displayCol: number): CellValue {
  const name = snapshot.columnOrder[displayCol];
  if (name === undefined) return NULL_VALUE;
  const staged = stagedValue(snapshot.tabId, row, name);
  if (staged !== undefined) {
    return { text: staged ?? '', isNull: staged === null, truncated: false, staged: true };
  }
  const pageCol = snapshot.pageColumns[displayCol] ?? -1;
  if (!snapshot.page || pageCol < 0) return NULL_VALUE;
  const view = cell(snapshot.tabId, row, pageCol);
  return view.isNull
    ? NULL_VALUE
    : { text: view.text, isNull: false, truncated: view.truncated, staged: false };
}
