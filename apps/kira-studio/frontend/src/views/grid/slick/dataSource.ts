import type { TabularPage } from '@shared/protocol/page';
import { pageColumnIndexFor } from '../../shared/page/columns';
import type { RowHandle } from '../../shared/slick/dataSource';
import { type CellView, cell } from '../page';
import { pendingFor, stagedValue } from '../pendingChanges';

// P30 §3 prerequisite: the generic display-position/`CustomDataView` core that used to live in
// this one file moved to `views/shared/slick/dataSource.ts` (SPEC §11 — `views/console/*` may not
// import `views/grid/*`, and that core has no dependency on a data tab in the first place). This
// file keeps only what genuinely does: `createDisplayValueExtractor`/`pendingRowClasses` both read
// `pendingChanges.ts`. Re-exported verbatim so `SlickGridHost.vue`'s own import
// (`from './slick/dataSource'`) is untouched.
export * from '../../shared/slick/dataSource';

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
// C10/§4 item 18 — the third case Pass A's own stale comment already promised, checked first: a
// pending-insert row is never simultaneously a real, deleted, or dirty page row (it has no page
// row at all — `row` here is `pageRowAt`'s own pseudo-row-number past `pageRowCount`, D1's insert
// region), so it can never collide with the other two. `pending-delete` is DataGrid.vue's own
// literal class name (`GridRow.vue:41` — the strike-through/opacity rule), added alongside
// `kira-row-deleted` (this file's own rail-only class, `slickTheme.css`'s `.kira-gutter::before`
// selector) rather than replacing it — the two mechanisms are independent and this pass ports both.
export function pendingRowClasses(
  tabId: string,
  row: number,
  pageRowCount: number,
): string | undefined {
  if (row >= pageRowCount) return 'kira-row-inserted';
  const p = pendingFor(tabId);
  if (!p) return undefined;
  if (p.deletes.has(row)) return 'kira-row-deleted pending-delete';
  if (p.edits.has(row)) return 'kira-row-dirty';
  return undefined;
}
