<script setup lang="ts">
import { computed } from 'vue';
import { settingsState } from '../../state/settings';
import VirtualList from '../../workbench/VirtualList.vue';
import { alignmentFor, initialWidths } from '../grid/columns';
import { cell, documentRow, getPage, keyValueRow, pageVersion } from './resultPages';

// A lightweight, read-only sibling of DataGrid.vue (§8.14) — not a retrofit of it. A console
// result has no pager, no sort, no pending-changes, no persisted column widths/order: every one
// of DataGrid's other features exists to serve those, so reusing it here would mean stripping
// most of it back out. This keeps only what both share: columns.ts's width/alignment helpers —
// the page cache itself is `./resultPages.ts` (P8), a generic-`Page` sibling of `grid/page.ts`
// since a console result can be tabular (SQL) or document (Mongo shell) unlike a data tab.
const props = defineProps<{ pageKey: string }>();

const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

const page = computed(() => {
  // Establishes the reactive dependency — the page object itself is frozen and non-reactive.
  void pageVersion.n;
  return getPage(props.pageKey);
});

const widths = computed<Record<string, number>>(() =>
  page.value && page.value.kind === 'tabular' ? initialWidths(page.value) : {},
);
const totalWidth = computed(() => {
  const p = page.value;
  if (p?.kind !== 'tabular') return 0;
  return p.columns.reduce((sum, c) => sum + (widths.value[c.name] ?? 96), 56);
});
const rowIndices = computed(() => Array.from({ length: page.value?.rowCount ?? 0 }, (_, i) => i));

function cellAt(row: number, col: number) {
  return cell(props.pageKey, row, col);
}

function docRowAt(row: number) {
  return documentRow(props.pageKey, row) ?? { id: '', body: '' };
}

function kvRowAt(row: number) {
  return keyValueRow(props.pageKey, row) ?? { field: '', value: '' };
}
</script>

<template>
  <div class="console-result-grid" data-testid="console-result-grid">
    <div v-if="!page || page.rowCount === 0" class="no-rows">{{ page ? 'No rows' : '' }}</div>
    <VirtualList
      v-else-if="page.kind === 'tabular'"
      :items="rowIndices"
      :row-height="rowHeight"
      class="body"
      :style="{ '--total-width': `${totalWidth}px` }"
    >
      <template #header>
        <div class="row header-row p-thead" :style="{ height: `${rowHeight}px` }">
          <div class="gutter-cell header-gutter p-th" />
          <div
            v-for="col in page.columns"
            :key="col.name"
            class="cell header-cell p-th"
            :class="{ 'align-right': alignmentFor(col) === 'right' }"
            :style="{ width: `${widths[col.name]}px` }"
          >
            <span class="name">{{ col.name }}</span>
            <span class="p-badge" :title="col.dataType">{{ col.dataType }}</span>
          </div>
        </div>
      </template>
      <template #default="{ item: r }">
        <div class="row" data-testid="console-result-row" :style="{ height: `${rowHeight}px` }">
          <div class="gutter-cell p-td gutter">{{ r + 1 }}</div>
          <div
            v-for="(col, c) in page.columns"
            :key="col.name"
            class="cell p-td"
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
    <VirtualList v-else-if="page.kind === 'document'" :items="rowIndices" :row-height="96" class="body doc-body">
      <template #default="{ item: r }">
        <div class="doc-row" data-testid="console-result-doc-row">
          <div class="doc-id">{{ docRowAt(r).id }}</div>
          <pre class="doc-body-text">{{ docRowAt(r).body }}</pre>
        </div>
      </template>
    </VirtualList>
    <VirtualList v-else :items="rowIndices" :row-height="rowHeight" class="body">
      <template #default="{ item: r }">
        <div class="row" data-testid="console-result-kv-row" :style="{ height: `${rowHeight}px` }">
          <div class="cell kv-field">{{ kvRowAt(r).field }}</div>
          <div class="cell kv-value">{{ kvRowAt(r).value }}</div>
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
  font-size: var(--kira-t-md);
}

.body {
  height: 100%;
}

.row {
  display: flex;
  width: var(--total-width);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

/* header-row also carries the shared .p-thead primitive (background, base border) — this just
   pins the stronger border-strong colour Console.html's thead uses, since a same-specificity
   scoped rule for .row would otherwise win over the global .p-thead one for that property. */
.header-row {
  border-bottom: var(--kira-border-width) solid var(--kira-border-strong);
}

/* Width only: header cells add the shared .p-th primitive (data cells .p-td, gutter cells
   .p-td.gutter — "tabular body shared by grid / kv / stream / console") for padding, colour,
   border and font-size, so those aren't re-declared here. kv/doc rows below don't use those
   primitives (their layout isn't a fixed-width column grid), so they keep their own rules. */
.gutter-cell {
  flex-shrink: 0;
  width: 56px;
}

.cell {
  flex-shrink: 0;
  overflow: hidden;
  white-space: nowrap;
}

.cell.align-right {
  justify-content: flex-end;
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
  font-size: var(--kira-t-sm);
}

.doc-body {
  padding: var(--kira-s-2);
}

.doc-row {
  padding: var(--kira-s-3) var(--kira-s-4);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.doc-id {
  font-size: var(--kira-t-xs);
  color: var(--kira-fg-muted);
  margin-bottom: 2px;
}

.doc-body-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--kira-font-family);
}

.kv-field {
  width: 200px;
  display: flex;
  align-items: center;
  padding: 0 var(--kira-s-4);
  color: var(--kira-fg-muted);
  text-overflow: ellipsis;
}

.kv-value {
  flex: 1;
  display: flex;
  align-items: center;
  padding: 0 var(--kira-s-4);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
