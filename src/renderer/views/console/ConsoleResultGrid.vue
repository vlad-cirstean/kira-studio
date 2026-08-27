<script setup lang="ts">
import type { ColumnDescriptor } from '@shared/protocol/page';
import { computed, ref, watch } from 'vue';
import {
  clearSelectedCellFor,
  publishSelectedCell,
  type SelectedCell,
} from '../../state/cellSelection';
import { appearanceVersion, settingsState } from '../../state/settings';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { cellClass } from '../../theme/cellClass';
import { typeClassColor } from '../../theme/icons';
import VirtualList from '../../theme/primitives/VirtualList.vue';
import DocumentTree from '../shared/document/DocumentTree.vue';
import {
  type DocumentRowView,
  rowHeight as documentRowHeight,
  rowsVersion,
  rowView,
  togglePath,
} from '../shared/document/rows';
import { alignmentFor, initialWidths, resetMeasureCtx } from '../shared/page/columns';
import { setVisibleRows } from '../shared/page/visibleRows';
import { typeDescription } from '../shared/typeGlossary';
import {
  cell,
  documentRow,
  getPage,
  keyValueRow,
  pageVersion,
  setVisibleWindow,
} from './resultPages';
import { type Match, matchedRows, searchState } from './search';
import { isResultDocExpanded, setAllResultDocsExpanded, toggleResultDocExpanded } from './state';

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
// P42 D19/D20: structured the same way DataGrid.vue's own twin changed with it — deliberately the
// same shape minus the comment, so the two can't re-drift the way P40 D16 already closed once.
function headerTitleFor(col: ColumnDescriptor): {
  title: string;
  meta?: string;
  metaColor?: string;
  body?: string;
} {
  const description = col.dataType ? typeDescription(col.dataType) : null;
  return {
    title: col.name,
    meta: col.dataType || undefined,
    // Item (regression pass, task batch P46-7): DataGrid.vue's own twin change, mirrored — reads
    // this column's own typeClass (the adapter's authoritative verdict) rather than re-guessing
    // one from its dataType string.
    metaColor: typeClassColor(col.typeClass),
    body: description ?? undefined,
  };
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

// P42 D39: search state here is keyed by tabId (D9), same as every runSearch below — VirtualList
// reports positions within `rowIndices`/`documentRows`, which are ascending but, while filtering,
// non-contiguous page-row indices (same reasoning as DocumentView.vue's own onVisibleRange).
// P43 F2/D3: the same bounds also prune resultPages.ts's decode cache — keyed by pageKey (a
// decode cache is per result set), not tabId (search priority is per tab, resolved to whichever
// result is active) — reusing this one report instead of resultPages.ts growing its own watch.
function onVisibleRangeIndices(range: { start: number; end: number }): void {
  const list = rowIndices.value;
  const from = list[range.start];
  const to = list[Math.max(range.start, range.end - 1)];
  if (from === undefined || to === undefined) return;
  setVisibleRows(props.tabId, from, to + 1);
  setVisibleWindow(props.pageKey, from, to + 1);
}
function onVisibleRangeDocs(range: { start: number; end: number }): void {
  const list = documentRows.value;
  const from = list[range.start]?.index;
  const to = list[Math.max(range.start, range.end - 1)]?.index;
  if (from === undefined || to === undefined) return;
  setVisibleRows(props.tabId, from, to + 1);
  setVisibleWindow(props.pageKey, from, to + 1);
}

// P42 D11: the same head-row/DocumentTree pair the Mongo data tab renders (rowView/rowHeight —
// views/shared/document/rows.ts, registered onto this result's own key in console/state.ts's
// run()) — collapsed by default, per-result expansion state in the console runtime rather than
// persisted tab state (D11: a console result is runtime-only to begin with).
const documentRows = computed<DocumentRowView[]>(() => {
  void pageVersion.n;
  const out: DocumentRowView[] = [];
  for (const i of rowIndices.value) {
    const view = rowView(props.pageKey, i);
    if (view) out.push(view);
  }
  return out;
});

const documentRowHeights = computed<number[]>(() => {
  void pageVersion.n;
  void rowsVersion.n;
  return documentRows.value.map((view) =>
    documentRowHeight(
      props.pageKey,
      view.index,
      null,
      isResultDocExpanded(props.tabId, props.pageKey, view.id),
    ),
  );
});

function onToggleDocExpanded(id: string): void {
  toggleResultDocExpanded(props.tabId, props.pageKey, id);
}

// Item (regression pass, task batch P46-4): DocumentView.vue's own expand-all/collapse-all pair,
// exposed the same way goToMatch already is (ConsoleView.vue calls through this ref) — its
// toolbar lives one level up since these two buttons only make sense while the active result is
// document-shaped, a fact ConsoleView.vue's own getPage(activeKey) check decides, not this panel.
function expandAll(): void {
  setAllResultDocsExpanded(
    props.tabId,
    props.pageKey,
    documentRows.value.map((v) => v.id),
    true,
  );
}
function collapseAll(): void {
  setAllResultDocsExpanded(props.tabId, props.pageKey, [], false);
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

// P43 iter2 F20/D27: unlike DataGrid.vue's rt.selection, this panel's "selection" is only ever
// the last click, held in the local `selected` ref above — a row index into a page that has been
// replaced (a new result chip swapping `pageKey` on this same mounted instance, F20's own
// finding, or the same result reloading) identifies nothing. Clearing rather than republishing is
// the honest operation: there is no persistent selection concept here to republish against a new
// page in the first place.
watch([() => props.pageKey, () => pageVersion.n], () => {
  selected.value = null;
  clearSelectedCellFor(props.tabId);
});

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
defineExpose({ goToMatch, expandAll, collapseAll });

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

// Item (regression pass, task batch P46-4): a document row no longer publishes into the shared
// cellSelection slot — the expanded DocumentTree right below it (P42 D11) already shows exactly
// this same body, so the cell editor dock used to pop up and show it a second time for no reason
// the real Mongo data tab's own DocumentView.vue doesn't (it has no cell editor at all). `selected`
// still tracks the last-clicked row for its own highlight, the same convention DocumentView.vue's
// rows use independent of any editor.
function selectDocumentRow(row: number): void {
  selected.value = { row, col: 0 };
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
      @visible-range="onVisibleRangeIndices"
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
      :items="documentRows"
      :row-height="26"
      :row-heights="documentRowHeights"
      class="body doc-body"
      @visible-range="onVisibleRangeDocs"
    >
      <template #default="{ item: view }">
        <div
          class="doc-row"
          data-testid="console-result-doc-row"
          :data-row="view.index"
          :data-id="view.id"
          :class="{
            open: isResultDocExpanded(tabId, pageKey, view.id),
            selected: isSelected(view.index, 0),
            'search-match': isSearchMatch(view.index, 0),
            'search-match-current': isCurrentSearchMatch(view.index, 0),
          }"
        >
          <div class="doc-head" @click="selectDocumentRow(view.index)">
            <button
              type="button"
              class="expand-toggle"
              data-testid="document-toggle-expand"
              :aria-label="isResultDocExpanded(tabId, pageKey, view.id) ? 'Collapse' : 'Expand'"
              @click.stop="onToggleDocExpanded(view.id)"
            >
              <CodiconIcon
                :name="isResultDocExpanded(tabId, pageKey, view.id) ? 'chevron-down' : 'chevron-right'"
                :size="13"
              />
            </button>
            <span class="doc-id" data-testid="document-id">{{ view.idLabel }}</span>
            <span class="p-badge" data-testid="document-field-count">{{ view.fieldCount }} fields</span>
            <span class="p-badge" data-testid="document-byte-badge">{{ view.byteLabel }}</span>
            <span
              v-if="view.isTruncated"
              class="p-badge warn"
              v-tooltip="'value truncated'"
              data-testid="document-truncated"
              >truncated</span
            >
          </div>
          <div
            v-if="isResultDocExpanded(tabId, pageKey, view.id)"
            class="doc-body-tree"
            data-testid="document-body"
          >
            <DocumentTree
              v-if="view.root"
              :tab-id="pageKey"
              :row="view.index"
              @toggle-path="(path) => togglePath(pageKey, view.index, path)"
            />
            <pre v-else class="doc-body-text">{{ documentRow(pageKey, view.index)?.body }}</pre>
          </div>
        </div>
      </template>
    </VirtualList>
    <VirtualList
      v-else
      ref="listRef"
      :items="rowIndices"
      :row-height="rowHeight"
      class="body"
      @visible-range="onVisibleRangeIndices"
    >
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
   slot the cell editor panel reads, so the same visual language applies here). P42 D22: left as a
   plain `outline` rather than picking up DataGrid.vue's own shared-edge box-shadow fix — `selected`
   here is a single `{row, col}` ref (:94-98 above), so two cells can never be selected here at
   once and the doubled-border defect (F15) is unreachable; adding edge computation for a
   selection this grid can't build would be dead code wearing the appearance of a guarantee. */
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

/* P42 D11: the same head/DocumentTree pair the Mongo data tab renders (DocumentView.vue), read
   only — no edit/delete affordance, no editing chip. */
.doc-row {
  display: flex;
  flex-direction: column;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  cursor: default;
}

.row.selected {
  background: var(--kira-select);
}

.doc-head {
  height: var(--kira-h-md);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  padding: 0 var(--kira-s-3);
  cursor: pointer;
}

.doc-head:hover {
  background: var(--kira-hover);
}

.doc-row.open > .doc-head {
  background: var(--kira-bg-elevated);
}

/* The row currently published to the cell editor (this panel's own selectDocumentRow) — a left
   rail, never a full-row tint, so it stays legible under .open's own background and a search
   match's highlight at the same time (DocumentView.vue's own rule, mirrored). */
.doc-row.selected > .doc-head {
  box-shadow: inset 2px 0 0 var(--kira-accent);
}

.doc-row.search-match {
  background: var(--kira-search-match);
}

.doc-row.search-match-current {
  background: var(--kira-search-match-current);
}

.expand-toggle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 0;
}

.doc-id {
  flex-shrink: 0;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--kira-font-family);
  font-size: var(--kira-t-md);
  color: var(--kira-fg);
}

.doc-body-tree {
  flex: 1;
  min-height: 0;
  border-top: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-elevated);
  overflow: hidden;
}

.doc-body-text {
  margin: 0;
  padding: var(--kira-s-2) var(--kira-s-4);
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
