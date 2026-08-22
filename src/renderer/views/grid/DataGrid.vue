<script setup lang="ts">
import type { ColumnDescriptor } from '@shared/protocol/page';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { settingsState } from '../../state/settings';
import { patchTabState, tabsState } from '../../state/tabs';
import { alignmentFor, columnOffsets, initialWidths, visibleColumnRange } from './columns';
import { cell, getPage, pageVersion, setVisibleWindow } from './page';
import { searchState } from './search';
import { runtime, setSort } from './state';

const props = defineProps<{ tabId: string }>();

const GUTTER_WIDTH = 56;
const OVERSCAN_ROWS = 8;

const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

function tab() {
  return tabsState.tabs.find((t) => t.id === props.tabId) ?? null;
}

const page = computed(() => {
  // Establishes the reactive dependency — the page object itself is frozen and non-reactive.
  void pageVersion.n;
  return getPage(props.tabId);
});

const columnOrder = computed<string[]>(() => {
  const p = page.value;
  if (!p) return [];
  const names = p.columns.map((c) => c.name);
  const stored = tab()?.state.columnOrder;
  if (!stored) return names;
  const known = new Set(names);
  const kept = stored.filter((n) => known.has(n));
  const missing = names.filter((n) => !kept.includes(n));
  return [...kept, ...missing];
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
const totalHeight = computed(() => (page.value?.rowCount ?? 0) * rowHeight.value);

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
onUnmounted(() => resizeObserver?.disconnect());

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

// Position in `columnOrder` -> index into the page's own `columns`/`chunks` arrays.
const displayIndexToPageIndex = computed(() => {
  const p = page.value;
  if (!p) return [];
  const nameToIndex = new Map(p.columns.map((c, i) => [c.name, i]));
  return columnOrder.value.map((name) => nameToIndex.get(name) ?? -1);
});

let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
watch([scrollTop, scrollLeft], () => {
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => {
    patchTabState(props.tabId, { scrollTop: scrollTop.value, scrollLeft: scrollLeft.value });
  }, 300);
});

function cellAt(row: number, displayCol: number) {
  const pageCol = displayIndexToPageIndex.value[displayCol];
  if (pageCol === undefined || pageCol < 0) return { text: '', isNull: true, truncated: false };
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
    patchTabState(props.tabId, {
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
  patchTabState(props.tabId, { columnOrder: order });
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
  const pageCol = displayIndexToPageIndex.value[displayCol];
  return matchIndex.value?.set.has(`${row}:${pageCol}`) ?? false;
}
function isCurrentSearchMatch(row: number, displayCol: number): boolean {
  const pageCol = displayIndexToPageIndex.value[displayCol];
  const current = matchIndex.value?.current;
  return !!current && current.row === row && current.col === pageCol;
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
        :style="{ top: `${rowHeight + r * rowHeight}px`, height: `${rowHeight}px` }"
      >
        <div
          class="gutter-cell"
          data-testid="grid-gutter-cell"
          :style="{ width: `${GUTTER_WIDTH}px` }"
          @click="onGutterClick(r)"
        >
          {{ r + 1 }}
        </div>
        <div
          v-for="c in visibleColumnIndices"
          :key="columnOrder[c]"
          class="grid-cell"
          data-testid="grid-cell"
          :data-row="r"
          :data-column="columnOrder[c]"
          :data-null="cellAt(r, c).isNull"
          :class="{
            'align-right': alignFor(c) === 'right',
            selected: isSelected(r, c),
            'search-match': isSearchMatch(r, c),
            'search-match-current': isCurrentSearchMatch(r, c),
          }"
          :style="{ left: `${GUTTER_WIDTH + offsets[c]}px`, width: `${offsets[c + 1] - offsets[c]}px` }"
          @click="onCellClick(r, c, $event)"
        >
          <span v-if="cellAt(r, c).isNull" class="cell-null">NULL</span>
          <template v-else>
            {{ cellAt(r, c).text
            }}<span
              v-if="cellAt(r, c).truncated"
              class="truncated-marker"
              title="value truncated at 64 KB"
              >…</span
            >
          </template>
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

.header-select-zone {
  position: absolute;
  inset: 0;
  z-index: -1;
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

.no-rows {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--kira-fg-muted);
}
</style>
