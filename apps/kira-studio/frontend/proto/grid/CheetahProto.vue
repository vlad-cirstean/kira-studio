<script setup lang="ts">
import { useEventListener, useMutationObserver } from '@vueuse/core';
import { useContextMenuStore } from '@workbench/state/contextMenu';
import { type ListGrid, themes } from 'cheetah-grid';
import { markRaw, nextTick, onMounted, onScopeDispose, ref } from 'vue';
import { CGrid, CGridColumn } from 'vue-cheetah-grid';
import { setVisibleWindow } from '../../src/views/grid/page';
import {
  GUTTER_WIDTH,
  headerAwareMinWidth,
  initialWidthsByIndex,
} from '../../src/views/shared/page/columns';
import { CellColumn, GutterColumn, type NavKind } from './cellColumn';
import { DataSource } from './cheetahTypes';
import { copySelection, selectionText } from './clipboard';
import { createProtoData, GUTTER_FIELD, readParams } from './data';
import { installDebugHook } from './debugHook';
import { cellMenu, columnMenu, headerMenu, type MenuActions, rangeMenu, rowMenu } from './menus';
import { createRecordClass } from './records';
import {
  covers,
  dragRows,
  EMPTY,
  rowSelected,
  type SelectionState,
  selectAll,
  selectCell,
  selectColumns,
  selectedRows,
  selectRows,
} from './selection';
import { createState, HEADER_ROWS, pageRowOf } from './state';
import { buildTheme, readPalette } from './theme';

const params = readParams(window.location.search);
const data = createProtoData(params.fixture);
const state = createState(data, params, readPalette(params.rowHeight ?? undefined));
const Record = createRecordClass(state);
const contextMenu = useContextMenuStore();

const gridRef = ref<{ rawGrid: unknown } | null>(null);
let raw: ListGrid<unknown> | null = null;

function cellBg({ col, row }: { col: number; row: number }): string {
  const p = state.palette;
  if (row < HEADER_ROWS || col === 0) return p.bgChrome;
  const record = row - HEADER_ROWS;
  if (covers(state.selection.sel, record, col - 1)) return p.select;
  if (state.hoverRow >= 0 && record < state.rowCount() && pageRowOf(state, record) === state.hoverRow) {
    return p.hover;
  }
  return state.params.zebra && record % 2 === 1 ? p.bgChrome : p.bg;
}

const themeDefine = markRaw(buildTheme(state.palette, cellBg));
const source = markRaw(
  new DataSource({
    length: data.rowCount,
    get: (index) => new Record(pageRowOf(state, index)),
  }),
);

const fkNames = new Set(data.fk.keys());
const navFor = (index: number): NavKind | null => {
  const column = data.columns[index];
  if (!column) return null;
  if (fkNames.has(column.name)) return 'fk';
  return column.isPrimaryKey ? 'pk' : null;
};

const widths = initialWidthsByIndex(data.page);
const order = ref([...state.order]);
const gutterType = markRaw(new GutterColumn(state));
const columnTypes = data.columns.map((_, index) =>
  markRaw(new CellColumn(state, index, navFor(index))),
);

function headerStyle() {
  const p = state.palette;
  return { bgColor: p.bgChrome, color: p.fg, font: p.fontBold };
}

function minWidth(index: number): number {
  const column = data.columns[index];
  if (!column) return 0;
  return headerAwareMinWidth(column.name, {
    padding: 16,
    sortControl: 16,
    keyBadge: navFor(index) ? 20 : 0,
  });
}

function applyAppearance(): void {
  if (!raw) return;
  state.palette = readPalette(params.rowHeight ?? undefined);
  raw.theme = themes.of(buildTheme(state.palette, cellBg));
  raw.font = state.palette.font;
  raw.defaultRowHeight = state.palette.rowHeight;
  raw.headerRowHeight = state.palette.rowHeight;
  raw.underlayBackgroundColor = state.palette.bg;
  raw.updateSize();
  raw.invalidate();
}

useMutationObserver(document.documentElement, applyAppearance, {
  attributes: true,
  attributeFilter: ['style', 'class', 'data-proto-theme'],
});

function setSelection(next: SelectionState): void {
  state.selection = next;
  raw?.invalidate();
}

// Moving the native focus cell fires `selected_cell`, which would overwrite a selection this host
// just built (rows, columns, all). Programmatic moves run under this guard.
let programmatic = false;
function focusNative(record: number, displayCol: number): void {
  if (!raw) return;
  programmatic = true;
  try {
    raw.selection.select = { col: displayCol + 1, row: record + HEADER_ROWS };
  } finally {
    programmatic = false;
  }
  raw.focus();
}

function mirrorNative(): void {
  if (!raw || programmatic) return;
  const { start, end } = raw.selection.range;
  if (start.row < HEADER_ROWS) return;
  const select = raw.selection.select;
  const top = start.row - HEADER_ROWS;
  const bottom = end.row - HEADER_ROWS;
  const left = Math.max(0, start.col - 1);
  const right = Math.max(0, end.col - 1);
  const anchorRow = select.row - HEADER_ROWS;
  const anchorCol = Math.max(0, select.col - 1);
  if (top === bottom && left === right) {
    setSelection(selectCell(top, left));
    return;
  }
  setSelection({
    sel: { kind: 'range', anchorRow: top, anchorCol: left, row: bottom, col: right },
    anchorRow,
    anchorCol,
  });
}

function mods(e: MouseEvent): { shift: boolean; toggle: boolean } {
  return { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey };
}

let gutterDragFrom: number | null = null;
useEventListener(window, 'mouseup', () => {
  gutterDragFrom = null;
});

const actions: MenuActions = {
  state,
  hideColumn(displayCol) {
    state.order = state.order.filter((_, i) => i !== displayCol);
    order.value = [...state.order];
    setSelection(EMPTY);
  },
  showAllColumns() {
    state.order = data.columns.map((_, i) => i);
    order.value = [...state.order];
    setSelection(EMPTY);
  },
};

function openMenu(ev: MouseEvent, record: number, displayCol: number, header: boolean): void {
  ev.preventDefault();
  if (header) {
    const cols = state.selection.sel?.kind === 'column' ? state.selection.sel.cols : [];
    if (!cols.includes(displayCol)) setSelection(selectColumns(EMPTY, displayCol, mods(ev)));
    contextMenu.openContextMenu(ev, headerMenu(actions, displayCol));
    return;
  }
  if (displayCol < 0) {
    if (!rowSelected(state.selection.sel, record)) {
      setSelection(selectRows(state.selection, record, { shift: false, toggle: false }));
      focusNative(record, 0);
    }
    contextMenu.openContextMenu(ev, rowMenu(actions, selectedRows(state.selection.sel, state.rowCount())));
    return;
  }
  const { sel } = state.selection;
  const inside = covers(sel, record, displayCol);
  if (inside && sel?.kind === 'row') {
    contextMenu.openContextMenu(ev, rowMenu(actions, sel.rows));
  } else if (inside && sel?.kind === 'column') {
    contextMenu.openContextMenu(ev, columnMenu(actions, sel.cols));
  } else if (inside && sel && sel.kind !== 'cell') {
    contextMenu.openContextMenu(ev, rangeMenu(actions));
  } else {
    setSelection(selectCell(record, displayCol));
    focusNative(record, displayCol);
    contextMenu.openContextMenu(ev, cellMenu(actions, record, displayCol));
  }
}

function bindGrid(grid: ListGrid<unknown>): void {
  grid.listen('mousedown_cell', (e) => {
    if (e.event.button !== 0) return false;
    const record = e.row - HEADER_ROWS;
    if (e.row < HEADER_ROWS) {
      setSelection(e.col === 0 ? selectAll() : selectColumns(state.selection, e.col - 1, mods(e.event)));
      grid.focus();
      return false;
    }
    if (e.col === 0) {
      setSelection(selectRows(state.selection, record, mods(e.event)));
      gutterDragFrom = record;
      focusNative(record, 0);
      return false;
    }
    return true;
  });
  grid.listen('mouseenter_cell', (e) => {
    if (e.row < HEADER_ROWS) return;
    const record = e.row - HEADER_ROWS;
    if (gutterDragFrom !== null && e.col === 0) {
      setSelection(dragRows(state.selection, gutterDragFrom, record));
    }
    const pageRow = pageRowOf(state, record);
    if (pageRow === state.hoverRow) return;
    const previous = state.hoverRow;
    state.hoverRow = pageRow;
    const last = grid.colCount - 1;
    grid.invalidateGridRect(0, e.row, last, e.row);
    const prevRecord = previous < 0 ? -1 : (state.rowOrder?.indexOf(previous) ?? previous);
    if (prevRecord >= 0) grid.invalidateGridRect(0, prevRecord + HEADER_ROWS, last, prevRecord + HEADER_ROWS);
  });
  grid.listen('selected_cell', (e) => {
    if (e.selected) mirrorNative();
  });
  grid.listen('contextmenu_cell', (e) => {
    const record = e.row - HEADER_ROWS;
    openMenu(e.event, record, e.col - 1, e.row < HEADER_ROWS);
  });
  grid.listen('keydown', (e) => {
    const chord = e.event.metaKey || e.event.ctrlKey;
    if (chord && e.event.key.toLowerCase() === 'c') {
      e.event.preventDefault();
      void copySelection(state);
    } else if (chord && e.event.key.toLowerCase() === 'a') {
      e.event.preventDefault();
      setSelection(selectAll());
    }
  });
  grid.listen('copydata', () => selectionText(state));
  const scrollId = grid.listen('scroll', () => {
    const top = Math.max(0, grid.topRow - HEADER_ROWS);
    const bottom = Math.min(state.rowCount() - 1, top + grid.visibleRowCount);
    setVisibleWindow(data.scope, pageRowOf(state, top), pageRowOf(state, Math.max(top, bottom)));
  });
  onScopeDispose(() => grid.unlisten(scrollId));
}

const rootRef = ref<HTMLElement | null>(null);
useEventListener(rootRef, 'mouseleave', onLeave);

function onLeave(): void {
  if (state.hoverRow < 0 || !raw) return;
  const previous = state.hoverRow;
  state.hoverRow = -1;
  const record = state.rowOrder?.indexOf(previous) ?? previous;
  raw.invalidateGridRect(0, record + HEADER_ROWS, raw.colCount - 1, record + HEADER_ROWS);
}

onMounted(async () => {
  await nextTick();
  raw = (gridRef.value?.rawGrid ?? null) as ListGrid<unknown> | null;
  if (!raw) return;
  bindGrid(raw);
  if (__KIRA_DEBUG_HOOKS__) installDebugHook({ grid: raw, state });
});
</script>

<template>
  <div
    ref="rootRef"
    class="relative min-h-0 flex-1 overflow-hidden"
    data-testid="data-grid"
    :style="{ width: params.width ? `${params.width}px` : undefined, height: params.height ? `${params.height}px` : undefined, flex: params.height ? 'none' : undefined }"
  >
    <CGrid
      ref="gridRef"
      :data="source"
      :theme="themeDefine"
      :font="state.palette.font"
      :underlay-background-color="state.palette.bg"
      :frozen-col-count="1"
      :default-row-height="state.palette.rowHeight"
      :header-row-height="state.palette.rowHeight"
      :move-cell-on-tab-key="true"
      :move-cell-on-enter-key="true"
    >
      <CGridColumn
        :field="GUTTER_FIELD"
        :width="GUTTER_WIDTH"
        :min-width="GUTTER_WIDTH"
        :max-width="GUTTER_WIDTH"
        :column-type="gutterType"
        :header-style="headerStyle()"
      >
        {{ '' }}
      </CGridColumn>
      <CGridColumn
        v-for="index in order"
        :key="data.columns[index]?.name"
        :field="data.columns[index]?.name"
        :width="widths[index]"
        :min-width="minWidth(index)"
        :column-type="columnTypes[index]"
        :header-style="headerStyle()"
      >
        {{ data.columns[index]?.name }}
      </CGridColumn>
    </CGrid>
  </div>
</template>
