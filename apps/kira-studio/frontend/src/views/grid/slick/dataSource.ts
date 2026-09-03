import type { TabularPage } from '@shared/protocol/page';
import { pageColumnIndexFor } from '../../shared/page/columns';
import { type CellView, cell } from '../page';
import type { PendingInsert } from '../pendingChanges';
import { pendingFor, stagedValue } from '../pendingChanges';

// P22 spike, §6 D1 — the load-bearing decision this migration lives or dies on: SlickGrid's own
// `CustomDataView` seam over the app's EXISTING frozen-page/decode-cache/staged-edit pipeline,
// never a materialised row array (that is `SlickDataView`'s job, declined — F9/§4). Nothing here
// is Vue-reactive; `docs/ARCHITECTURE.md`'s "no Vue reactivity on row data" invariant holds by
// construction because `RowHandle` is a plain frozen object and `GridDataSourceState` is a plain
// object the host swaps by reassignment, never a `ref`/`reactive`.

/** What SlickGrid hands a formatter/extractor as the rendered row's "item" — never a materialised
 *  row. `row` is the page-row index every other subsystem (selection, pending changes, search, the
 *  gutter number) addresses a row by; `pos` is display position only (pixel placement / SlickGrid's
 *  own row index), equal to `row` unless a filter is hiding non-matching rows (P24 D3/D4's own
 *  split, reused verbatim). Frozen: nothing downstream may treat this as a mutable row. */
export interface RowHandle {
  readonly row: number;
  readonly pos: number;
  /** A pending insert's id, when this position is past the loaded page (D1's insert region). */
  readonly insertId?: string;
}

/** The display-position space this grid renders in: `displayRows` (ascending page-row indices)
 *  when a filter is hiding non-matching rows, `null` when unfiltered — DataGrid.vue's own
 *  `displayPositionOf`/`rowAtDisplayPosition` split (P24 D3/D4), reused rather than re-derived. */
export interface DisplayRowIndex {
  readonly displayRows: readonly number[] | null;
  readonly pageRowCount: number;
}

function displayRowCount(idx: DisplayRowIndex): number {
  return idx.displayRows ? idx.displayRows.length : idx.pageRowCount;
}

/** Total display length: real (possibly filtered) rows plus any pending inserts past the end. */
export function dataLength(idx: DisplayRowIndex, insertCount: number): number {
  return displayRowCount(idx) + insertCount;
}

/**
 * Display position -> `RowHandle`, across the filter and into the pending-insert region past the
 * last display row — mirrors DataGrid.vue's `rowAtDisplayPosition` plus its own
 * `page.rowCount + idx` insert-identity rule (`onPaste`'s own comment). The one place this
 * translation lives for the Slick engine (D1 bullet 4): `getLength`/`getItem` below are its only
 * callers, replacing `displayPositionOf`/`rowAtDisplayPosition`'s use inside the old virtualizer.
 */
/** P22 iter2-pacing D6 — the row-identity arithmetic alone, without allocating/freezing a
 *  RowHandle. `rowHandleAt` below is defined in terms of this so the two paths can never drift
 *  apart; `getItemMetadata` (createGridDataSource, below) uses this directly so a rendered row
 *  only pays for one frozen RowHandle allocation (getItem's), not two (§4.4 item 4 of that plan —
 *  appendRowHtml calls getDataItem AND getItemMetadaWhenExists per newly-built row, and the latter
 *  never needed a full handle, only the row number). */
function pageRowAt(idx: DisplayRowIndex, pos: number): number {
  const count = displayRowCount(idx);
  if (pos >= count) return idx.pageRowCount + (pos - count);
  return idx.displayRows ? (idx.displayRows[pos] ?? pos) : pos;
}

/** P22 Pass B, C4/§5 D4 — display position -> page row, exported: `selection.ts`'s own
 *  `SlickRange`<->`Selection` translation needs exactly this arithmetic (a `SlickRange`'s
 *  row fields are always display positions — SlickGrid indexes the `CustomDataView` it was
 *  handed, never a page row), and it must be the SAME arithmetic `getItem`/`getItemMetadata`
 *  use, not a second implementation that could drift from it. Identity while nothing is
 *  filtered (`idx.displayRows === null`), which is Pass B's whole state until C12 wires a live
 *  search filter — this function is correct for that case by construction, not by luck. */
export function rowAtDisplayPosition(idx: DisplayRowIndex, pos: number): number {
  return pageRowAt(idx, pos);
}

/** The inverse of `rowAtDisplayPosition` — page row -> display position. Mirrors DataGrid.vue's
 *  own `displayPositionOf` (P24 D3/D5/D6/D11): `displayRows` is always ascending (matchedRows'
 *  own contract), so an exact hit (the common case — the row is visible) is a binary search, and
 *  a miss (the row was just filtered out from under a live selection) falls through to the
 *  position it would sort into, landing on the nearest visible row instead of doing nothing. */
export function displayPositionOf(idx: DisplayRowIndex, row: number): number {
  const count = displayRowCount(idx);
  if (row >= idx.pageRowCount) return count + (row - idx.pageRowCount); // pending insert
  const dr = idx.displayRows;
  if (!dr) return row; // unfiltered: identity
  let lo = 0;
  let hi = dr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((dr[mid] as number) < row) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, Math.max(0, dr.length - 1));
}

export function rowHandleAt(
  idx: DisplayRowIndex,
  inserts: readonly Pick<PendingInsert, 'id'>[],
  pos: number,
): RowHandle {
  const count = displayRowCount(idx);
  const row = pageRowAt(idx, pos);
  if (pos >= count) {
    const insert = inserts[pos - count];
    return Object.freeze({ row, pos, insertId: insert?.id });
  }
  return Object.freeze({ row, pos });
}

/** The mutable state a `KiraGridDataSource` reads on every `getItem`/`getLength`/`getItemMetadata`/
 *  `extractValue` call — a plain object the host (SlickGridHost.vue) reassigns wholesale via
 *  `setState` on a relevant change (page reload, filter, a staged insert), and never a Vue
 *  `ref`/`reactive` (D1's own rule: the extractor and formatter run *during* SlickGrid's own
 *  render, and must never touch Vue reactivity whose mutation could re-enter it).
 *
 *  `extractValue` itself lives in this state (not a separate, one-time constructor argument) for a
 *  load-bearing reason: SlickGrid's own `dataItemColumnValueExtractor` grid option is captured
 *  *once*, at construction — routing it through this mutable state (via `KiraGridDataSource.
 *  extractValue`, below) is what lets a page reload's new decode/staged-edit closure actually reach
 *  the grid without reconstructing the whole instance. A first version of this file passed
 *  `extractValue` as a separate constructor argument instead; every cell after the first page
 *  reload silently kept reading the *original* (often `page === null`, "everything is NULL")
 *  closure, because the grid's own option object is fixed at construction and was never the one
 *  being updated — confirmed against a real render, not merely reasoned about. */
export interface GridDataSourceState {
  index: DisplayRowIndex;
  inserts: readonly Pick<PendingInsert, 'id'>[];
  /** Per-page-row CSS classes (the dirty/deleted/inserted gutter rails, §5 item 18) — `undefined`
   *  renders no metadata for that row, matching `getItemMetadata`'s own `| null` contract. */
  rowClasses?: (row: number) => string | undefined;
  /** The current `dataItemColumnValueExtractor` body — see this interface's own header comment. */
  extractValue: (item: RowHandle, field: string) => unknown;
}

export interface KiraGridDataSource {
  getLength(): number;
  getItem(pos: number): RowHandle;
  getItemMetadata(pos: number): { cssClasses?: string } | null;
  /**
   * The current state's own `extractValue`, keyed by `RowHandle` directly — the exact shape
   * SlickGrid's own `dataItemColumnValueExtractor` option calls with (`item`, not a position; that
   * grid option receives the *already-resolved* item, not an index to resolve). The host's grid
   * option is set to this method once, at construction, and stays correct across every later
   * `setState` because this method reads live `state`, not a captured closure — see
   * `GridDataSourceState`'s own header comment for why that distinction is load-bearing.
   */
  extractValue(item: RowHandle, field: string): unknown;
  /**
   * F1's own insurance, not a real render-path seam (the render path is `extractValue`/
   * `dataItemColumnValueExtractor`, above): a future call site — or SlickGrid's own
   * `autosizeColumns`, left off via `autosizeColsMode: LegacyOff` but still a public method someone
   * could call — that reaches for `getCellValue` gets the extractor's own answer instead of
   * silently falling through to `getDataItem(i)[field]`, which would read `undefined` for every
   * column on a `RowHandle` that only ever has `row`/`pos`/`insertId`.
   */
  getCellValue(index: number, field: string): unknown;
}

/**
 * A stable `CustomDataView` over frozen pages. Never materialises a row, never allocates one for a
 * row SlickGrid isn't actually building — a retained row is never revisited (F2), so this object's
 * own identity, and the `state` it closes over, are the only things that change across a render.
 */
export function createGridDataSource(
  initialState: GridDataSourceState,
): KiraGridDataSource & { setState(next: GridDataSourceState): void } {
  let state = initialState;
  return {
    setState(next) {
      state = next;
    },
    getLength() {
      return dataLength(state.index, state.inserts.length);
    },
    getItem(pos) {
      return rowHandleAt(state.index, state.inserts, pos);
    },
    getItemMetadata(pos) {
      if (!state.rowClasses) return null;
      // P22 iter2-pacing D6: the row number alone, not a second frozen RowHandle allocation — see
      // pageRowAt's own comment.
      const cssClasses = state.rowClasses(pageRowAt(state.index, pos));
      return cssClasses ? { cssClasses } : null;
    },
    extractValue(item, field) {
      return state.extractValue(item, field);
    },
    getCellValue(pos, field) {
      return state.extractValue(rowHandleAt(state.index, state.inserts, pos), field);
    },
  };
}

/**
 * Builds the `dataItemColumnValueExtractor` closure itself (§6 D1's pseudocode) — routes every cell
 * access through the app's EXISTING decode/cache/staged-edit pipeline: `page.ts`'s `cell()` (which
 * memoises both the decoded string and the built `CellView`, `store.ts`'s `cachedView`) layered with
 * `pendingChanges.ts`'s `stagedValue()`, exactly as DataGrid.vue's own `displayCell` does — nothing
 * about that pipeline is rebuilt here, only re-entered. `fieldToPageCol` is resolved once per
 * column-order rebuild (not per cell) via the same `pageColumnIndexFor` DataGrid.vue itself calls,
 * so a repeat lookup for an already-decoded cell is allocation-free (page.ts's own memoisation) and
 * a repeat lookup for a column position is an O(1) map read.
 */
export function createDisplayValueExtractor(
  tabId: string,
  page: TabularPage,
  columnOrder: string[],
): (item: RowHandle, field: string) => CellView {
  const fieldToPageCol = new Map<string, number>();
  for (let i = 0; i < columnOrder.length; i++) {
    fieldToPageCol.set(columnOrder[i], pageColumnIndexFor(page, columnOrder, i));
  }
  return (item, field) => {
    if (item.insertId !== undefined) {
      const value = pendingFor(tabId)?.inserts.find((i) => i.id === item.insertId)?.values[field];
      return { text: value ?? '', isNull: value === null || value === undefined, truncated: false };
    }
    const staged = stagedValue(tabId, item.row, field);
    if (staged !== undefined) {
      return { text: staged ?? '', isNull: staged === null, truncated: false };
    }
    const pageCol = fieldToPageCol.get(field) ?? -1;
    if (pageCol < 0) return { text: '', isNull: true, truncated: false };
    return cell(tabId, item.row, pageCol);
  };
}

/** The dirty/deleted-rail source for `GridDataSourceState.rowClasses` (§5 item 18) — a page row
 *  index in, the same two mutually-exclusive rail classes GridRow.vue's own CSS already draws
 *  (`.gutter-cell.dirty`/`.gutter-cell.deleted`, ported verbatim in `slickTheme.css`). */
export function pendingRowClasses(tabId: string, row: number): string | undefined {
  const p = pendingFor(tabId);
  if (!p) return undefined;
  if (p.deletes.has(row)) return 'kira-row-deleted';
  if (p.edits.has(row)) return 'kira-row-dirty';
  return undefined;
}
