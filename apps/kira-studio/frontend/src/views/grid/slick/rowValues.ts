import type { ObjectMeta } from '@shared/domain/tree';
import type { TabularPage } from '@shared/protocol/page';
import type { MenuItem } from '../../../state/contextMenu';
import type { RowSnapshot } from '../../shared/clipboardFormats';
import { pageColumnIndexFor } from '../../shared/page/columns';
import type { SqlDialect } from '../../shared/sqlIdent';
import { type FkNavContext, foreignKeyNavItems, referencedByItems } from '../menu';
import { cell } from '../page';
import { stagedValue } from '../pendingChanges';

// P22 Pass B, C7/§5 D7 — the small module DataGrid.vue kept inline, extracted so both the three
// context menus and the clipboard (this commit) and the FK/PK nav button (C11) can share one copy
// of it, and so DataGrid.vue can be deleted in one commit later rather than picked apart. §1's
// line, applied: no SlickGrid API appears anywhere in this file — every function here is content,
// the same behaviour DataGrid.vue's own identically-named methods had, taking the page/column
// order/tabId it used to close over as plain parameters instead.

export interface DisplayCellView {
  text: string;
  isNull: boolean;
  truncated: boolean;
  staged: boolean;
}

/** Merges a staged edit over the real page value for display — never touches the underlying
 *  page/decode cache, which stays the server's own last-read value until commit/discard. */
export function displayCell(
  tabId: string,
  page: TabularPage | null,
  order: readonly string[],
  row: number,
  displayCol: number,
): DisplayCellView {
  const name = order[displayCol];
  const staged = name ? stagedValue(tabId, row, name) : undefined;
  if (staged !== undefined) {
    return { text: staged ?? '', isNull: staged === null, truncated: false, staged: true };
  }
  if (!page) return { text: '', isNull: true, truncated: false, staged: false };
  const pageCol = pageColumnIndexFor(page, order as string[], displayCol);
  if (pageCol < 0) return { text: '', isNull: true, truncated: false, staged: false };
  const view = cell(tabId, row, pageCol);
  return { ...view, staged: false };
}

/** The row's effective values across the whole display column order — reused by row copy and
 *  Duplicate row. */
export function rowSnapshot(
  tabId: string,
  page: TabularPage | null,
  order: readonly string[],
  row: number,
): RowSnapshot {
  const values: Record<string, string | null> = {};
  for (let c = 0; c < order.length; c++) {
    const name = order[c] as string;
    const dc = displayCell(tabId, page, order, row, c);
    values[name] = dc.isNull ? null : dc.text;
  }
  return { columns: [...order], values };
}

/** P24 D10: while filtering, column-scoped ops (copy column values, the column-selection copy
 *  branch) walk only the *visible* rows — the column the user can see has N rows, and copying
 *  every loaded row from a grid showing 12 would be a silent mismatch pasted into a spreadsheet. */
export function rowsForColumnOps(
  displayRows: readonly number[] | null,
  rowCount: number,
): number[] {
  return displayRows ? [...displayRows] : Array.from({ length: rowCount }, (_, i) => i);
}

/** Finding 3 (round 2) — P24 D10's own rule ("a column-scoped op walks only the visible rows"),
 *  extended to a `range`-kind selection: its two corners (`anchorRow`/`row`) are page rows spanning
 *  a CONTIGUOUS block, which every consumer used to walk assuming nothing in between was filtered
 *  out — under an active "hide non-matching rows" filter that silently swept up hidden rows into
 *  copy/delete, never intended by the user. Ascending, matching `displayRows`' own contract; `r0`/
 *  `r1` may arrive in either order (a `SlickRange`-derived selection's anchor is always top-left,
 *  but callers here pass raw corners, not a normalised range). */
export function visibleRowsInSpan(
  displayRows: readonly number[] | null,
  r0: number,
  r1: number,
): number[] {
  const lo = Math.min(r0, r1);
  const hi = Math.max(r0, r1);
  if (!displayRows) {
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }
  return displayRows.filter((r) => r >= lo && r <= hi);
}

/** Finding 3 (round 2) — paste's own version of the same rule: a paste starting at `startRow`
 *  writes `count` clipboard rows in order, but `startRow + ri` (the old, purely arithmetic target)
 *  can land on a row the active filter is hiding. The ri-th clipboard row instead lands on the
 *  ri-th *visible* page row at or after `startRow` — `displayRows` only ever holds real, loaded
 *  page rows (never a pending-insert index), so once the walk runs past the last of them it
 *  continues contiguously from `Math.max(startRow, rowCount)`, the pending-insert region, which is
 *  never filtered (mirrors `isRowVisible`'s own pending-insert-is-always-visible rule). */
export function pasteTargetRows(
  displayRows: readonly number[] | null,
  rowCount: number,
  startRow: number,
  count: number,
): number[] {
  if (count <= 0) return [];
  if (!displayRows) return Array.from({ length: count }, (_, i) => startRow + i);
  const out: number[] = [];
  for (const r of displayRows) {
    if (out.length >= count) break;
    if (r >= startRow) out.push(r);
  }
  let next = Math.max(startRow, rowCount);
  while (out.length < count) out.push(next++);
  return out;
}

/** The loaded page's values only for one column (§8.5's own scope boundary) — the header menu's
 *  "Copy column values". */
export function columnValuesFor(
  tabId: string,
  page: TabularPage | null,
  order: readonly string[],
  displayRows: readonly number[] | null,
  displayCol: number,
): string[] {
  if (!page) return [];
  const out: string[] = [];
  for (const r of rowsForColumnOps(displayRows, page.rowCount)) {
    const dc = displayCell(tabId, page, order, r, displayCol);
    out.push(dc.isNull ? '' : dc.text);
  }
  return out;
}

export interface NavColumns {
  fk: Set<string>;
  pk: Set<string>;
  valueNames: string[];
}

/** P29 D6: the cheap precheck that makes cellNavEntry affordable — the two predicates menu.ts's
 *  own foreignKeyNavItems/referencedByItems already apply, computed once (not per cell/hover). */
export function navColumnsFor(meta: ObjectMeta | null): NavColumns {
  const fk = new Set<string>();
  const pk = new Set<string>();
  const valueNames = new Set<string>();
  if (meta) {
    for (const edge of meta.foreignKeys) {
      for (const name of edge.columns) {
        fk.add(name);
        valueNames.add(name);
      }
    }
    if (meta.primaryKey && meta.referencedBy.length > 0) {
      for (const name of meta.primaryKey) pk.add(name);
      for (const edge of meta.referencedBy) {
        for (const name of edge.columns) valueNames.add(name);
      }
    }
  }
  return { fk, pk, valueNames: [...valueNames] };
}

/** rowSnapshot(row) narrowed to navColumns.valueNames, memoised per row for one render/hover via
 *  the optional cache the caller passes — a table with no FK and no inbound reference (the common
 *  case) never builds one at all, since valueNames is then empty. */
export function navValuesFor(
  tabId: string,
  page: TabularPage | null,
  order: readonly string[],
  navColumns: NavColumns,
  row: number,
  cache?: Map<number, Record<string, string | null>>,
): Record<string, string | null> {
  const cached = cache?.get(row);
  if (cached) return cached;
  const out: Record<string, string | null> = {};
  for (const name of navColumns.valueNames) {
    const c = order.indexOf(name);
    if (c < 0) continue;
    const dc = displayCell(tabId, page, order, row, c);
    out[name] = dc.isNull ? null : dc.text;
  }
  cache?.set(row, out);
  return out;
}

export interface CellNavEntry {
  kind: 'fk' | 'pk';
  items: MenuItem[];
}

/** P7 D3/D5/D7: the single source of truth for a cell's nav affordance — both the button (C11)
 *  and the cell menu's FK/PK items read this, so they can never disagree about what's showing.
 *  'fk' wins over 'pk' when a cell is somehow both (D7); null before meta has loaded or when
 *  there's nothing navigable. Unlike DataGrid.vue's own version, this does not veto on "is this
 *  cell being edited" — that is a SlickGrid-editor concept (D8/C8), and this module carries no
 *  SlickGrid API by design; C11's own placement call site is where that veto belongs. */
export function cellNavEntry(
  tabId: string,
  page: TabularPage | null,
  order: readonly string[],
  meta: ObjectMeta | null,
  connectionId: string | null,
  dialect: SqlDialect | undefined,
  navColumns: NavColumns,
  row: number,
  displayCol: number,
  navCache?: Map<number, Record<string, string | null>>,
): CellNavEntry | null {
  const name = order[displayCol];
  if (!name || !meta || !connectionId) return null;
  if (!navColumns.fk.has(name) && !navColumns.pk.has(name)) return null;
  const fkCtx: FkNavContext = {
    connectionId,
    dialect,
    rowValues: navValuesFor(tabId, page, order, navColumns, row, navCache),
  };
  const fkItems = foreignKeyNavItems(name, meta, fkCtx).filter(
    (i) => i.type === 'item' && !i.disabled,
  );
  if (fkItems.length) return { kind: 'fk', items: fkItems };
  const refItems = referencedByItems(name, meta, fkCtx).filter(
    (i) => i.type === 'item' && !i.disabled,
  );
  if (refItems.length) return { kind: 'pk', items: refItems };
  return null;
}
