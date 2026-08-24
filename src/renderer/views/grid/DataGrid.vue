<script setup lang="ts">
import { decodePath } from '@shared/domain/tree';
import type { ColumnDescriptor } from '@shared/protocol/page';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { copyText } from '../../clipboard';
import { shortcutFor } from '../../shortcuts/keys';
import {
  clearSelectedCellFor,
  publishSelectedCell,
  type SelectedCell,
} from '../../state/cellSelection';
import { connectionsState } from '../../state/connections';
import { settingsState } from '../../state/settings';
import { findDataTab, patchDataTabState } from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { cellClass } from '../../theme/cellClass';
import AppButton from '../../theme/primitives/AppButton.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import { type MenuItem, openContextMenu, runMenuShortcut } from '../../workbench/state/contextMenu';
import { parseDelimited, type RowSnapshot, rowsToTsv } from './clipboardFormats';
import {
  alignmentFor,
  columnOffsets,
  initialWidths,
  pageColumnIndexFor,
  resolveColumnOrder,
  visibleColumnRange,
} from './columns';
import { cellMenu, foreignKeyNavItems, headerMenu, referencedByItems, rowMenu } from './gridMenu';
import { cell, getPage, pageVersion, setVisibleWindow } from './page';
import {
  addInsertRow,
  discardCellEdit,
  isPendingDelete,
  pendingFor,
  stagedValue,
  stageEdit,
  stageInsertValue,
} from './pendingChanges';
import { matchedRows, searchState, setSearchFiltering } from './search';
import { runtime, setSort } from './state';

const props = defineProps<{ tabId: string }>();

const GUTTER_WIDTH = 56;
// Widened from 8: a fast fling scroll is compositor-driven (the browser moves the viewport
// instantly, with no need to wait on the main thread), while the actual row DOM only updates
// once this component's scroll handler runs and re-renders — under a big flick that gap can
// briefly outrun a thin buffer, showing blank space where rows haven't caught up yet ("cells
// disappear, then reappear once you stop"). A wider buffer gives the main thread more scrolled
// distance to fall behind before that gap becomes visible.
const OVERSCAN_ROWS = 20;

const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

function tab() {
  return findDataTab(props.tabId);
}

const page = computed(() => {
  // Establishes the reactive dependency — the page object itself is frozen and non-reactive.
  void pageVersion.n;
  return getPage(props.tabId);
});

const columnOrder = computed<string[]>(() => {
  const p = page.value;
  if (!p) return [];
  return resolveColumnOrder(p, tab()?.state.columnOrder ?? null);
});

const columnByName = computed(() => {
  const map = new Map<string, ColumnDescriptor>();
  for (const c of page.value?.columns ?? []) map.set(c.name, c);
  return map;
});

// The DESCRIBE-derived metadata (rt().meta), not the page's own ColumnDescriptor — a comment
// only ever lives on ObjectMeta.columns (ColumnMeta), never on the per-query page column shape.
const columnMetaByName = computed(() => {
  const map = new Map<string, { dataType: string; comment: string | null }>();
  for (const c of rt()?.meta?.columns ?? []) map.set(c.name, c);
  return map;
});

// Header hover: data type always (falls back to the page's own descriptor if DESCRIBE metadata
// hasn't loaded yet), plus the column's DB comment when it has one.
function headerTitleFor(name: string): string {
  const meta = columnMetaByName.value.get(name);
  const dataType = meta?.dataType ?? columnByName.value.get(name)?.dataType ?? '';
  const comment = meta?.comment;
  return comment ? `${dataType} — ${comment}` : dataType;
}

const widths = computed<Record<string, number>>(() => {
  const p = page.value;
  if (!p) return {};
  const stored = tab()?.state.columnWidths ?? {};
  const measured = initialWidths(p);
  const out: Record<string, number> = {};
  for (const name of columnOrder.value) out[name] = stored[name] ?? measured[name] ?? 96;
  return out;
});

const offsets = computed(() => columnOffsets(columnOrder.value, widths.value));
const totalWidth = computed(() => offsets.value[offsets.value.length - 1] ?? 0);

const pending = computed(() => pendingFor(props.tabId));
const insertRows = computed(() => pending.value?.inserts ?? []);

// "Add row" appends a synthetic row past the last real one, out of view whenever the page is
// more than a screenful — scroll it into view the same way search's goToMatch does, rather than
// leaving the user to notice a new row was added below the fold.
watch(
  () => insertRows.value.length,
  (count, previousCount) => {
    if (count > previousCount) {
      const newRowIndex = (page.value?.rowCount ?? 0) + count - 1;
      void nextTick(() => scrollCellIntoView(newRowIndex, 0));
    }
  },
);

const hasPrimaryKey = computed(() => page.value?.columns.some((c) => c.isPrimaryKey) ?? false);

// FIX-8 (design system): "keys are labelled PK / FK, never inferred from colour alone" — the FK
// side reads the same describe-derived `meta.foreignKeys` the cell-nav buttons already use, just
// flattened once into a name set instead of walking every edge per cell.
const foreignKeyColumnNames = computed(() => {
  const names = new Set<string>();
  for (const fk of runtime[props.tabId]?.meta?.foreignKeys ?? []) {
    for (const c of fk.columns) names.add(c);
  }
  return names;
});
function keyLabelFor(displayCol: number): 'PK' | 'FK' | null {
  const name = columnOrder.value[displayCol];
  if (!name) return null;
  if (columnByName.value.get(name)?.isPrimaryKey) return 'PK';
  if (foreignKeyColumnNames.value.has(name)) return 'FK';
  return null;
}
function isForeignKeyDisplayCol(displayCol: number): boolean {
  const name = columnOrder.value[displayCol];
  return !!name && foreignKeyColumnNames.value.has(name);
}

// The design's `.tr.dirty .td.gutter` rail: a row with a staged edit or delete, drawn once on
// the gutter cell rather than re-deriving it per visible column.
function isDirtyRow(row: number): boolean {
  const p = pendingFor(props.tabId);
  return !!p && (p.edits.has(row) || p.deletes.has(row));
}
const isWritable = computed(() => {
  const t = tab();
  if (!t?.connectionId) return false;
  const record = connectionsState.records.find((r) => r.id === t.connectionId);
  return !record?.readOnly;
});
// Gates whether double-click/Enter starts an inline edit (D2/D14) — the toolbar's add/delete/
// preview/commit/discard buttons are gated on writability alone, never on hasPrimaryKey.
const canEditTable = computed(() => isWritable.value && hasPrimaryKey.value);

const dialect = computed<'postgres' | 'mariadb' | undefined>(() => {
  const t = tab();
  if (!t?.connectionId) return undefined;
  const record = connectionsState.records.find((r) => r.id === t.connectionId);
  return record?.kind === 'postgres' || record?.kind === 'mariadb' ? record.kind : undefined;
});

// Produced locally from the path, never round-tripped to the engine for a string join —
// the same discipline project/menus.ts's own qualifiedNameFor uses (§9b).
const QUALIFIED_KINDS = new Set(['schema', 'table', 'view', 'matview']);
function qualifiedName(): string {
  const t = tab();
  if (!t?.connectionId) return '';
  return decodePath(t.connectionId, t.path)
    .segments.filter((s) => QUALIFIED_KINDS.has(s.kind))
    .map((s) => s.name)
    .join('.');
}

// P24 D2/D3: the find widget's "hide non-matching rows" toggle, read as a plain row-index list —
// `null` means unfiltered, and every expression below short-circuits to today's arithmetic in
// that case, so the frame budget is unchanged by construction on the common (unfiltered) path.
const displayRows = computed<number[] | null>(() => matchedRows(props.tabId));
const displayRowCount = computed(() =>
  displayRows.value ? displayRows.value.length : (page.value?.rowCount ?? 0),
);

// P24 D3/D5/D6/D11: converts between a *page row index* (what selection/pending-changes/search
// identify a row by) and its *display position* (its 0-based rank among the rows actually
// rendered) — the indirection virtualization, scroll-into-view and arrow-key nav all need once
// rows can be hidden. `displayRows` is always ascending (matchedRows' own contract), so this is a
// binary search: an exact hit is the common case (the row is visible), and a miss (the row was
// just filtered out from under a live selection) falls through to the position it would sort
// into, so nav/scroll lands on the nearest visible row instead of doing nothing.
function displayPositionOf(row: number): number {
  const rowCount = page.value?.rowCount ?? 0;
  if (row >= rowCount) return displayRowCount.value + (row - rowCount); // pending insert (D5)
  const dr = displayRows.value;
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
function rowAtDisplayPosition(pos: number): number {
  const dr = displayRows.value;
  return dr ? (dr[pos] ?? pos) : pos;
}

const totalHeight = computed(
  () => (displayRowCount.value + insertRows.value.length) * rowHeight.value,
);

// The gutter shows the row's position in the whole result set, not just this page's fetched
// window (`r` is a local index into the current page's rows) — so it must add back the rows
// skipped by earlier pages.
const rowNumberBase = computed(() => {
  const t = tab();
  return t ? t.state.pageIndex * t.state.pageSize : 0;
});

const containerRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const scrollLeft = ref(0);
const viewportHeight = ref(0);
const viewportWidth = ref(0);
let resizeObserver: ResizeObserver | null = null;

function syncScrollState(): void {
  const el = containerRef.value;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  scrollLeft.value = el.scrollLeft;
}

// A fling can fire many native `scroll` events within a single frame — updating scrollTop/Left
// (and so re-rendering the visible row/column window) synchronously on every one of them is
// wasted work that only makes it more likely the main thread falls behind the compositor-driven
// scroll position. Coalescing to one update per animation frame keeps the re-render in step with
// what's actually going to paint. The initial mount call bypasses this (calls syncScrollState
// directly) so a restored scroll position renders its correct row window on the very first paint
// rather than one frame late at scrollTop 0.
let scrollRaf = 0;
function onScroll(): void {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    syncScrollState();
  });
}

onMounted(() => {
  const el = containerRef.value;
  if (!el) return;
  viewportHeight.value = el.clientHeight;
  viewportWidth.value = el.clientWidth;
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) return;
    viewportHeight.value = entry.contentRect.height;
    viewportWidth.value = entry.contentRect.width;
  });
  resizeObserver.observe(el);

  const t = tab();
  if (t) {
    el.scrollTop = t.state.scrollTop;
    el.scrollLeft = t.state.scrollLeft;
  }
  syncScrollState();
});
// The tab-id guard inside clearSelectedCellFor is load-bearing: MainView.vue keys DataView by
// tab id, so switching tabs unmounts one grid and mounts another in an order that is not safe
// to rely on. The guard means a late unmount here cannot clobber the freshly mounted tab's
// publication, and an early one is corrected by the new grid's `immediate` publish watch below.
onUnmounted(() => {
  resizeObserver?.disconnect();
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  clearSelectedCellFor(props.tabId);
  // D9: the pending write is a scroll offset patchDataTabState would discard anyway once the
  // tab is gone — clearing it just stops the timer firing against an unmounted component.
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
});

// P24 D3: in *display-position* space (0..displayRowCount), not page-row space — the rows a
// filter hides are never virtualized at all, which is what keeps the unfiltered path's arithmetic
// untouched (displayRowCount === page.rowCount when there's no filter).
const rowRange = computed(() => {
  const total = displayRowCount.value;
  const start = Math.max(0, Math.floor(scrollTop.value / rowHeight.value) - OVERSCAN_ROWS);
  const end = Math.min(
    total,
    Math.ceil((scrollTop.value + viewportHeight.value) / rowHeight.value) + OVERSCAN_ROWS,
  );
  return { start, end };
});
const colRange = computed(() =>
  visibleColumnRange(scrollLeft.value, viewportWidth.value, offsets.value),
);

const visibleRows = computed<{ row: number; pos: number }[]>(() => {
  const out: { row: number; pos: number }[] = [];
  for (let pos = rowRange.value.start; pos < rowRange.value.end; pos++) {
    out.push({ row: rowAtDisplayPosition(pos), pos });
  }
  return out;
});

// F3: setVisibleWindow is a cache-clearing hint, not a correctness contract — the min/max page
// row of a (possibly non-contiguous, while filtering) visible slice can only make page.ts's
// decode cache live slightly longer, never decode a cell nobody rendered.
const visiblePageRowBounds = computed(() => {
  const rows = visibleRows.value;
  if (rows.length === 0) return { start: 0, end: 0 };
  let min = rows[0]?.row ?? 0;
  let max = min;
  for (const { row } of rows) {
    if (row < min) min = row;
    if (row > max) max = row;
  }
  return { start: min, end: max + 1 };
});
watch(visiblePageRowBounds, (r) => setVisibleWindow(props.tabId, r.start, r.end));

const visibleColumnIndices = computed(() => {
  const out: number[] = [];
  for (let c = colRange.value.startIndex; c < colRange.value.endIndex; c++) out.push(c);
  return out;
});

let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
watch([scrollTop, scrollLeft], () => {
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => {
    patchDataTabState(props.tabId, { scrollTop: scrollTop.value, scrollLeft: scrollLeft.value });
  }, 300);
});

function cellAt(row: number, displayCol: number) {
  const p = page.value;
  if (!p) return { text: '', isNull: true, truncated: false };
  const pageCol = pageColumnIndexFor(p, columnOrder.value, displayCol);
  if (pageCol < 0) return { text: '', isNull: true, truncated: false };
  return cell(props.tabId, row, pageCol);
}

function alignFor(displayCol: number): 'left' | 'right' {
  const name = columnOrder.value[displayCol];
  const descriptor = columnByName.value.get(name);
  return descriptor ? alignmentFor(descriptor) : 'left';
}

// queries.ts's own doc comment: typing in the ORDER BY box always produces a `text` sort and
// "clears the header indicators" — true for the machine-driven distinction that keeps pagination
// on `offset` (D7), but a user who types "a asc, b desc" still expects the headers to reflect it.
// This best-effort, display-only parse recovers per-column direction + position for exactly that
// case; a term that doesn't match a real column name (an expression, a typo) is silently skipped
// rather than guessed at. It never feeds back into `state.sort` — the text/structured split for
// pagination purposes is untouched.
function parseTextSortTerms(
  text: string,
  knownColumns: readonly string[],
): { column: string; direction: 'asc' | 'desc' }[] {
  const known = new Set(knownColumns);
  const terms: { column: string; direction: 'asc' | 'desc' }[] = [];
  for (const raw of text.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(?:"([^"]+)"|`([^`]+)`|(\w+))\b\s*(desc|asc)?/i);
    const name = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!name || !known.has(name)) continue;
    terms.push({ column: name, direction: match?.[4]?.toLowerCase() === 'desc' ? 'desc' : 'asc' });
  }
  return terms;
}

const sortTerms = computed(() => {
  const sort = tab()?.state.sort;
  if (!sort) return [];
  if (sort.kind === 'structured') return sort.terms;
  return parseTextSortTerms(sort.text, columnOrder.value);
});

function currentSortDirection(name: string): 'asc' | 'desc' | null {
  return sortTerms.value.find((t) => t.column === name)?.direction ?? null;
}

// Only worth a number once there's more than one active sort key — a lone chevron already says
// everything a "1" badge would.
function sortOrderIndex(name: string): number | null {
  if (sortTerms.value.length < 2) return null;
  const index = sortTerms.value.findIndex((t) => t.column === name);
  return index === -1 ? null : index + 1;
}

// Cycles asc -> desc -> none and mirrors into the ORDER BY box via setSort (D6).
function onHeaderClick(name: string): void {
  const current = currentSortDirection(name);
  const next: 'asc' | 'desc' | null = current === null ? 'asc' : current === 'asc' ? 'desc' : null;
  const sort =
    next === null
      ? null
      : { kind: 'structured' as const, terms: [{ column: name, direction: next }] };
  void setSort(props.tabId, sort);
}

let resizing: { name: string; startX: number; startWidth: number } | null = null;

function onResizeStart(e: PointerEvent, name: string): void {
  e.stopPropagation();
  resizing = { name, startX: e.clientX, startWidth: widths.value[name] ?? 96 };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onResizeMove(e: PointerEvent): void {
  if (!resizing) return;
  const width = Math.max(40, resizing.startWidth + (e.clientX - resizing.startX));
  const t = tab();
  if (t)
    patchDataTabState(props.tabId, {
      columnWidths: { ...t.state.columnWidths, [resizing.name]: width },
    });
}
function onResizeEnd(e: PointerEvent): void {
  resizing = null;
  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
}

function rt() {
  return runtime[props.tabId];
}

function isSelected(row: number, displayCol: number): boolean {
  const sel = rt()?.selection;
  if (!sel) return false;
  if (sel.kind === 'cell') return sel.row === row && sel.col === displayCol;
  if (sel.kind === 'range') {
    const [r0, r1] = [sel.anchorRow, sel.row].sort((a, b) => a - b);
    const [c0, c1] = [sel.anchorCol, sel.col].sort((a, b) => a - b);
    return row >= r0 && row <= r1 && displayCol >= c0 && displayCol <= c1;
  }
  if (sel.kind === 'row') return sel.rows.includes(row);
  if (sel.kind === 'column') return sel.cols.includes(displayCol);
  return false;
}

// A 'cell' selection publishes itself; a 'range' publishes its focus end — the moving end, the
// cell the arrow keys are moving and the one the user last touched (D13). A 'row'/'column'
// selection has no single value to render and publishes null.
function selectionTarget(): { row: number; col: number } | null {
  const sel = rt()?.selection;
  if (!sel) return null;
  if (sel.kind === 'cell' || sel.kind === 'range') return { row: sel.row, col: sel.col };
  return null;
}

// Publishes the cell editor's target (D1). Depends on selection, page version and tab id —
// deliberately never on scroll offsets, so scrolling never puts a decode on the frame budget
// §2.1 forbids. `pageVersion` in the dependency list is what makes the still-highlighted cell
// republish against a *new* page after paging/filtering/refreshing, so the panel and the grid
// never disagree about which cell is shown.
watch(
  [() => rt()?.selection, () => pageVersion.n, () => props.tabId],
  () => {
    const p = page.value;
    const t = tab();
    const target = selectionTarget();
    if (!p || !t || !target || target.row < 0 || target.row >= p.rowCount) {
      publishSelectedCell(null);
      return;
    }
    const pageCol = pageColumnIndexFor(p, columnOrder.value, target.col);
    if (pageCol < 0) {
      publishSelectedCell(null);
      return;
    }
    const view = cell(props.tabId, target.row, pageCol);
    const column = p.columns[pageCol];
    const targetRow = target.row;
    const selected: SelectedCell = {
      tabId: props.tabId,
      connectionId: t.connectionId,
      path: t.path,
      columnIndex: pageCol,
      column,
      row: targetRow,
      value: view.isNull ? null : view.text,
      truncated: view.truncated,
      hasPrimaryKey: hasPrimaryKey.value,
      // Same eligibility as the grid's own inline (double-click) edit (D2/D6): writable
      // connection, a primary key to identify the row, and the row isn't already staged for
      // delete. Stages into the exact same pending-change set `stageEdit` already feeds, so the
      // panel's save and the grid's own inline edit can never disagree about a cell's value.
      onEdit:
        canEditTable.value && !isDeleted(targetRow)
          ? (newValue: string) => stageEdit(props.tabId, targetRow, column.name, newValue)
          : undefined,
      // Sibling to onEdit — the panel's Revert button un-stages this cell's pending edit (if any)
      // rather than only resetting its own display buffer (see discardCellEdit's own doc comment).
      onRevert:
        canEditTable.value && !isDeleted(targetRow)
          ? () => discardCellEdit(props.tabId, targetRow, column.name)
          : undefined,
    };
    publishSelectedCell(selected);
  },
  { immediate: true },
);

// Rebuilt only when the search result changes (a completed scan or prev/next), not per cell —
// matches are keyed by the page's own column index, not display position.
const matchIndex = computed(() => {
  const entry = searchState[props.tabId];
  if (!entry) return null;
  const set = new Set<string>();
  for (const m of entry.matches) set.add(`${m.row}:${m.col}`);
  return { set, current: entry.index >= 0 ? entry.matches[entry.index] : undefined };
});

function isSearchMatch(row: number, displayCol: number): boolean {
  const p = page.value;
  if (!p) return false;
  const pageCol = pageColumnIndexFor(p, columnOrder.value, displayCol);
  return matchIndex.value?.set.has(`${row}:${pageCol}`) ?? false;
}
function isCurrentSearchMatch(row: number, displayCol: number): boolean {
  const p = page.value;
  if (!p) return false;
  const pageCol = pageColumnIndexFor(p, columnOrder.value, displayCol);
  const current = matchIndex.value?.current;
  return !!current && current.row === row && current.col === pageCol;
}

function isDeleted(row: number): boolean {
  return isPendingDelete(props.tabId, row);
}

// Merges a staged edit over the real page value for display — never touches the underlying
// page/decode cache, which stays the server's own last-read value until commit/discard.
function displayCell(
  row: number,
  displayCol: number,
): {
  text: string;
  isNull: boolean;
  truncated: boolean;
  staged: boolean;
} {
  const name = columnOrder.value[displayCol];
  const staged = name ? stagedValue(props.tabId, row, name) : undefined;
  if (staged !== undefined) {
    return { text: staged ?? '', isNull: staged === null, truncated: false, staged: true };
  }
  const base = cellAt(row, displayCol);
  return { ...base, staged: false };
}

// Inline cell editor (D2/D6): a plain <input> overlaid on the cell, opened by double-click or
// Enter on a selected cell. It stages text verbatim on commit — it can never express SQL NULL
// (D14's documented scope limit for this phase; retype the whole value, no "set to NULL"
// affordance yet).
const editingCell = ref<{ row: number; col: number } | null>(null);
const editingBuffer = ref('');

function isEditing(row: number, displayCol: number): boolean {
  return editingCell.value?.row === row && editingCell.value?.col === displayCol;
}

function startEdit(row: number, displayCol: number): void {
  if (!canEditTable.value || isDeleted(row)) return;
  const current = displayCell(row, displayCol);
  editingCell.value = { row, col: displayCol };
  editingBuffer.value = current.isNull ? '' : current.text;
}

function commitEdit(): void {
  const e = editingCell.value;
  if (!e) return;
  const name = columnOrder.value[e.col];
  editingCell.value = null;
  if (name) stageEdit(props.tabId, e.row, name, editingBuffer.value);
}

function cancelEdit(): void {
  editingCell.value = null;
}

function onCellDblClick(row: number, displayCol: number): void {
  startEdit(row, displayCol);
}

// The input is a descendant of the grid's own keydown-handling container, so without stopping
// propagation Enter/Escape would also fall through to onKeydown and move the selection.
function onEditKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitEdit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit();
  }
  e.stopPropagation();
}

function onInsertInput(e: Event, insertId: string, column: string): void {
  stageInsertValue(props.tabId, insertId, column, (e.target as HTMLInputElement).value);
}

// ctrl/cmd-click a disjoint cell is folded into a plain cell selection — multi-cell disjoint
// selection has no consumer until P6's copy/paste, so a second selected-cell set is not built here.
function onCellClick(row: number, displayCol: number, e: MouseEvent): void {
  const runtimeEntry = rt();
  if (!runtimeEntry) return;
  const sel = runtimeEntry.selection;
  if (e.shiftKey && sel && (sel.kind === 'cell' || sel.kind === 'range')) {
    const anchor =
      sel.kind === 'range'
        ? { row: sel.anchorRow, col: sel.anchorCol }
        : { row: sel.row, col: sel.col };
    runtimeEntry.selection = {
      kind: 'range',
      anchorRow: anchor.row,
      anchorCol: anchor.col,
      row,
      col: displayCol,
    };
  } else {
    runtimeEntry.selection = { kind: 'cell', row, col: displayCol };
  }
}
// D2: Shift extends a contiguous range from the last plain/ctrl click (not updated by the
// extension itself, matching cell/range's own fixed-anchor precedent); Ctrl/Cmd toggles one row
// into a disjoint set. A plain click still replaces the selection with a single row, as before.
const rowAnchor = ref<number | null>(null);
const colAnchor = ref<number | null>(null);

function onGutterClick(row: number, e: MouseEvent): void {
  const runtimeEntry = rt();
  if (!runtimeEntry) return;
  const sel = runtimeEntry.selection;
  if (e.shiftKey && rowAnchor.value !== null) {
    const [a, b] = [rowAnchor.value, row].sort((x, y) => x - y);
    const rows: number[] = [];
    for (let r = a; r <= b; r++) rows.push(r);
    runtimeEntry.selection = { kind: 'row', rows };
    return;
  }
  if ((e.ctrlKey || e.metaKey) && sel?.kind === 'row') {
    runtimeEntry.selection = {
      kind: 'row',
      rows: sel.rows.includes(row) ? sel.rows.filter((r) => r !== row) : [...sel.rows, row],
    };
    rowAnchor.value = row;
    return;
  }
  runtimeEntry.selection = { kind: 'row', rows: [row] };
  rowAnchor.value = row;
}
function onHeaderSelectClick(displayCol: number, e: MouseEvent): void {
  const runtimeEntry = rt();
  if (!runtimeEntry) return;
  const sel = runtimeEntry.selection;
  if (e.shiftKey && colAnchor.value !== null) {
    const [a, b] = [colAnchor.value, displayCol].sort((x, y) => x - y);
    const cols: number[] = [];
    for (let c = a; c <= b; c++) cols.push(c);
    runtimeEntry.selection = { kind: 'column', cols };
    return;
  }
  if ((e.ctrlKey || e.metaKey) && sel?.kind === 'column') {
    runtimeEntry.selection = {
      kind: 'column',
      cols: sel.cols.includes(displayCol)
        ? sel.cols.filter((c) => c !== displayCol)
        : [...sel.cols, displayCol],
    };
    colAnchor.value = displayCol;
    return;
  }
  runtimeEntry.selection = { kind: 'column', cols: [displayCol] };
  colAnchor.value = displayCol;
}

// The row's effective values across the whole display column order (D6) — reused by row copy
// and Duplicate row.
function rowSnapshot(row: number): RowSnapshot {
  const values: Record<string, string | null> = {};
  for (let c = 0; c < columnOrder.value.length; c++) {
    const name = columnOrder.value[c];
    const dc = displayCell(row, c);
    values[name] = dc.isNull ? null : dc.text;
  }
  return { columns: [...columnOrder.value], values };
}

// P7 D3/D5/D7: the single source of truth for a cell's nav affordance — both the button's
// v-if/icon and its click handler read this, so they can never disagree about what's showing.
// 'fk' wins over 'pk' when a cell is somehow both (D7); null while editing (D8), before meta has
// loaded, or when there's nothing navigable.
function cellNavEntry(
  row: number,
  displayCol: number,
): { kind: 'fk' | 'pk'; items: MenuItem[] } | null {
  if (isEditing(row, displayCol)) return null;
  const name = columnOrder.value[displayCol];
  const meta = rt()?.meta ?? null;
  const t = tab();
  if (!name || !meta || !t?.connectionId) return null;
  const fkCtx = {
    connectionId: t.connectionId,
    dialect: dialect.value,
    rowValues: rowSnapshot(row).values,
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

// D6: exactly one candidate navigates immediately; more than one opens the same ContextMenu
// popup the right-click cell menu uses, anchored at the click.
function onCellNavClick(row: number, displayCol: number, e: MouseEvent): void {
  const entry = cellNavEntry(row, displayCol);
  if (!entry) return;
  if (entry.items.length === 1) {
    const only = entry.items[0];
    if (only?.type === 'item') void only.run();
    return;
  }
  openContextMenu(e, entry.items);
}

// P24 D10: while filtering, both this and onCopy's column branch below walk the *visible* rows
// only — the column the user can see has N rows, and copying every loaded row from a grid
// showing 12 would be a silent mismatch pasted straight into a spreadsheet.
function rowsForColumnOps(rowCount: number): number[] {
  return displayRows.value ?? Array.from({ length: rowCount }, (_, i) => i);
}

// The loaded page's values only for one column (§8.5's own scope boundary) — used by the header
// menu's "Copy column values".
function columnValuesFor(displayCol: number): string[] {
  const p = page.value;
  if (!p) return [];
  const out: string[] = [];
  for (const r of rowsForColumnOps(p.rowCount)) {
    const dc = displayCell(r, displayCol);
    out.push(dc.isNull ? '' : dc.text);
  }
  return out;
}

// D3: right-clicking a row already in the selection acts on the whole selection; right-clicking
// outside it replaces the selection with just that row first. Cell/header menus have no
// multi-target actions, so those two always collapse to a single-item selection.
function onGutterContextMenu(row: number, e: MouseEvent): void {
  const p = page.value;
  if (!p || row >= p.rowCount) return; // pending insert rows have no row menu yet
  const runtimeEntry = rt();
  if (!runtimeEntry) return;
  const sel = runtimeEntry.selection;
  const inSelection = sel?.kind === 'row' && sel.rows.includes(row);
  if (!inSelection) {
    runtimeEntry.selection = { kind: 'row', rows: [row] };
    rowAnchor.value = row;
  }
  const rows = inSelection && sel.kind === 'row' ? sel.rows : [row];
  openContextMenu(
    e,
    rowMenu({
      tabId: props.tabId,
      rows,
      qualifiedName: qualifiedName(),
      snapshot: rowSnapshot,
      canEdit: canEditTable.value,
    }),
  );
}

function onCellContextMenu(row: number, displayCol: number, e: MouseEvent): void {
  const runtimeEntry = rt();
  if (runtimeEntry) runtimeEntry.selection = { kind: 'cell', row, col: displayCol };
  const dc = displayCell(row, displayCol);
  const name = columnOrder.value[displayCol];
  const t = tab();
  openContextMenu(
    e,
    cellMenu({
      tabId: props.tabId,
      row,
      columnName: name,
      isNull: dc.isNull,
      text: dc.text,
      dialect: dialect.value,
      canEdit: canEditTable.value,
      isDeleted: isDeleted(row),
      startEdit: () => startEdit(row, displayCol),
      onPaste: () => void onPaste(),
      meta: rt()?.meta ?? null,
      connectionId: t?.connectionId ?? '',
      rowValues: rowSnapshot(row).values,
    }),
  );
}

function onHeaderContextMenu(displayCol: number, e: MouseEvent): void {
  const runtimeEntry = rt();
  if (runtimeEntry) runtimeEntry.selection = { kind: 'column', cols: [displayCol] };
  const name = columnOrder.value[displayCol];
  openContextMenu(
    e,
    headerMenu({
      tabId: props.tabId,
      columnName: name,
      currentSort: currentSortDirection(name),
      currentProjection: tab()?.state.projection ?? null,
      allColumnNames: page.value?.columns.map((c) => c.name) ?? [],
      columnValues: () => columnValuesFor(displayCol),
    }),
  );
}

// D1: local, DOM-focus-scoped copy/paste — never a native Electron accelerator (see the ground
// rules note at the top of docs/v1/plans/P6-interaction-completeness.md for why).
function onCopy(): void {
  const sel = rt()?.selection;
  const p = page.value;
  if (!sel || !p) return;
  if (sel.kind === 'cell') {
    const dc = displayCell(sel.row, sel.col);
    copyText(dc.isNull ? '' : dc.text);
    return;
  }
  if (sel.kind === 'range') {
    const [r0, r1] = [sel.anchorRow, sel.row].sort((a, b) => a - b);
    const [c0, c1] = [sel.anchorCol, sel.col].sort((a, b) => a - b);
    const lines: string[] = [];
    for (let r = r0; r <= r1; r++) {
      const cells: string[] = [];
      for (let c = c0; c <= c1; c++) {
        const dc = displayCell(r, c);
        cells.push(dc.isNull ? '' : dc.text);
      }
      lines.push(cells.join('\t'));
    }
    copyText(lines.join('\n'));
    return;
  }
  if (sel.kind === 'row') {
    copyText(rowsToTsv(sel.rows.map(rowSnapshot)));
    return;
  }
  const lines: string[] = [];
  for (const r of rowsForColumnOps(p.rowCount)) {
    lines.push(
      sel.cols
        .map((c) => {
          const dc = displayCell(r, c);
          return dc.isNull ? '' : dc.text;
        })
        .join('\t'),
    );
  }
  copyText(lines.join('\n'));
}

// D13: TSV-if-tab-else-CSV, applied column-by-column from the selection's anchor across the
// current display column order — existing rows become stageEdit calls, rows past the loaded
// page become new pending inserts (one addInsertRow per pasted row, reused across its columns).
async function onPaste(): Promise<void> {
  if (!canEditTable.value) return;
  const sel = rt()?.selection;
  const p = page.value;
  if (!sel || !p) return;
  if (sel.kind !== 'cell' && sel.kind !== 'range' && sel.kind !== 'row') return;

  let clipboardText: string;
  try {
    clipboardText = await navigator.clipboard.readText();
  } catch {
    return;
  }
  if (!clipboardText) return;

  const grid = parseDelimited(clipboardText);
  const startRow =
    sel.kind === 'row' ? Math.min(...sel.rows) : sel.kind === 'range' ? sel.anchorRow : sel.row;
  const startCol = sel.kind === 'row' ? 0 : sel.kind === 'range' ? sel.anchorCol : sel.col;
  const columns = columnOrder.value;
  const insertIds = new Map<number, string>();

  for (let ri = 0; ri < grid.length; ri++) {
    const row = startRow + ri;
    if (row < 0) continue;
    const isNewRow = row >= p.rowCount;
    let insertId = insertIds.get(row);
    if (isNewRow && insertId === undefined) {
      insertId = addInsertRow(props.tabId, columns);
      insertIds.set(row, insertId);
    }
    const cols = grid[ri];
    for (let ci = 0; ci < cols.length; ci++) {
      const name = columns[startCol + ci];
      if (!name) continue;
      if (isNewRow) {
        if (insertId) stageInsertValue(props.tabId, insertId, name, cols[ci]);
      } else {
        stageEdit(props.tabId, row, name, cols[ci]);
      }
    }
  }
}

function scrollCellIntoView(row: number, displayCol: number): void {
  const el = containerRef.value;
  if (!el) return;
  // Every row's own `top` style is offset by one rowHeight for the header row above it (see the
  // header-row/grid-row template bindings) — this has to match or the target lands one row short.
  // P24 D6: `row` is a page-row index (what search/PK-FK-nav/add-row all address a row by); the
  // pixel position it scrolls to is the row's *display* position, which collapses to identity
  // when nothing is filtered.
  const rowTop = rowHeight.value + displayPositionOf(row) * rowHeight.value;
  const rowBottom = rowTop + rowHeight.value;
  if (rowTop < el.scrollTop) el.scrollTop = rowTop;
  else if (rowBottom > el.scrollTop + el.clientHeight) el.scrollTop = rowBottom - el.clientHeight;

  const colStart = offsets.value[displayCol] ?? 0;
  const colEnd = offsets.value[displayCol + 1] ?? colStart;
  if (colStart < el.scrollLeft) el.scrollLeft = colStart;
  else if (colEnd > el.scrollLeft + el.clientWidth) el.scrollLeft = colEnd - el.clientWidth;
  // A one-shot programmatic jump (search/PK-FK nav/add-row), not a scroll gesture — update
  // immediately rather than waiting a frame for onScroll's rAF coalescing.
  syncScrollState();
}

function onKeydown(e: KeyboardEvent): void {
  const runtimeEntry = rt();
  const p = page.value;
  if (!runtimeEntry || !p) return;

  // D1: fires only while the grid container itself has DOM focus (this handler is bound to
  // it) — every plain <input> in the app keeps using Electron's native role:'copy'/'paste'
  // instead, since `user-select: none` on .grid-cell leaves it nothing to act on here.
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'c') {
    e.preventDefault();
    onCopy();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'v') {
    e.preventDefault();
    void onPaste();
    return;
  }

  // P21 D5: dispatched through rowMenu() itself (the same builder onGutterContextMenu calls) so
  // the printed shortcut and the executed action can't drift, and `disabled: !canEdit` is honoured
  // for free — inert on a read-only table without restating that guard here. Only a row selection
  // has a rowMenu to dispatch into; a cell/range selection leaves Delete/Cmd+D inert by falling
  // through (the switch below has no case for either key).
  const rowShortcut = shortcutFor(e, ['grid.duplicateRows', 'grid.deleteRows']);
  if (rowShortcut && runtimeEntry.selection?.kind === 'row') {
    const { rows } = runtimeEntry.selection;
    const ran = runMenuShortcut(
      rowMenu({
        tabId: props.tabId,
        rows,
        qualifiedName: qualifiedName(),
        snapshot: rowSnapshot,
        canEdit: canEditTable.value,
      }),
      rowShortcut,
    );
    if (ran) e.preventDefault();
    return;
  }

  const sel = runtimeEntry.selection;
  if (!sel || (sel.kind !== 'cell' && sel.kind !== 'range')) return;
  let { row, col } = sel.kind === 'range' ? { row: sel.row, col: sel.col } : sel;
  if (e.key === 'Enter') {
    e.preventDefault();
    startEdit(row, col);
    return;
  }
  switch (e.key) {
    // P24 D11: steps by *display* position and clamps to the visible row count, so ArrowDown
    // never walks into a row the filter hid — otherwise the selection would vanish (it publishes
    // for a row nothing renders) with no visible cause.
    case 'ArrowUp':
      row = rowAtDisplayPosition(Math.max(0, displayPositionOf(row) - 1));
      break;
    case 'ArrowDown':
      row = rowAtDisplayPosition(Math.min(displayRowCount.value - 1, displayPositionOf(row) + 1));
      break;
    case 'ArrowLeft':
      col = Math.max(0, col - 1);
      break;
    case 'ArrowRight':
      col = Math.min(columnOrder.value.length - 1, col + 1);
      break;
    default:
      return;
  }
  e.preventDefault();
  if (e.shiftKey) {
    const anchor =
      sel.kind === 'range'
        ? { row: sel.anchorRow, col: sel.anchorCol }
        : { row: sel.row, col: sel.col };
    runtimeEntry.selection = {
      kind: 'range',
      anchorRow: anchor.row,
      anchorCol: anchor.col,
      row,
      col,
    };
  } else {
    runtimeEntry.selection = { kind: 'cell', row, col };
  }
  scrollCellIntoView(row, col);
}

defineExpose({ scrollCellIntoView });
</script>

<template>
  <div
    ref="containerRef"
    class="data-grid"
    data-testid="data-grid"
    :data-pagination="rt()?.lastStrategy"
    tabindex="0"
    @scroll="onScroll"
    @keydown="onKeydown"
  >
    <EmptyState
      v-if="page && page.rowCount === 0"
      class="no-rows"
      icon="table"
      label="No rows"
      data-testid="grid-no-rows"
    />
    <!-- P24 D8: filtering to zero matches is a distinct empty state from "the table is empty"
         (LAW 15 names both by name) — but a pending insert row is work in progress, not a search
         result, so its presence keeps the grid itself on screen even with zero real matches. -->
    <EmptyState
      v-else-if="page && displayRows && displayRowCount === 0 && insertRows.length === 0"
      class="no-rows"
      icon="search"
      label="No matching rows"
      data-testid="grid-no-matching-rows"
    >
      <AppButton data-testid="grid-show-all-rows" @click="setSearchFiltering(props.tabId, false)">
        Show all rows
      </AppButton>
    </EmptyState>
    <div
      v-else-if="page"
      class="grid-sizer"
      :style="{ width: `${totalWidth + GUTTER_WIDTH}px`, height: `${totalHeight + rowHeight}px` }"
    >
      <div class="header-row" :style="{ height: `${rowHeight}px` }">
        <div class="gutter-cell header-gutter" :style="{ width: `${GUTTER_WIDTH}px` }" />
        <div
          v-for="c in visibleColumnIndices"
          :key="columnOrder[c]"
          class="header-cell"
          data-testid="grid-header-cell"
          :data-column="columnOrder[c]"
          v-tooltip="headerTitleFor(columnOrder[c])"
          :style="{
            left: `${GUTTER_WIDTH + offsets[c]}px`,
            width: `${offsets[c + 1] - offsets[c]}px`,
          }"
          @click="onHeaderClick(columnOrder[c])"
          @contextmenu.prevent="onHeaderContextMenu(c, $event)"
        >
          <span class="header-label">{{ columnOrder[c] }}</span>
          <span
            v-if="keyLabelFor(c)"
            class="header-key mono"
            :class="{ 'is-fk': keyLabelFor(c) === 'FK' }"
            >{{ keyLabelFor(c) }}</span
          >
          <span v-if="currentSortDirection(columnOrder[c])" class="sort-chevron">{{
            currentSortDirection(columnOrder[c]) === 'asc' ? '▲' : '▼'
          }}</span>
          <span v-if="sortOrderIndex(columnOrder[c])" class="sort-order">{{
            sortOrderIndex(columnOrder[c])
          }}</span>
          <span
            role="button"
            aria-label="Select column"
            class="header-select-zone"
            @click.stop="onHeaderSelectClick(c, $event)"
          />
          <span
            class="resize-handle"
            @pointerdown="onResizeStart($event, columnOrder[c])"
            @pointermove="onResizeMove"
            @pointerup="onResizeEnd"
            @click.stop
          />
        </div>
      </div>

      <!-- P24 D3/D4: `r` is the row's real page-row index (what selection/gutter number/pending
           changes all address it by, unchanged by filtering — D4); `pos` is separately its
           display position, used only for pixel placement, so the gutter still reads the row's
           true number (`3, 17, 84, …`) even while filtered. -->
      <div
        v-for="{ row: r, pos } in visibleRows"
        :key="r"
        class="grid-row"
        data-testid="grid-row"
        :data-row="r"
        :class="{ 'pending-delete': isDeleted(r) }"
        :style="{ top: `${rowHeight + pos * rowHeight}px`, height: `${rowHeight}px` }"
      >
        <!-- scroll-margin-top = rowHeight on gutter/grid cells below: `.header-row` is
             position: sticky, which a native scrollIntoView(IfNeeded) call doesn't otherwise know
             to leave room for — without it, scrolling row 0's cell "into view" can land it flush
             against the container's top, right underneath the sticky header. -->
        <div
          class="gutter-cell"
          data-testid="grid-gutter-cell"
          :class="{ dirty: isDirtyRow(r) }"
          :style="{ width: `${GUTTER_WIDTH}px`, scrollMarginTop: `${rowHeight}px` }"
          @click="onGutterClick(r, $event)"
          @contextmenu.prevent="onGutterContextMenu(r, $event)"
        >
          {{ rowNumberBase + r + 1 }}
        </div>
        <div
          v-for="c in visibleColumnIndices"
          :key="columnOrder[c]"
          class="grid-cell"
          data-testid="grid-cell"
          :data-row="r"
          :data-column="columnOrder[c]"
          :data-null="displayCell(r, c).isNull"
          :class="
            cellClass({
              alignRight: alignFor(c) === 'right',
              selected: isSelected(r, c),
              searchMatch: isSearchMatch(r, c),
              searchMatchCurrent: isCurrentSearchMatch(r, c),
              pendingEdit: displayCell(r, c).staged,
              fk: isForeignKeyDisplayCol(c) && !displayCell(r, c).isNull,
              hasNav: !!cellNavEntry(r, c),
            })
          "
          :style="{
            left: `${GUTTER_WIDTH + offsets[c]}px`,
            width: `${offsets[c + 1] - offsets[c]}px`,
            scrollMarginTop: `${rowHeight}px`,
          }"
          @click="onCellClick(r, c, $event)"
          @dblclick="onCellDblClick(r, c)"
          @contextmenu.prevent="onCellContextMenu(r, c, $event)"
        >
          <input
            v-if="isEditing(r, c)"
            v-model="editingBuffer"
            class="cell-input"
            data-testid="grid-cell-input"
            autofocus
            @keydown="onEditKeydown"
            @blur="commitEdit"
            @click.stop
          />
          <template v-else-if="displayCell(r, c).isNull">
            <span class="cell-null">NULL</span>
          </template>
          <template v-else>
            {{ displayCell(r, c).text
            }}<span
              v-if="displayCell(r, c).truncated"
              class="truncated-marker"
              v-tooltip="'value truncated at 64 KB'"
              >…</span
            >
          </template>
          <button
            v-if="cellNavEntry(r, c)"
            type="button"
            class="cell-nav-btn"
            data-testid="cell-nav-button"
            :data-nav-kind="cellNavEntry(r, c)?.kind"
            :aria-label="cellNavEntry(r, c)?.kind === 'fk' ? 'Go to referenced row' : 'Referenced by'"
            @click.stop="onCellNavClick(r, c, $event)"
          >
            <CodiconIcon :name="cellNavEntry(r, c)?.kind === 'fk' ? 'arrow-right' : 'references'" :size="12" />
          </button>
        </div>
      </div>

      <!-- P24 D5: a pending insert is never hidden by the filter, whatever the query says — its
           *pixel* position follows the display row count (renders after the last visible row),
           but its *identity* (the pseudo row index the gutter click and pendingChanges use) stays
           `page.rowCount + idx`, unchanged. -->
      <div
        v-for="(insert, idx) in insertRows"
        :key="insert.id"
        class="grid-row pending-insert"
        data-testid="grid-row-insert"
        :data-insert-id="insert.id"
        :style="{
          top: `${rowHeight + displayPositionOf((page?.rowCount ?? 0) + idx) * rowHeight}px`,
          height: `${rowHeight}px`,
        }"
        @click="onGutterClick((page?.rowCount ?? 0) + idx, $event)"
      >
        <div class="gutter-cell inserted" :style="{ width: `${GUTTER_WIDTH}px` }">+</div>
        <div
          v-for="c in visibleColumnIndices"
          :key="columnOrder[c]"
          class="grid-cell insert-cell"
          data-testid="grid-cell-insert"
          :style="{ left: `${GUTTER_WIDTH + offsets[c]}px`, width: `${offsets[c + 1] - offsets[c]}px` }"
          @click.stop
        >
          <input
            class="cell-input"
            :value="insert.values[columnOrder[c]] ?? ''"
            @input="onInsertInput($event, insert.id, columnOrder[c])"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.data-grid {
  position: relative;
  height: 100%;
  overflow: auto;
  outline: none;
  font-size: var(--kira-t-md);
}

.grid-sizer {
  position: relative;
}

/* P16 design system's .p-thead/.p-th, adapted for this grid's virtualised (position: absolute)
   rows instead of the primitive's plain flex row — same tokens, same border-strong divider. */
.header-row {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border-strong);
}

.header-gutter {
  position: sticky;
  left: 0;
  z-index: 3;
  height: 100%;
  background: var(--kira-bg-elevated);
  border-right: var(--kira-border-width) solid var(--kira-border);
}

.header-cell {
  position: absolute;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: 0 var(--kira-s-4);
  box-sizing: border-box;
  border-right: var(--kira-border-width) solid var(--kira-border);
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-sm);
  cursor: pointer;
  user-select: none;
}

.header-label {
  color: var(--kira-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* FIX-8: PK/FK stated as a label, never inferred from colour alone (p-th's own .key). PK stays
   the original warn/yellow; FK is the only one that reads as info/blue. */
.header-key {
  color: var(--kira-warn);
  font-size: var(--kira-t-xs);
  flex-shrink: 0;
}
.header-key.is-fk {
  color: var(--kira-info);
}

.sort-chevron {
  color: var(--kira-accent);
  font-size: 9px;
  flex-shrink: 0;
}

.sort-order {
  color: var(--kira-accent-fg);
  background: var(--kira-accent);
  font-size: 9px;
  line-height: 1;
  min-width: 12px;
  height: 12px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 2px;
  flex-shrink: 0;
}

/* A narrow strip at the header cell's left edge, not the sort target (the label/chevron) nor
   the resize handle (the right edge) — click it to select the whole column, mirroring the row
   gutter's click-to-select-row. Kept out of the label's flow so it can never swallow the sort
   click that covers the rest of the cell. */
.header-select-zone {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 10px;
  cursor: pointer;
}

.resize-handle {
  position: absolute;
  top: 0;
  right: -2px;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  z-index: 1;
}

.grid-row {
  position: absolute;
  left: 0;
  right: 0;
}

/* No zebra striping — the design's own _gridrows.html/_style.css draws no alternating row
   colour, only the hover state below. */
.grid-row:hover .grid-cell:not(.selected),
.grid-row:hover .gutter-cell {
  background: var(--kira-hover);
}

.gutter-cell {
  position: sticky;
  left: 0;
  z-index: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: var(--kira-s-4);
  box-sizing: border-box;
  background: var(--kira-bg-elevated);
  color: var(--kira-fg-disabled);
  font-size: var(--kira-t-xs);
  border-right: var(--kira-border-width) solid var(--kira-border-strong);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  cursor: pointer;
}

/* README/FIX: a row with a staged edit or delete gets the same 2px warn rail the mockup's
   .tr.dirty .td.gutter::before draws — never a background tint across the whole row. */
.gutter-cell.dirty {
  position: relative;
}

.gutter-cell.dirty::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--kira-warn);
}

/* A pending-insert row is not "edited" (nothing existing changed) — same 2px rail treatment,
   coloured ok/green instead of warn/yellow so the two staged-change kinds read apart at a glance. */
.gutter-cell.inserted {
  position: relative;
}

.gutter-cell.inserted::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--kira-ok);
}

.grid-cell {
  position: absolute;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 var(--kira-s-4);
  box-sizing: border-box;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border-right: var(--kira-border-width) solid var(--kira-border);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  cursor: default;
  /* D1: guarantees the native role:'copy'/'paste' accelerators have nothing to act on while
     the grid has focus, so they never race the grid's own local Ctrl+C/Ctrl+V handler. */
  user-select: none;
}

.grid-cell.align-right {
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}

.grid-cell.fk {
  color: var(--kira-info);
}

/* The nav button only shows on hover/selected, but the text always truncates before its slot —
   otherwise it's only "over the text" once you're already hovering to click it. */
.grid-cell.has-nav {
  padding-right: calc(var(--kira-s-4) + 18px);
}

.grid-cell.selected {
  background: var(--kira-select);
  outline: var(--kira-border-width) solid var(--kira-focus);
  outline-offset: -1px;
}

.grid-cell.search-match {
  background: color-mix(in srgb, var(--kira-warn) 25%, transparent);
}

.grid-cell.search-match-current {
  background: var(--kira-warn);
  color: var(--kira-bg);
}

.cell-null {
  color: var(--kira-fg-disabled);
  font-style: italic;
}

.truncated-marker {
  color: var(--kira-fg-muted);
  margin-left: 2px;
  flex-shrink: 0;
}

/* p-td.edited: the warn colour is the whole affordance, never a background tint (that's reserved
   for selection/search) — a selected+edited cell still shows both, exactly like _gridrows.html's
   "sel edited" row. */
.grid-cell.pending-edit {
  color: var(--kira-warn);
}

/* P7 D5/D8: pure-CSS hover/selection affordance, no JS-tracked hover state — mirrors
   .header-select-zone/.resize-handle's own absolute-inside-absolute precedent above. */
.cell-nav-btn {
  display: none;
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  background: var(--kira-bg-elevated);
  color: var(--kira-fg-muted);
  cursor: pointer;
  z-index: 1;
}

.cell-nav-btn:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.grid-cell:hover .cell-nav-btn,
.grid-cell.selected .cell-nav-btn {
  display: flex;
}

.grid-row.pending-delete {
  text-decoration: line-through;
  opacity: 0.5;
}

.grid-row.pending-insert {
  background: color-mix(in srgb, var(--kira-accent) 8%, transparent);
}

/* Transparent, not an opaque fill: this input always sits inside a .grid-cell that already
   carries its own background (blue .selected for a normal edit, the accent-tinted row for an
   insert) — an opaque --kira-bg-input here just blotted out that cell's own colour with plain
   grey the instant you started typing. */
.cell-input {
  width: 100%;
  height: 100%;
  padding: 0;
  margin: 0;
  border: none;
  outline: 1px solid var(--kira-accent);
  outline-offset: -1px;
  background: transparent;
  color: var(--kira-fg);
  font: inherit;
}

/* An outline per input reads fine for the single active inline-edit cell, but every column of a
   freshly-added row gets one at once — the row's own accent tint (.pending-insert above) is
   already enough of a "this is new" signal without every cell boxed in blue too. */
.insert-cell .cell-input {
  outline: none;
}

.no-rows {
  position: absolute;
  inset: 0;
}
</style>
