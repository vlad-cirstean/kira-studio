<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import SearchToolbar from './SearchToolbar.vue';
import { openContextMenu } from './state/contextMenu';
import { loadTabData } from './state/data';
import { parseOrderByResolved } from './orderby';
import {
  getPage,
  getPageVersion,
  setPage,
  tabsState,
  updateTabState,
  type Tab,
} from './state/tabs';

// The two-axis virtualized grid (P2 D22). One scroll container with a sizing spacer; the sticky
// header and row gutter render only visible items; the cell layer renders one row div per visible
// row, absolutely positioned. Row data lives in a frozen non-reactive PageView (D22) and the grid
// re-renders off an explicit version counter + scroll position — Vue tracks indices, never data.
//
// Reactive state is exactly: scroll viewport (4 numbers), the page version, and selection. O(rows)
// data is never reactive.

const props = defineProps<{ tab: Tab }>();

const root = ref<HTMLElement | null>(null);
const vp = reactive({ top: 0, left: 0, w: 0, h: 0 });
const version = ref(getPageVersion(props.tab.id));
const rowHeight = ref(28);
const searchOpen = ref(false);
const activeMatch = ref<{ row: number; col: number } | null>(null);

function onSearchOpen(): void {
  searchOpen.value = true;
  const el = root.value;
  if (el) el.focus();
}

// ---- page access ----
const pageView = computed(() => {
  void version.value;
  return getPage(props.tab.id);
});

const win = computed(() => {
  void version.value;
  const view = pageView.value;
  if (!view) return { r0: 0, r1: 0, c0: 0, c1: 0 };
  const overscanRows = 6;
  const overscanCols = 2;
  const r0 = Math.max(0, Math.floor(vp.top / rowHeight.value) - overscanRows);
  const r1 = Math.min(view.rowCount, Math.ceil((vp.top + vp.h) / rowHeight.value) + overscanRows);
  const c0 = Math.max(0, view.columns.findIndex((c) => c.left + c.width > vp.left) - overscanCols);
  const visibleCols = view.columns.filter((c) => c.left + c.width > vp.left && c.left < vp.left + vp.w);
  const last = visibleCols.length > 0 ? visibleCols[visibleCols.length - 1] : undefined;
  const c1 = last ? view.columns.indexOf(last) + 1 + overscanCols : view.columns.length;
  return { r0, r1, c0: Math.max(0, c0), c1: Math.min(view.columns.length, c1) };
});

const rows = computed(() => {
  const out: number[] = [];
  for (let i = win.value.r0; i < win.value.r1; i++) out.push(i);
  return out;
});

const visibleColumns = computed(() => {
  const view = pageView.value;
  if (!view) return [];
  return view.columns.slice(win.value.c0, win.value.c1);
});

// ---- scroll (passive listener → rAF flush, at most one re-render per frame) ----
let raf: number | null = null;
let pendingScroll = { top: 0, left: 0 };

function onScroll(): void {
  const el = root.value;
  if (!el) return;
  pendingScroll = { top: el.scrollTop, left: el.scrollLeft };
  if (!raf) raf = requestAnimationFrame(flush);
}

function flush(): void {
  raf = null;
  vp.top = pendingScroll.top;
  vp.left = pendingScroll.left;
}

let resizeObserver: ResizeObserver | null = null;

function readRowHeight(): void {
  const el = root.value;
  if (!el) return;
  rowHeight.value = Number.parseFloat(getComputedStyle(el).getPropertyValue('--kira-row-height')) || 28;
}

onMounted(() => {
  const el = root.value;
  if (el) {
    vp.w = el.clientWidth;
    vp.h = el.clientHeight;
    readRowHeight();
    resizeObserver = new ResizeObserver(() => {
      vp.w = el.clientWidth;
      vp.h = el.clientHeight;
    });
    resizeObserver.observe(el);
    el.scrollTop = props.tab.state.scrollTop;
    el.scrollLeft = props.tab.state.scrollLeft;
    pendingScroll = { top: props.tab.state.scrollTop, left: props.tab.state.scrollLeft };
    flush();
  }
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('kira:search-match', onSearchMatch);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (raf) cancelAnimationFrame(raf);
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('kira:search-match', onSearchMatch);
  updateTabState(props.tab.id, { scrollTop: vp.top, scrollLeft: vp.left });
});

function onSearchMatch(e: Event): void {
  activeMatch.value = (e as CustomEvent<{ row: number; col: number }>).detail ?? null;
}

watch(
  () => getPageVersion(props.tab.id),
  () => {
    version.value = getPageVersion(props.tab.id);
  },
);

// ---- cell helpers ----
function cellText(row: number, col: number): string {
  return pageView.value?.text(row, col) ?? '';
}

function cellTitle(row: number, col: number): string {
  const view = pageView.value;
  if (!view) return '';
  const text = view.text(row, col);
  return view.isTruncated(row, col) ? `${text}…` : text;
}

function cellClass(row: number, col: number): Record<string, boolean> {
  const view = pageView.value;
  if (!view) return {};
  const column = view.columns[col];
  const match = activeMatch.value !== null && activeMatch.value.row === row && activeMatch.value.col === col;
  return {
    'is-null': view.isNull(row, col),
    'is-truncated': view.isTruncated(row, col),
    'text-right': column?.align === 'right',
    'text-center': column?.align === 'center',
    selected: isSelected(row, col),
    'active-match': match,
  };
}

// ---- selection (P3 seam: activeTab.selection.focus + pageView.raw(row, col)) ----
const selection = computed(() => props.tab.runtime.selection);

function isSelected(row: number, col: number): boolean {
  const sel = selection.value;
  const r0 = Math.min(sel.anchor.row, sel.focus.row);
  const r1 = Math.max(sel.anchor.row, sel.focus.row);
  const c0 = Math.min(sel.anchor.col, sel.focus.col);
  const c1 = Math.max(sel.anchor.col, sel.focus.col);
  return row >= r0 && row <= r1 && col >= c0 && col <= c1;
}

function selectCell(row: number, col: number, shift = false): void {
  const sel = props.tab.runtime.selection;
  if (shift) {
    sel.focus = { row, col };
  } else {
    sel.anchor = { row, col };
    sel.focus = { row, col };
  }
  scrollToCell(row, col);
}

function scrollToCell(row: number, col: number): void {
  const view = pageView.value;
  const el = root.value;
  if (!view || !el) return;
  const column = view.columns[col];
  if (column) {
    if (column.left < vp.left) el.scrollLeft = Math.max(0, column.left - 8);
    else if (column.left + column.width > vp.left + vp.w) {
      el.scrollLeft = column.left + column.width - vp.w + 8;
    }
  }
  const rowTop = row * rowHeight.value;
  if (rowTop < vp.top) el.scrollTop = Math.max(0, rowTop - 8);
  else if (rowTop + rowHeight.value > vp.top + vp.h) {
    el.scrollTop = rowTop + rowHeight.value - vp.h + 8;
  }
}

// ---- keyboard navigation (Step 17) ----
function onKeydown(e: KeyboardEvent): void {
  if (tabsState.activeId !== props.tab.id) return;
  // ⌘F opens the page-local search toolbar (D19) — never a browser find, never a server query.
  if (e.metaKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    searchOpen.value = true;
    return;
  }
  if (e.key === 'Escape' && searchOpen.value) {
    searchOpen.value = false;
    return;
  }
  const view = pageView.value;
  if (!view) return;
  const sel = props.tab.runtime.selection;
  const step = (dr: number, dc: number): void => {
    const row = Math.min(view.rowCount - 1, Math.max(0, sel.focus.row + dr));
    const col = Math.min(view.columns.length - 1, Math.max(0, sel.focus.col + dc));
    selectCell(row, col, e.shiftKey);
    e.preventDefault();
  };
  switch (e.key) {
    case 'ArrowUp':
      step(-1, 0);
      break;
    case 'ArrowDown':
      step(1, 0);
      break;
    case 'ArrowLeft':
      step(0, -1);
      break;
    case 'ArrowRight':
      step(0, 1);
      break;
    case 'Home':
      selectCell(sel.focus.row, 0, e.shiftKey);
      e.preventDefault();
      break;
    case 'End':
      selectCell(sel.focus.row, view.columns.length - 1, e.shiftKey);
      e.preventDefault();
      break;
    case 'PageUp':
      step(-Math.floor(vp.h / rowHeight.value), 0);
      break;
    case 'PageDown':
      step(Math.floor(vp.h / rowHeight.value), 0);
      break;
    case 'Tab':
      e.preventDefault();
      step(0, e.shiftKey ? -1 : 1);
      break;
    default:
      break;
  }
}

// ---- sort through the header (D17) — rewrites the ORDER BY text box ----
function headerClick(column: { name: string }): void {
  const tab = props.tab;
  const parsed = parseOrderByResolved(tab.state.orderBy, pageView.value?.columns ?? []);
  let next = '';
  if (parsed === null || parsed[column.name] === undefined) {
    next = `"${column.name.replaceAll('"', '""')}" ASC`;
  } else if (parsed[column.name] === '↑') {
    next = `"${column.name.replaceAll('"', '""')}" DESC`;
  }
  applyOrderBy(next);
}

function applyOrderBy(orderBy: string): void {
  updateTabState(props.tab.id, {
    orderBy,
    cursor: { kind: 'offset', offset: 0 },
    pageIndex: 1,
    totalRows: null,
    totalExact: false,
  });
  void loadTabData(props.tab.id);
}

const sortIndicators = computed<Record<string, '↑' | '↓'>>(() => {
  return parseOrderByResolved(props.tab.state.orderBy, pageView.value?.columns ?? []) ?? {};
});

// ---- column resize (D28) / reorder / hide ----
function onHeaderPointerDown(column: { name: string }, event: PointerEvent): void {
  const headerEl = (event.currentTarget as HTMLElement);
  const rect = headerEl.getBoundingClientRect();
  const nearEdge = rect.right - event.clientX < 6;
  if (!nearEdge) return;
  const view = pageView.value;
  if (!view) return;
  const startX = event.clientX;
  const startWidth = view.columns.find((c) => c.name === column.name)?.width ?? 120;
  const onMove = (e: PointerEvent): void => {
    const delta = e.clientX - startX;
    view.setWidth(column.name, Math.max(60, startWidth + delta));
    updateTabState(props.tab.id, { columnWidths: widthsSnapshot(view) });
    version.value += 1;
  };
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  event.preventDefault();
}

function widthsSnapshot(view: { columns: ReadonlyArray<{ name: string; width: number }> }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of view.columns) out[c.name] = c.width;
  return out;
}

function onHeaderDoubleClick(column: { name: string }): void {
  const view = pageView.value;
  if (!view) return;
  const width = view.autoFit(column.name, 200);
  view.setWidth(column.name, width);
  updateTabState(props.tab.id, { columnWidths: widthsSnapshot(view) });
  version.value += 1;
}

function onHeaderContext(column: { name: string }, event: MouseEvent): void {
  event.preventDefault();
  openContextMenu(event, [
    { type: 'item', id: 'sort-asc', label: 'Sort ascending', icon: 'arrow-up', run: () => applyOrderBy(`"${column.name.replaceAll('"', '""')}" ASC`) },
    { type: 'item', id: 'sort-desc', label: 'Sort descending', icon: 'arrow-down', run: () => applyOrderBy(`"${column.name.replaceAll('"', '""')}" DESC`) },
    { type: 'item', id: 'clear-sort', label: 'Clear sort', icon: 'clear-all', run: () => applyOrderBy('') },
    { type: 'separator' },
    { type: 'item', id: 'hide-column', label: 'Hide column', icon: 'eye-closed', run: () => hideColumn(column.name) },
    { type: 'item', id: 'show-all-columns', label: 'Show all columns', icon: 'eye', run: () => showAllColumns() },
    { type: 'item', id: 'copy-column-name', label: 'Copy column name', icon: 'copy', run: () => { void navigator.clipboard.writeText(column.name); } },
  ]);
}

function hideColumn(name: string): void {
  const view = pageView.value;
  if (!view) return;
  const order = view.columns.filter((c) => c.name !== name).map((c) => c.name);
  updateTabState(props.tab.id, { columnOrder: order });
  rebuildView();
}

function showAllColumns(): void {
  updateTabState(props.tab.id, { columnOrder: [] });
  rebuildView();
}

function rebuildView(): void {
  const tab = props.tab;
  setPage(tab.id, null);
  void loadTabData(tab.id);
}

// Expose for test-build-only assertions (Step 9 acceptance): window.__kira.getPage(tabId) must fail
// isReactive, proving row data is never wrapped in a Vue proxy.
if (import.meta.env.DEV || (window as unknown as { __KIRA_TEST__?: boolean }).__KIRA_TEST__) {
  (window as unknown as { __kiraGrid?: unknown }).__kiraGrid = { getPage: (id: string) => getPage(id) };
}
</script>

<template>
  <div ref="root" class="data-grid" data-testid="data-grid" @scroll.passive="onScroll">
    <template v-if="pageView">
      <div
        class="spacer"
        :style="{ width: `${pageView.totalWidth}px`, height: `${pageView.rowCount * rowHeight}px` }"
      />
      <div class="gutter" :style="{ width: `${pageView.gutterWidth}px` }">
        <div
          v-for="row in rows"
          :key="`g-${row}`"
          class="gutter-cell"
          :style="{ top: `${row * rowHeight}px`, height: `${rowHeight}px` }"
          data-testid="grid-gutter-cell"
          @click="selectCell(row, 0, $event.shiftKey)"
        >
          {{ (pageView.offset ?? 0) + row + 1 }}
        </div>
      </div>
      <div class="header" :style="{ left: `${pageView.gutterWidth}px` }">
        <div
          v-for="column in visibleColumns"
          :key="column.name"
          class="header-cell"
          :style="{ left: `${column.left - pageView.gutterWidth}px`, width: `${column.width}px` }"
          :title="column.dataType"
          data-testid="grid-header"
          :data-column="column.name"
          @click="headerClick(column)"
          @dblclick="onHeaderDoubleClick(column)"
          @contextmenu.prevent="onHeaderContext(column, $event)"
          @pointerdown="onHeaderPointerDown(column, $event)"
        >
          <span class="header-label">{{ column.name }}</span>
          <span v-if="sortIndicators[column.name]" class="sort-indicator">
            {{ sortIndicators[column.name] }}
          </span>
        </div>
      </div>
      <div class="cells">
        <div
          v-for="row in rows"
          :key="row"
          class="row"
          :style="{ top: `${row * rowHeight}px`, height: `${rowHeight}px` }"
          data-testid="grid-row"
        >
          <div
            v-for="colIndex in visibleColumns"
            :key="colIndex.index"
            class="cell"
            :style="{
              left: `${colIndex.left}px`,
              width: `${colIndex.width}px`,
            }"
            :class="cellClass(row, colIndex.index)"
            :title="cellTitle(row, colIndex.index)"
            :data-selected="isSelected(row, colIndex.index)"
            data-testid="grid-cell"
            @click="selectCell(row, colIndex.index, $event.shiftKey)"
          >
            <span v-if="pageView.isNull(row, colIndex.index)" class="null-marker">[NULL]</span>
            <template v-else>
              <span class="cell-text">{{ cellText(row, colIndex.index) }}</span>
              <span v-if="pageView.isTruncated(row, colIndex.index)" class="trunc">…</span>
            </template>
          </div>
        </div>
      </div>
      <SearchToolbar v-if="searchOpen" :tab="props.tab" @close="searchOpen = false" />
    </template>
  </div>
</template>

<style scoped>
.data-grid {
  position: relative;
  height: 100%;
  overflow: auto;
  font-size: 12px;
  background: var(--kira-bg);
}

.spacer {
  position: absolute;
  top: 0;
  left: 0;
}

.header {
  position: sticky;
  top: 0;
  z-index: 3;
  height: 26px;
  display: flex;
}

.header-cell {
  position: absolute;
  top: 0;
  height: 26px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  box-sizing: border-box;
  border-right: 1px solid var(--kira-border);
  border-bottom: 1px solid var(--kira-border-strong);
  background: var(--kira-bg-chrome);
  color: var(--kira-fg-muted);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  user-select: none;
}

.header-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.sort-indicator {
  color: var(--kira-accent);
  flex-shrink: 0;
}

.gutter {
  position: sticky;
  left: 0;
  top: 26px;
  z-index: 2;
  background: var(--kira-bg-chrome);
  border-right: 1px solid var(--kira-border-strong);
}

.gutter-cell {
  position: absolute;
  right: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 8px;
  box-sizing: border-box;
  color: var(--kira-fg-disabled);
  font-size: 11px;
  cursor: pointer;
  user-select: none;
}

.cells {
  position: relative;
  top: 26px;
  left: 0;
}

.row {
  position: absolute;
  left: 0;
  width: 100%;
}

.cell {
  position: absolute;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  box-sizing: border-box;
  border-right: 1px solid var(--kira-border);
  border-bottom: 1px solid var(--kira-border);
  overflow: hidden;
  white-space: nowrap;
  color: var(--kira-fg);
  cursor: cell;
}

.cell:hover {
  background: var(--kira-hover);
}

.cell.selected {
  outline: 1px solid var(--kira-accent);
  outline-offset: -1px;
  background: color-mix(in srgb, var(--kira-accent) 18%, transparent);
}

.cell.active-match {
  background: color-mix(in srgb, var(--kira-warn) 45%, transparent);
  outline: 1px solid var(--kira-warn);
  outline-offset: -1px;
}

.cell.text-right {
  justify-content: flex-end;
}

.cell.text-center {
  justify-content: center;
}

.cell-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.null-marker {
  color: var(--kira-fg-disabled);
  font-style: italic;
}

.trunc {
  color: var(--kira-fg-disabled);
  flex-shrink: 0;
}
</style>
