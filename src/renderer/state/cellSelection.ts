import type { ColumnDescriptor } from '@shared/protocol/page';
import { reactive } from 'vue';

// The only thing that crosses between the grid and the cell editor (D1): `views/celleditor/`
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
   *  page has one is grid-only knowledge and `views/celleditor/` may not import `views/grid/`. */
  hasPrimaryKey: boolean;
  /** Set only by a publisher that can genuinely stage a write for this exact cell (today, only
   *  `DataGrid.vue`, closing over `stageEdit(tabId, row, columnName, newValue)`). `undefined`
   *  means "this view never lets the panel edit its cells" — the panel forces read-only whenever
   *  this is absent, regardless of `readOnlyReasonFor()`, so a future publisher (Document/
   *  KeyValue/Stream/Console) that never sets it keeps its cells read-only in the panel by
   *  default rather than needing to opt out. */
  onEdit?: (newValue: string) => void;
}

export const cellSelectionState = reactive<{ current: SelectedCell | null }>({ current: null });

// Replaces `current` wholesale — never mutates the existing object. Downstream watchers compare
// on `cellKey` plus `value`, so an in-place mutation would be invisible to them.
export function publishSelectedCell(cell: SelectedCell | null): void {
  cellSelectionState.current = cell;
}

/** Called from tabs.ts beside every dropPage(): a closed tab has no selected cell. */
export function clearSelectedCellFor(tabId: string): void {
  if (cellSelectionState.current?.tabId === tabId) cellSelectionState.current = null;
}

/** Stable identity of a selection, for `data-cell-key` and for change detection. */
export function cellKey(cell: SelectedCell): string {
  return `${cell.tabId}:${cell.row}:${cell.column.name}`;
}
