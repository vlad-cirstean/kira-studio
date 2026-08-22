<script setup lang="ts">
import type { ColumnDescriptor } from '@shared/protocol/page';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  clearSelectedCellFor,
  publishSelectedCell,
  type SelectedCell,
} from '../../state/cellSelection';
import { connectionsState } from '../../state/connections';
import { settingsState } from '../../state/settings';
import { findDataTab, patchDataTabState } from '../../state/tabs';
import {
  alignmentFor,
  columnOffsets,
  initialWidths,
  pageColumnIndexFor,
  resolveColumnOrder,
  visibleColumnRange,
} from './columns';
import { cell, getPage, pageVersion, setVisibleWindow } from './page';
import {
  isPendingDelete,
  pendingFor,
  stagedValue,
  stageEdit,
  stageInsertValue,
} from './pendingChanges';
import { searchState } from './search';
import { runtime, setSort } from './state';

const props = defineProps<{ tabId: string }>();

const GUTTER_WIDTH = 56;
const OVERSCAN_ROWS = 8;

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

const hasPrimaryKey = computed(() => page.value?.columns.some((c) => c.isPrimaryKey) ?? false);
const isWritable = computed(() => {
  const t = tab();
  if (!t?.connectionId) return false;
  const record = connectionsState.records.find((r) => r.id === t.connectionId);
  return !record?.readOnly;
});
// Gates whether double-click/Enter starts an inline edit (D2/D14) — the toolbar's add/delete/
// preview/commit/discard buttons are gated on writability alone, never on hasPrimaryKey.
const canEditTable = computed(() => isWritable.value && hasPrimaryKey.value);

const totalHeight = computed(
  () => ((page.value?.rowCount ?? 0) + insertRows.value.length) * rowHeight.value,
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

function onScroll(): void {
  const el = containerRef.value;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  scrollLeft.value = el.scrollLeft;
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
  onScroll();
});
// The tab-id guard inside clearSelectedCellFor is load-bearing: MainView.vue keys DataView by
// tab id, so switching tabs unmounts one grid and mounts another in an order that is not safe
// to rely on. The guard means a late unmount here cannot clobber the freshly mounted tab's
// publication, and an early one is corrected by the new grid's `immediate` publish watch below.
onUnmounted(() => {
  resizeObserver?.disconnect();
  clearSelectedCellFor(props.tabId);
});

const rowRange = computed(() => {
  const rowCount = page.value?.rowCount ?? 0;
  const start = Math.max(0, Math.floor(scrollTop.value / rowHeight.value) - OVERSCAN_ROWS);
  const end = Math.min(
    rowCount,
    Math.ceil((scrollTop.value + viewportHeight.value) / rowHeight.value) + OVERSCAN_ROWS,
  );
  return { start, end };
});
const colRange = computed(() =>
  visibleColumnRange(scrollLeft.value, viewportWidth.value, offsets.value),
);

watch(rowRange, (r) => setVisibleWindow(props.tabId, r.start, r.end));

const visibleRowIndices = computed(() => {
  const out: number[] = [];
  for (let r = rowRange.value.start; r < rowRange.value.end; r++) out.push(r);
  return out;
});
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

function currentSortDirection(name: string): 'asc' | 'desc' | null {
  const sort = tab()?.state.sort;
  if (sort?.kind !== 'structured') return null;
  return sort.terms.find((t) => t.column === name)?.direction ?? null;
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

const dragColumn = ref<string | null>(null);
function onHeaderDragStart(e: DragEvent, name: string): void {
  dragColumn.value = name;
  e.dataTransfer?.setData('text/plain', name);
}
function onHeaderDrop(e: DragEvent, name: string): void {
  e.preventDefault();
  const source = dragColumn.value;
  dragColumn.value = null;
  if (!source || source === name) return;
  const order = [...columnOrder.value];
  const from = order.indexOf(source);
  const to = order.indexOf(name);
  if (from < 0 || to < 0) return;
  order.splice(from, 1);
  order.splice(to, 0, source);
  patchDataTabState(props.tabId, { columnOrder: order });
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
    const selected: SelectedCell = {
      tabId: props.tabId,
      connectionId: t.connectionId,
      path: t.path,
      columnIndex: pageCol,
      column: p.columns[pageCol],
      row: target.row,
      value: view.isNull ? null : view.text,
      truncated: view.truncated,
      hasPrimaryKey: hasPrimaryKey.value,
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
function onGutterClick(row: number): void {
  const runtimeEntry = rt();
  if (runtimeEntry) runtimeEntry.selection = { kind: 'row', rows: [row] };
}
function onHeaderSelectClick(displayCol: number): void {
  const runtimeEntry = rt();
  if (runtimeEntry) runtimeEntry.selection = { kind: 'column', cols: [displayCol] };
}

function scrollCellIntoView(row: number, displayCol: number): void {
  const el = containerRef.value;
  if (!el) return;
  const rowTop = row * rowHeight.value;
  const rowBottom = rowTop + rowHeight.value;
  if (rowTop < el.scrollTop) el.scrollTop = rowTop;
  else if (rowBottom > el.scrollTop + el.clientHeight) el.scrollTop = rowBottom - el.clientHeight;

  const colStart = offsets.value[displayCol] ?? 0;
  const colEnd = offsets.value[displayCol + 1] ?? colStart;
  if (colStart < el.scrollLeft) el.scrollLeft = colStart;
  else if (colEnd > el.scrollLeft + el.clientWidth) el.scrollLeft = colEnd - el.clientWidth;
  onScroll();
}

function onKeydown(e: KeyboardEvent): void {
  const runtimeEntry = rt();
  const p = page.value;
  if (!runtimeEntry || !p) return;
  const sel = runtimeEntry.selection;
  if (!sel || (sel.kind !== 'cell' && sel.kind !== 'range')) return;
  let { row, col } = sel.kind === 'range' ? { row: sel.row, col: sel.col } : sel;
  if (e.key === 'Enter') {
    e.preventDefault();
    startEdit(row, col);
    return;
  }
  switch (e.key) {
    case 'ArrowUp':
      row = Math.max(0, row - 1);
      break;
    case 'ArrowDown':
      row = Math.min(p.rowCount - 1, row + 1);
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
    <div v-if="page && page.rowCount === 0" class="no-rows">No rows</div>
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
          draggable="true"
          :style="{
            left: `${GUTTER_WIDTH + offsets[c]}px`,
            width: `${offsets[c + 1] - offsets[c]}px`,
          }"
          @click="onHeaderClick(columnOrder[c])"
          @dragstart="onHeaderDragStart($event, columnOrder[c])"
          @dragover.prevent
          @drop="onHeaderDrop($event, columnOrder[c])"
        >
          <span class="header-label">{{ columnOrder[c] }}</span>
          <span v-if="currentSortDirection(columnOrder[c])" class="sort-chevron">{{
            currentSortDirection(columnOrder[c]) === 'asc' ? '▲' : '▼'
          }}</span>
          <span
            role="button"
            aria-label="Select column"
            class="header-select-zone"
            @click.stop="onHeaderSelectClick(c)"
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

      <div
        v-for="r in visibleRowIndices"
        :key="r"
        class="grid-row"
        data-testid="grid-row"
        :data-row="r"
        :class="{ 'pending-delete': isDeleted(r) }"
        :style="{ top: `${rowHeight + r * rowHeight}px`, height: `${rowHeight}px` }"
      >
        <div
          class="gutter-cell"
          data-testid="grid-gutter-cell"
          :style="{ width: `${GUTTER_WIDTH}px` }"
          @click="onGutterClick(r)"
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
          :class="{
            'align-right': alignFor(c) === 'right',
            selected: isSelected(r, c),
            'search-match': isSearchMatch(r, c),
            'search-match-current': isCurrentSearchMatch(r, c),
            'pending-edit': displayCell(r, c).staged,
          }"
          :style="{ left: `${GUTTER_WIDTH + offsets[c]}px`, width: `${offsets[c + 1] - offsets[c]}px` }"
          @click="onCellClick(r, c, $event)"
          @dblclick="onCellDblClick(r, c)"
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
              title="value truncated at 64 KB"
              >…</span
            >
          </template>
        </div>
      </div>

      <div
        v-for="(insert, idx) in insertRows"
        :key="insert.id"
        class="grid-row pending-insert"
        data-testid="grid-row-insert"
        :data-insert-id="insert.id"
        :style="{
          top: `${rowHeight + ((page?.rowCount ?? 0) + idx) * rowHeight}px`,
          height: `${rowHeight}px`,
        }"
        @click="onGutterClick((page?.rowCount ?? 0) + idx)"
      >
        <div class="gutter-cell" :style="{ width: `${GUTTER_WIDTH}px` }">+</div>
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
  font-size: 12px;
}

.grid-sizer {
  position: relative;
}

.header-row {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.header-gutter {
  position: sticky;
  left: 0;
  z-index: 3;
  height: 100%;
  background: var(--kira-bg-elevated);
}

.header-cell {
  position: absolute;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  box-sizing: border-box;
  border-right: var(--kira-border-width) solid var(--kira-border);
  cursor: pointer;
  user-select: none;
  font-weight: 600;
}

.header-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sort-chevron {
  color: var(--kira-accent);
  font-size: 9px;
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

.grid-row:nth-child(even) {
  background: var(--kira-bg-elevated);
}

.grid-row:hover .grid-cell:not(.selected) {
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
  padding-right: 6px;
  box-sizing: border-box;
  background: var(--kira-bg);
  color: var(--kira-fg-muted);
  font-size: 11px;
  cursor: pointer;
}

.grid-cell {
  position: absolute;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 6px;
  box-sizing: border-box;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border-right: var(--kira-border-width) solid var(--kira-border);
  cursor: default;
}

.grid-cell.align-right {
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}

.grid-cell.selected {
  background: var(--kira-select);
  outline: 1px solid var(--kira-accent);
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

.grid-cell.pending-edit {
  background: color-mix(in srgb, var(--kira-accent) 18%, transparent);
}

.grid-row.pending-delete {
  text-decoration: line-through;
  opacity: 0.5;
}

.grid-row.pending-insert {
  background: color-mix(in srgb, var(--kira-accent) 8%, transparent);
}

.cell-input {
  width: 100%;
  height: 100%;
  padding: 0;
  margin: 0;
  border: none;
  outline: 1px solid var(--kira-accent);
  outline-offset: -1px;
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  font: inherit;
}

.no-rows {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--kira-fg-muted);
}
</style>
