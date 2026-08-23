<script setup lang="ts">
import { computed } from 'vue';
import { settingsState } from '../../state/settings';
import VirtualList from '../../workbench/VirtualList.vue';
import { alignmentFor, initialWidths } from '../grid/columns';
import { cell, getPage, pageVersion } from '../grid/page';

// A lightweight, read-only sibling of DataGrid.vue (§8.14) — not a retrofit of it. A console
// result has no pager, no sort, no pending-changes, no persisted column widths/order: every one
// of DataGrid's other features exists to serve those, so reusing it here would mean stripping
// most of it back out. This keeps only what both share: views/grid/page.ts's page cache (so a
// 600 000-cell result costs no more here than in the data grid) and columns.ts's width/alignment
// helpers.
const props = defineProps<{ pageKey: string }>();

const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

const page = computed(() => {
  // Establishes the reactive dependency — the page object itself is frozen and non-reactive.
  void pageVersion.n;
  return getPage(props.pageKey);
});

const widths = computed<Record<string, number>>(() =>
  page.value ? initialWidths(page.value) : {},
);
const totalWidth = computed(() =>
  page.value ? page.value.columns.reduce((sum, c) => sum + (widths.value[c.name] ?? 96), 56) : 0,
);
const rowIndices = computed(() => Array.from({ length: page.value?.rowCount ?? 0 }, (_, i) => i));

function cellAt(row: number, col: number) {
  return cell(props.pageKey, row, col);
}
</script>

<template>
  <div class="console-result-grid" data-testid="console-result-grid">
    <div v-if="!page || page.rowCount === 0" class="no-rows">{{ page ? 'No rows' : '' }}</div>
    <VirtualList
      v-else
      :items="rowIndices"
      :row-height="rowHeight"
      class="body"
      :style="{ '--total-width': `${totalWidth}px` }"
    >
      <template #header>
        <div class="row header-row" :style="{ height: `${rowHeight}px` }">
          <div class="gutter-cell header-gutter" />
          <div
            v-for="col in page!.columns"
            :key="col.name"
            class="cell header-cell"
            :class="{ 'align-right': alignmentFor(col) === 'right' }"
            :style="{ width: `${widths[col.name]}px` }"
            :title="col.dataType"
          >
            {{ col.name }}
          </div>
        </div>
      </template>
      <template #default="{ item: r }">
        <div class="row" data-testid="console-result-row" :style="{ height: `${rowHeight}px` }">
          <div class="gutter-cell">{{ r + 1 }}</div>
          <div
            v-for="(col, c) in page!.columns"
            :key="col.name"
            class="cell"
            data-testid="console-result-cell"
            :data-null="cellAt(r, c).isNull"
            :class="{ 'align-right': alignmentFor(col) === 'right' }"
            :style="{ width: `${widths[col.name]}px` }"
          >
            <template v-if="cellAt(r, c).isNull">
              <span class="cell-null">NULL</span>
            </template>
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
      </template>
    </VirtualList>
  </div>
</template>

<style scoped>
.console-result-grid {
  height: 100%;
  min-height: 0;
  font-family: var(--kira-font-family);
  font-size: var(--kira-font-size);
}

.body {
  height: 100%;
}

.row {
  display: flex;
  width: var(--total-width);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.header-row {
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border-strong);
  font-weight: 600;
}

.gutter-cell {
  flex-shrink: 0;
  width: 56px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 8px;
  color: var(--kira-fg-muted);
  border-right: var(--kira-border-width) solid var(--kira-border);
}

.cell {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 6px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border-right: var(--kira-border-width) solid var(--kira-border);
}

.cell.align-right {
  justify-content: flex-end;
}

.header-cell {
  color: var(--kira-fg);
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
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--kira-fg-muted);
  font-size: 12px;
}
</style>
