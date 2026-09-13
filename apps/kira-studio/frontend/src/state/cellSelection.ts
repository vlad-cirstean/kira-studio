import type { ColumnDescriptor } from '@shared/protocol/page';
import { reactive } from 'vue';

// The only thing that crosses between the grid and the cell editor (D1): `views/shared/celleditor/`
// imports nothing from `views/grid/` — §11 forbids sideways view imports, and this publication
// is the seam that keeps it that way. P8/P10 publish into the same slot for their own views.
export interface SelectedCell {
  tabId: string;
  connectionId: string | null;
  /** Encoded NodePath of the tab's target — the override key's second component (D12). */
  path: string;
  /** Index into the page's own `columns`/`chunks`, never a display position (§0 note 4). */
  columnIndex: number;
  column: ColumnDescriptor;
  /** Row index within the loaded page, 0-based, as the grid's gutter shows it minus one. */
  row: number;
  /** The decoded server text. `null` means SQL NULL — an empty string is `''` (D14). */
  value: string | null;
  /** The engine cut this value at MAX_CELL_BYTES; the rest was never fetched (D14). */
  truncated: boolean;
  /** Whether the page has a primary key at all (P5 D14) — computed once here, since whether a
   *  page has one is grid-only knowledge and `views/shared/celleditor/` may not import `views/grid/`. */
  hasPrimaryKey: boolean;
  /** Set only by a publisher that can genuinely stage a write for this exact cell — today only
   *  `DataGrid.vue`, closing over `stageEdit(tabId, row, columnName, newValue)`, and
   *  `KeyValueView.vue`, for an S3 object's own editable `Body` row. `StreamView.vue` and
   *  `ConsoleResultGrid.vue` publish too but never set this (both are viewers, P43 F3/D4 — the
   *  dock mounting them passes `readOnly`). `undefined` means "this view never lets the panel edit
   *  its cells" — the panel forces read-only whenever this is absent, regardless of
   *  `readOnlyReasonFor()`, so a publisher that never sets it keeps its cells read-only in the
   *  panel by default rather than needing to opt out. `views/documents/` publishes nothing at all
   *  (§8.7: a document's own row is already the read/write surface) and mounts no dock. */
  onEdit?: (newValue: string) => void;
  /** Sibling to `onEdit`, closing over `discardCellEdit(tabId, row, columnName)` — what the panel's
   *  Revert button calls to un-stage a pending edit, not just visually reset its own buffer.
   *  Always set alongside `onEdit` by the same publisher; never set without it. */
  onRevert?: () => void;
}

// P26 D2/D3: one record per tab rather than one global slot — the dock that renders a tab's
// selection is now mounted by the view that owns that tab, so "which cell is selected" is
// per-tab state like every other piece of tab state (views/*/state.ts's runtimes).
const cellSelectionState = reactive<{ byTab: Record<string, SelectedCell> }>({ byTab: {} });

export function selectedCellFor(tabId: string): SelectedCell | null {
  return cellSelectionState.byTab[tabId] ?? null;
}

// Replaces the tab's record wholesale — never mutates the existing object. CellEditorView
// compares on `cellKey` plus `value`, so an in-place mutation would be invisible to it.
export function publishSelectedCell(cell: SelectedCell): void {
  cellSelectionState.byTab[cell.tabId] = cell;
}

/** No cell is selected in this tab any more — a cleared selection, a row/column selection with
 *  no single cell in it, a page whose rows no longer reach the selected index, or a closed tab
 *  (state/tabs.ts's four close paths). All the same operation. */
export function clearSelectedCellFor(tabId: string): void {
  delete cellSelectionState.byTab[tabId];
}

/** Stable identity of a selection, for `data-cell-key` and for change detection. */
export function cellKey(cell: SelectedCell): string {
  return `${cell.tabId}:${cell.row}:${cell.column.name}`;
}
