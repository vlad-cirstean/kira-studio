import type { ComputedRef, InjectionKey } from 'vue';
import type { PendingEdit } from './pendingChanges';

// P29 D5: every rendered cell's state, computed exactly once per render instead of the 7-11
// function calls per cell the template made before this — displayCell/cellClass/isSelected/
// isSearchMatch/isCurrentSearchMatch/alignFor/isForeignKeyDisplayCol/isEditing/cellNavEntry keep
// their signatures and are called from DataGrid.vue's renderRows instead of the template. Changes
// no rendered attribute, class name or data-testid — the existing suite is the regression guard.
//
// P22 iter2 D4: moved out of DataGrid.vue's own <script setup> so GridRow.vue can import the same
// type for its one prop (F11(a)) — a Vue SFC's local interfaces aren't importable by another SFC.
export interface CellVM {
  col: number; // display column index — what selection/copy address
  name: string; // column name — the v-for :key, unchanged
  left: number;
  width: number;
  text: string;
  isNull: boolean;
  truncated: boolean;
  staged: boolean;
  editing: boolean;
  navKind: 'fk' | 'pk' | null;
  classes: Record<string, boolean>;
  /** '' when nothing should override the cell's own CSS-driven colour (NULL, an FK link, a
   *  pending edit, or the current search match all already carry their own meaningful colour via
   *  .grid-cell's class rules — a data-type colour stacked on top of any of those would silently
   *  replace a higher-priority signal, since an inline style always wins over a class). Otherwise
   *  the column's own colorForColumn. */
  color: string;
}

export interface RowVM {
  /** The page row index (P24 D3/D4): gutter number, selection, pending changes and search
   *  matches all address a row by this, unchanged by filtering. */
  row: number;
  /** The display position: pixel placement only — identical to `row` when nothing is filtered
   *  (P29 D11, preserving P24 D3/D4's split literally). */
  pos: number;
  gutterNumber: number;
  dirty: boolean;
  deleted: boolean;
  cells: CellVM[];
}

/** P22 iter2 D4/F11(a): GridRow.vue's row height, threaded via provide/inject rather than a second
 *  prop — shouldUpdateComponent's reference-equality bail-out (the whole point of D4) only fires
 *  when `rowVm` is the component's *one* dynamic prop; every extra prop is another reference to
 *  keep stable, and rowHeight would otherwise be exactly that. GUTTER_WIDTH needs no such
 *  treatment — it's a plain module constant (columns.ts), not a dynamic value. */
export const ROW_HEIGHT_KEY: InjectionKey<ComputedRef<number>> = Symbol('gridRowHeight');

// P22 iter2 D4(ii): a row-level signature, cheap enough to compute for every visible row on every
// DataGrid.vue renderRows call — see the plan's §5 D4 and GridRow.vue's own comment for the
// mechanism this feeds. Every field is a *reference* (a reactive container's own identity, stable
// unless something inside it is reassigned) or an O(1) lookup, deliberately never a deep per-cell
// comparison — the latter would cost nearly what rebuilding the row costs, defeating the point.
// Anything that can change a rendered cell and is not part of this signature will silently stop
// repainting; treat this list as load-bearing. Exported (not local to DataGrid.vue) so
// row-sig.spec.ts can exercise sameRowSig directly — this is exactly AGENTS.md's "cache
// eviction/invalidation with rules that interact" test-worthy category, and two real omissions
// here (pageVersion, columnOrder) were only caught by tests/ui/data-view.spec.ts and
// tests/ui/mutations.spec.ts going stale during development, which is the expensive way to find
// this class of bug.
export interface RowSig {
  /** pageVersion.n (page.ts) — the master invalidation signal for a reload/re-sort/re-filter.
   *  Without this, a row index whose *underlying page data* changed (a new page object entirely,
   *  same row index, different content — a sort, a commit-triggered reload, a refresh) would keep
   *  serving its previous page's cached text, since nothing else in this signature reads the page
   *  directly. */
  pageVersion: number;
  pos: number;
  gutterBase: number;
  dirty: boolean;
  deleted: boolean;
  /** The editing display column, if editingCell is in this row; -1 otherwise. Not just a row-level
   *  boolean: editingCell can move from one column to another *within* the same row (e.g. commit,
   *  reselect, start editing an adjacent cell) without the row-level "is something being edited
   *  here" fact ever changing, which a boolean would miss. */
  editingCol: number;
  stagedEdit: PendingEdit | undefined;
  cols: number[];
  /** columnOrder.value's own reference — display *index* c can keep meaning a different column
   *  name after a reorder (ColumnsMenu.vue's setColumnOrder) with the same visible index *range*,
   *  which `cols` above alone would not catch. */
  columnOrder: string[];
  selection: unknown;
  matches: unknown;
  meta: unknown;
  rowColoring: boolean;
}

export function sameRowSig(a: RowSig, b: RowSig): boolean {
  return (
    a.pageVersion === b.pageVersion &&
    a.pos === b.pos &&
    a.gutterBase === b.gutterBase &&
    a.dirty === b.dirty &&
    a.deleted === b.deleted &&
    a.editingCol === b.editingCol &&
    a.stagedEdit === b.stagedEdit &&
    a.cols === b.cols &&
    a.columnOrder === b.columnOrder &&
    a.selection === b.selection &&
    a.matches === b.matches &&
    a.meta === b.meta &&
    a.rowColoring === b.rowColoring
  );
}
