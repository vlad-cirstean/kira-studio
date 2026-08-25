<script setup lang="ts">
import type { ColumnDescriptor } from '@shared/protocol/page';
import { computed, ref, watch } from 'vue';
import { publishSelectedCell, type SelectedCell } from '../../state/cellSelection';
import { appearanceVersion, settingsState } from '../../state/settings';
import { cellClass } from '../../theme/cellClass';
import VirtualList from '../../theme/primitives/VirtualList.vue';
import { alignmentFor, initialWidths, resetMeasureCtx } from '../shared/page/columns';
import { typeDescription } from '../shared/typeGlossary';
import { cell, documentRow, getPage, keyValueRow, pageVersion } from './resultPages';
import { type Match, matchedRows, searchState } from './search';

// A lightweight, read-only sibling of DataGrid.vue (§8.14) — not a retrofit of it. A console
// result has no pager, no sort, no pending-changes, no persisted column widths/order: every one
// of DataGrid's other features exists to serve those, so reusing it here would mean stripping
// most of it back out. This keeps only what both share: columns.ts's width/alignment helpers —
// the page cache itself is `./resultPages.ts` (P8), a generic-`Page` sibling of `grid/page.ts`
// since a console result can be tabular (SQL) or document (Mongo shell) unlike a data tab.
//
// tabId/connectionId/path are only here to publish into cellSelection.ts's shared slot
// (P8/P10's "publish into the same slot for their own views") — a console result has no
// addressable row/table to write back to, so every SelectedCell published from here leaves
// `onEdit` unset and the cell editor panel stays read-only for it, same as a page with no
// primary key.
const props = defineProps<{
  pageKey: string;
  tabId: string;
  connectionId: string | null;
  path: string;
}>();

const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

const page = computed(() => {
  // Establishes the reactive dependency — the page object itself is frozen and non-reactive.
  void pageVersion.n;
  return getPage(props.pageKey);
});

// P40 D16: the data-type badge in the header (Console.html's own mockup markup) has no
// counterpart in the data grid — DataGrid.vue has never carried one; the type lives in the header
// cell's tooltip instead (its own headerTitleFor, P31 D29). This is that same shape, narrowed to
// what a console result actually has: name, dataType, the type glossary's description — no DB
// comment line, since execute() never consults the catalog (postgres/console.ts's own doc
// comment: "console results are always read-only regardless" — there is no column to have one).
function headerTitleFor(col: ColumnDescriptor): string {
  const description = col.dataType ? typeDescription(col.dataType) : null;
  return [col.name, col.dataType, description].filter((line) => !!line).join('\n');
}

// P31 D11/F13: same reasoning as DataGrid.vue's own widths computed — without this, a font
// change leaves every result grid sized for whatever font was active when columns.ts's shared
// measuring context was first created, for the rest of the session.
watch(
  () => appearanceVersion.n,
  () => resetMeasureCtx(),
);

const widths = computed<Record<string, number>>(() => {
  void appearanceVersion.n;
  return page.value && page.value.kind === 'tabular' ? initialWidths(page.value) : {};
});
const totalWidth = computed(() => {
  const p = page.value;
  if (p?.kind !== 'tabular') return 0;
  return p.columns.reduce((sum, c) => sum + (widths.value[c.name] ?? 96), 56);
});

// P40 D10/D17: the same "hide non-matching rows" toggle grid/documents/keyvalue share (P24 D2) —
// a filtered row keeps its real page-row number in the gutter, same as those views.
const displayRows = computed<number[] | null>(() => matchedRows(props.tabId));
const rowIndices = computed(() => {
  void pageVersion.n;
  if (displayRows.value) return displayRows.value;
  return Array.from({ length: page.value?.rowCount ?? 0 }, (_, i) => i);
});

function cellAt(row: number, col: number) {
  return cell(props.pageKey, row, col);
}

function docRowAt(row: number) {
  return documentRow(props.pageKey, row) ?? { id: '', body: '' };
}

function kvRowAt(row: number) {
  return keyValueRow(props.pageKey, row) ?? { field: '', value: '' };
}

// Local to this one result panel (highlight only) — the actual cross-view selection lives in
// cellSelectionState.current (cellSelection.ts), which this just publishes into. Two different
// result panels can each show their own last-clicked cell highlighted at once; only whichever
// published most recently is what the cell editor panel actually displays.
const selected = ref<{ row: number; col: number } | null>(null);

function isSelected(row: number, col: number): boolean {
  return selected.value?.row === row && selected.value?.col === col;
}

// P40 D10: rebuilt only when the search result changes (a completed scan or prev/next), not per
// cell — mirrors KeyValueView.vue's own matchIndex.
const matchIndex = computed(() => {
  const entry = searchState[props.tabId];
  if (!entry) return null;
  const set = new Set<string>();
  for (const m of entry.matches) set.add(`${m.row}:${m.col}`);
  return { set, current: entry.index >= 0 ? entry.matches[entry.index] : undefined };
});
function isSearchMatch(row: number, col: number): boolean {
  return matchIndex.value?.set.has(`${row}:${col}`) ?? false;
}
function isCurrentSearchMatch(row: number, col: number): boolean {
  const current = matchIndex.value?.current;
  return !!current && current.row === row && current.col === col;
}

// The find toolbar's go-to-match (P40 D10) — rowIndices is the *filtered* array when the filter
// toggle is on, so a match's page-row number has to be looked up by position rather than assumed
// to equal it, same as DocumentView.vue's own onGoToMatch.
const listRef = ref<{ scrollToIndex: (index: number) => void } | null>(null);
function goToMatch(match: Match): void {
  const index = rowIndices.value.indexOf(match.row);
  if (index >= 0) listRef.value?.scrollToIndex(index);
}
defineExpose({ goToMatch });

function publish(selectedCell: Omit<SelectedCell, 'tabId' | 'connectionId' | 'path'>): void {
  publishSelectedCell({
    tabId: props.tabId,
    connectionId: props.connectionId,
    path: props.path,
    ...selectedCell,
  });
}

function selectTabularCell(row: number, col: number): void {
  const p = page.value;
  if (p?.kind !== 'tabular') return;
  const column = p.columns[col];
  if (!column) return;
  selected.value = { row, col };
  const view = cellAt(row, col);
  publish({
    columnIndex: col,
    column,
    row,
    value: view.isNull ? null : view.text,
    truncated: view.truncated,
    hasPrimaryKey: column.isPrimaryKey,
    // No onEdit: a console result has no addressable row/table to write a change back to, so
    // this stays view-only in the cell editor panel regardless of the column's own writability.
  });
}

// A console document/key-value result has no ColumnDescriptor of its own (P8's DocumentPage/
// KeyValuePage carry fixed semantic columns, not a caller projection) — built the same way
// DocumentView.vue's own publisher does, so the cell editor's format detector still recognizes it
// as JSON (P40 F11/D13: nothing here beautifies on seed — the raw text renders exactly as stored,
// only syntax-highlighted, until Beautify is pressed).
function selectDocumentRow(row: number): void {
  selected.value = { row, col: 0 };
  const doc = docRowAt(row);
  const column: ColumnDescriptor = {
    name: 'document',
    dataType: 'document',
    typeClass: 'json',
    nullable: false,
    isPrimaryKey: true,
    generated: false,
  };
  publish({
    columnIndex: 0,
    column,
    row,
    value: doc.body,
    truncated: false,
    hasPrimaryKey: true,
  });
}

function selectKeyValueRow(row: number): void {
  selected.value = { row, col: 0 };
  const kv = kvRowAt(row);
  const column: ColumnDescriptor = {
    name: kv.field || 'value',
    dataType: 'text',
    typeClass: 'text',
    nullable: false,
    isPrimaryKey: false,
    generated: false,
  };
  publish({
    columnIndex: 0,
    column,
    row,
    value: kv.value,
    truncated: false,
    hasPrimaryKey: false,
  });
}
</script>

<template>
  <div class="console-result-grid" data-testid="console-result-grid">
    <div v-if="!page || page.rowCount === 0" class="no-rows">{{ page ? 'No rows' : '' }}</div>
    <!-- P31 D19/P24 D8 precedent: filtering to zero matches is a distinct empty state from "no
         data loaded" — same discipline as KeyValueView.vue's own EmptyState pair. -->
    <div v-else-if="rowIndices.length === 0" class="no-rows" data-testid="console-no-matching-rows">
      No matching rows
    </div>
    <VirtualList
      v-else-if="page.kind === 'tabular'"
      ref="listRef"
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
            :class="cellClass({ alignRight: alignmentFor(col) === 'right' })"
            :style="{ width: `${widths[col.name]}px` }"
            v-tooltip="headerTitleFor(col)"
          >
            <span class="name">{{ col.name }}</span>
          </div>
        </div>
      </template>
      <template #default="{ item: r }">
        <div
          class="row"
          data-testid="console-result-row"
          :data-row="r"
          :style="{ height: `${rowHeight}px` }"
        >
          <div class="gutter-cell p-td gutter">{{ r + 1 }}</div>
          <div
            v-for="(col, c) in page.columns"
            :key="col.name"
            class="cell p-td"
            data-testid="console-result-cell"
            :data-null="cellAt(r, c).isNull"
            :class="
              cellClass({
                alignRight: alignmentFor(col) === 'right',
                selected: isSelected(r, c),
                searchMatch: isSearchMatch(r, c),
                searchMatchCurrent: isCurrentSearchMatch(r, c),
              })
            "
            :style="{ width: `${widths[col.name]}px` }"
            @click="selectTabularCell(r, c)"
          >
            <template v-if="cellAt(r, c).isNull">
              <span class="cell-null">NULL</span>
            </template>
            <template v-else>
              {{ cellAt(r, c).text
              }}<span
                v-if="cellAt(r, c).truncated"
                class="truncated-marker"
                v-tooltip="'value truncated at 64 KB'"
                >…</span
              >
            </template>
          </div>
        </div>
      </template>
    </VirtualList>
    <VirtualList
      v-else-if="page.kind === 'document'"
      ref="listRef"
      :items="rowIndices"
      :row-height="96"
      class="body doc-body"
    >
      <template #default="{ item: r }">
        <div
          class="doc-row"
          data-testid="console-result-doc-row"
          :data-row="r"
          :class="{
            selected: isSelected(r, 0),
            'search-match': isSearchMatch(r, 0),
            'search-match-current': isCurrentSearchMatch(r, 0),
          }"
          @click="selectDocumentRow(r)"
        >
          <div class="doc-id">{{ docRowAt(r).id }}</div>
          <pre class="doc-body-text">{{ docRowAt(r).body }}</pre>
        </div>
      </template>
    </VirtualList>
    <VirtualList v-else ref="listRef" :items="rowIndices" :row-height="rowHeight" class="body">
      <template #default="{ item: r }">
        <div
          class="row"
          data-testid="console-result-kv-row"
          :data-row="r"
          :class="{ selected: isSelected(r, 0) }"
          :style="{ height: `${rowHeight}px` }"
          @click="selectKeyValueRow(r)"
        >
          <div
            class="cell kv-field"
            :class="{
              'search-match': isSearchMatch(r, 0),
              'search-match-current': isCurrentSearchMatch(r, 0),
            }"
          >
            {{ kvRowAt(r).field }}
          </div>
          <div
            class="cell kv-value"
            :class="{
              'search-match': isSearchMatch(r, 1),
              'search-match-current': isCurrentSearchMatch(r, 1),
            }"
          >
            {{ kvRowAt(r).value }}
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
  cursor: default;
}

.cell.align-right {
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}

/* No zebra striping (DataGrid.vue's own rule/comment: "the design's own _gridrows.html/
   _style.css draws no alternating row colour, only the hover state") — P40 D17 parity. Scoped off
   .header-row: this grid's header/body rows share one .row class (DataGrid's own header-row never
   carries its .grid-row), so the exclusion is what this rule gets for free there. */
.row:not(.header-row):hover .cell:not(.selected),
.row:not(.header-row):hover .gutter-cell {
  background: var(--kira-hover);
}

/* Matches DataGrid.vue's .grid-cell.selected look (P8/P10 publish into the same cellSelection.ts
   slot the cell editor panel reads, so the same visual language applies here). */
.cell.selected {
  background: var(--kira-select);
  outline: var(--kira-border-width) solid var(--kira-focus);
  outline-offset: -1px;
}

.cell-null {
  color: var(--kira-fg-disabled);
  font-style: italic;
}

/* P40 D10: same tokens grid/keyvalue's own search highlighting uses. */
.search-match {
  background: var(--kira-search-match);
}

.search-match-current {
  background: var(--kira-search-match-current);
  color: var(--kira-bg);
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
  cursor: default;
}

.doc-row.selected,
.row.selected {
  background: var(--kira-select);
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
