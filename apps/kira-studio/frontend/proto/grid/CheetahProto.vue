<script setup lang="ts">
import { useMutationObserver } from '@vueuse/core';
import { type ListGrid, themes } from 'cheetah-grid';
import { markRaw, nextTick, onMounted, onScopeDispose, ref } from 'vue';
import { CGrid, CGridColumn } from 'vue-cheetah-grid';
import { setVisibleWindow } from '../../src/views/grid/page';
import {
  GUTTER_WIDTH,
  headerAwareMinWidth,
  initialWidthsByIndex,
} from '../../src/views/shared/page/columns';
import { CellColumn, createRecordClass, GutterColumn, type NavKind } from './cellColumn';
import { DataSource } from './cheetahTypes';
import { createProtoData, GUTTER_FIELD, readParams } from './data';
import { createState, HEADER_ROWS, pageRowOf } from './state';
import { buildTheme, readPalette } from './theme';

const params = readParams(window.location.search);
const data = createProtoData(params.fixture);
const state = createState(data, params, readPalette(params.rowHeight ?? undefined));
const Record = createRecordClass(state);

const gridRef = ref<{ rawGrid: unknown } | null>(null);
let raw: ListGrid<unknown> | null = null;

function cellBg({ col, row }: { col: number; row: number }): string {
  const p = state.palette;
  if (row < HEADER_ROWS || col === 0) return p.bgChrome;
  const sel = raw?.selection;
  if (sel) {
    const r = sel.range;
    if (col >= r.start.col && col <= r.end.col && row >= r.start.row && row <= r.end.row) {
      return p.select;
    }
  }
  return state.params.zebra && row % 2 === 0 ? p.hover : p.bg;
}

function currentTheme() {
  return themes.of(buildTheme(state.palette, cellBg));
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
const order = ref(data.columns.map((_, index) => index));
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
  raw.theme = currentTheme();
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

onMounted(async () => {
  await nextTick();
  raw = (gridRef.value?.rawGrid ?? null) as ListGrid<unknown> | null;
  if (!raw) return;
  const grid = raw;
  const id = grid.listen('scroll', () => {
    const top = grid.topRow - HEADER_ROWS;
    setVisibleWindow(data.scope, pageRowOf(state, Math.max(0, top)), pageRowOf(state, Math.max(0, top + grid.visibleRowCount)));
  });
  onScopeDispose(() => grid.unlisten?.(id));
});
</script>

<template>
  <div
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
