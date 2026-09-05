<script setup lang="ts">
import type { ColumnDescriptor } from '@shared/protocol/page';
import { computed, ref, watch } from 'vue';
import {
  clearSelectedCellFor,
  publishSelectedCell,
  type SelectedCell,
} from '../../state/cellSelection';
import { openContextMenu } from '../../state/contextMenu';
import { settingsState } from '../../state/settings';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import VirtualList from '../../theme/primitives/VirtualList.vue';
import DocumentRow from '../shared/document/DocumentRow.vue';
import DocumentTree from '../shared/document/DocumentTree.vue';
import {
  type DocumentRowView,
  rowHeight as documentRowHeight,
  rowsVersion,
  rowView,
  togglePath,
} from '../shared/document/rows';
import { datasetNumber } from '../shared/eventCoords';
import { createMatchIndex } from '../shared/page/search';
import { setVisibleRows } from '../shared/page/visibleRows';
import ConsoleSlickGrid from './ConsoleSlickGrid.vue';
import { rowAsJsonMenu } from './resultMenu';
import { documentRow, getPage, keyValueRow, pageVersion, setVisibleWindow } from './resultPages';
import { type Match, matchedRows, searchState } from './search';
import { isResultDocExpanded, setAllResultDocsExpanded, toggleResultDocExpanded } from './state';

// A three-way switch over a console result's own kind (P8) — tabular results render through
// ConsoleSlickGrid.vue (P30 §3, the same KiraSlickGrid/dataSource.ts/slickTheme.css layer
// views/grid/SlickGridHost.vue uses); document and key-value results stay on VirtualList, since
// their rows are Vue component trees (DocumentRow/DocumentTree) or two flex cells, not formatted
// cells with a column axis to virtualize (P30 §3.4). The page cache itself is `./resultPages.ts`
// (P8), a generic-`Page` sibling of `grid/page.ts` since a console result can be tabular (SQL),
// document (Mongo shell) or key-value (Redis) unlike a data tab.
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

// The find toolbar's go-to-match and the document/key-value branches' own scrollToIndex call
// resolve through whichever of the two <VirtualList> branches below is currently mounted — Vue
// always exposes `$el` on a template ref regardless of defineExpose.
const listRef = ref<{ scrollToIndex: (index: number) => void; $el: HTMLElement } | null>(null);

// P30 §3.6 C2 — ConsoleSlickGrid.vue's own defineExpose contract (§3.5), a separate ref from
// listRef since it isn't a <VirtualList> and exposes no `scrollToIndex`/`$el`.
const tabularGridRef = ref<{ goToMatch: (match: Match) => void } | null>(null);

// P40 D10/D17: the same "hide non-matching rows" toggle grid/documents/keyvalue share (P24 D2) —
// a filtered row keeps its real page-row number in the gutter, same as those views.
const displayRows = computed<number[] | null>(() => matchedRows(props.tabId));
const rowIndices = computed(() => {
  void pageVersion.n;
  if (displayRows.value) return displayRows.value;
  return Array.from({ length: page.value?.rowCount ?? 0 }, (_, i) => i);
});

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
const matchIndex = createMatchIndex(searchState, () => props.tabId);
function isSearchMatch(row: number, col: number): boolean {
  return matchIndex.value?.has(row, col) ?? false;
}
function isCurrentSearchMatch(row: number, col: number): boolean {
  return matchIndex.value?.isCurrent(row, col) ?? false;
}

// The find toolbar's go-to-match (P40 D10) — rowIndices is the *filtered* array when the filter
// toggle is on, so a match's page-row number has to be looked up by position rather than assumed
// to equal it, same as DocumentView.vue's own onGoToMatch.
function goToMatch(match: Match): void {
  // P30 §3.6 C2/C5 — the tabular branch delegates to ConsoleSlickGrid.vue's own contract; it
  // addresses a row by display *position*, not by an index into this file's own `rowIndices`.
  if (page.value?.kind === 'tabular') {
    tabularGridRef.value?.goToMatch(match);
    return;
  }
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

// P2 R2 (task #98): same closure-per-render problem DataGrid.vue found first (P2 R1) — a template
// handler that calls out with the v-for's row/column index can never be cached by Vue's compiler
// (hasScopeRef), so every visible row got a fresh wrapper closure on every render, scroll
// included. This recovers the row index from a data-* attribute on the element the event actually
// fired on instead, so the template can bind a stable, module-scope function. The document-row
// branch below is left as-is: DocumentRow.vue's `toggle`/`select` emits carry no native Event
// (defineEmits<{ toggle: []; select: [] }>()), so there is no currentTarget to read a data-*
// attribute off without also changing that shared component's public contract (which
// DocumentView.vue also depends on, outside this fix's scope).
function selectKeyValueRowFromEvent(e: MouseEvent): void {
  const r = datasetNumber(e.currentTarget, 'row');
  if (r !== null) selectKeyValueRow(r);
}

// P19 D6/D11: the document and key-value branches' own row menu — "Copy as JSON" (this row) and
// "Copy all as JSON" (every row currently displayed, i.e. rowIndices/documentRows — under an
// active find-filter that's the filtered subset, same rule columnsToTsv's own callers already
// follow). A copy failure lands here (component-local, P13 D9's strip precedent) since the
// console has no actionError field the way documents/menu.ts's copyOrReportError writes into.
const copyError = ref<string | null>(null);
function onCopyError(message: string): void {
  copyError.value = message;
}

function onDocumentRowContextMenu(e: MouseEvent, index: number): void {
  e.preventDefault();
  const body = documentRow(props.pageKey, index)?.body ?? '';
  const allJson = documentRows.value.map((v) => documentRow(props.pageKey, v.index)?.body ?? '');
  openContextMenu(e, rowAsJsonMenu({ json: body, allJson, onError: onCopyError }));
}

function onKeyValueRowContextMenu(e: MouseEvent, row: number): void {
  e.preventDefault();
  const kv = kvRowAt(row);
  const json = JSON.stringify({ [kv.field]: kv.value }, null, 2);
  const allJson = rowIndices.value.map((r) => {
    const entry = kvRowAt(r);
    return JSON.stringify({ [entry.field]: entry.value }, null, 2);
  });
  openContextMenu(e, rowAsJsonMenu({ json, allJson, onError: onCopyError }));
}

function onKeyValueRowContextMenuFromEvent(e: MouseEvent): void {
  const r = datasetNumber(e.currentTarget, 'row');
  if (r !== null) onKeyValueRowContextMenu(e, r);
}
</script>

<template>
  <div class="console-result-grid" data-testid="console-result-grid">
    <MessageStrip v-if="copyError" tone="err" data-testid="console-copy-error">
      {{ copyError }}
    </MessageStrip>
    <div v-if="!page || page.rowCount === 0" class="no-rows">{{ page ? 'No rows' : '' }}</div>
    <!-- P31 D19/P24 D8 precedent: filtering to zero matches is a distinct empty state from "no
         data loaded" — same discipline as KeyValueView.vue's own EmptyState pair. -->
    <div v-else-if="rowIndices.length === 0" class="no-rows" data-testid="console-no-matching-rows">
      No matching rows
    </div>
    <ConsoleSlickGrid
      v-else-if="page.kind === 'tabular'"
      :key="pageKey"
      ref="tabularGridRef"
      :page-key="pageKey"
      :tab-id="tabId"
      :connection-id="connectionId"
      :path="path"
      class="body"
    />
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
        <DocumentRow
          data-testid="console-result-doc-row"
          :data-row="view.index"
          :view="view"
          :scope="pageKey"
          :expanded="isResultDocExpanded(tabId, pageKey, view.id)"
          :selected="isSelected(view.index, 0)"
          :search-match="isSearchMatch(view.index, 0)"
          :search-match-current="isCurrentSearchMatch(view.index, 0)"
          @toggle="onToggleDocExpanded(view.id)"
          @select="selectDocumentRow(view.index)"
          @contextmenu="onDocumentRowContextMenu($event, view.index)"
        >
          <template #body>
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
          </template>
        </DocumentRow>
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
          @click="selectKeyValueRowFromEvent"
          @contextmenu="onKeyValueRowContextMenuFromEvent"
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
  /* P19 D6: the copy-error strip is an always-possible sibling above whichever one of
     no-rows/ConsoleSlickGrid/VirtualList is the actual body — a plain block stack would let that
     sibling's height double-count against the 100% above, so this becomes a column and the body
     takes what's left. */
  display: flex;
  flex-direction: column;
}

.body {
  flex: 1;
  min-height: 0;
}

.row {
  display: flex;
  width: var(--total-width);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.cell {
  overflow: hidden;
  white-space: nowrap;
  cursor: default;
}

/* No zebra striping (DataGrid.vue's own rule/comment: "the design's own _gridrows.html/
   _style.css draws no alternating row colour, only the hover state") — P40 D17 parity. P30 §3.6
   C6: the tabular branch's own equivalent (and its `.header-row`/`.gutter-cell` exclusions) left
   with it — this is the key-value row's own hover feedback only now (`.cell:not(.selected)` is a
   no-op guard here: a kv cell is never itself `.selected`, only its row is — `.row.selected`,
   below). */
.row:hover .cell:not(.selected) {
  background: var(--kira-hover);
}

/* P40 D10: same tokens grid/keyvalue's own search highlighting uses. */
.search-match {
  background: var(--kira-search-match);
}

.search-match-current {
  background: var(--kira-search-match-current);
  color: var(--kira-bg);
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

/* P48 F10-F12: the row shell and its head now live in views/shared/document/DocumentRow.vue —
   this panel only styles its own #body slot content, read only (no edit/delete affordance, no
   editing chip). `:deep()` since `.doc-row` is that component's own root, outside this panel's
   scope-id — the one place this copy genuinely differed from the document view's (F11): no
   pointer cursor over the row outside its head. */
:deep(.doc-row) {
  cursor: default;
}

.row.selected {
  background: var(--kira-select);
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
