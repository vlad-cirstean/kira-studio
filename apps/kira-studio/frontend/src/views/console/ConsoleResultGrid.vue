<script setup lang="ts">
import type { ColumnDescriptor } from '@shared/protocol/page';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { useContextMenuStore } from '@workbench/state/contextMenu';
import { useVirtualRows } from '@workbench/util/virtualRows';
import { computed, ref, watch } from 'vue';
import { type SelectedCell, useCellSelectionStore } from '../../state/cellSelection';
import { useSettingsStore } from '../../state/settings';
import DocumentRow from '../shared/document/DocumentRow.vue';
import DocumentTree from '../shared/document/DocumentTree.vue';
import { type DocumentRowView, useDocumentRowsStore } from '../shared/document/rows';
import { datasetNumber } from '../shared/eventCoords';
import { createMatchIndex } from '../shared/page/search';
import { setVisibleRows } from '../shared/page/visibleRows';
import ConsoleSlickGrid from './ConsoleSlickGrid.vue';
import { mongoDocumentRowMenu, rowAsJsonMenu } from './resultMenu';
import { documentRow, getPage, keyValueRow, pageVersion, setVisibleWindow } from './resultPages';
import { type Match, matchedRows, searchState } from './search';
import { useConsoleViewStore } from './state';

const cellSelectionStore = useCellSelectionStore();
const contextMenuStore = useContextMenuStore();
const documentRowsStore = useDocumentRowsStore();
const settingsStore = useSettingsStore();
const consoleViewStore = useConsoleViewStore();

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

const rowHeight = computed(() => (settingsStore.appearance.rowDensity === 'compact' ? 22 : 28));

const page = computed(() => {
  // Establishes the reactive dependency — the page object itself is frozen and non-reactive.
  void pageVersion.n;
  return getPage(props.pageKey);
});

// P30 §3.6 C2 — ConsoleSlickGrid.vue's own defineExpose contract (§3.5), a separate ref from
// the document/key-value virtualizers below since it isn't virtualized and exposes no
// `scrollToIndex`.
const tabularGridRef = ref<{ goToMatch: (match: Match) => void } | null>(null);

// P40 D10/D17: the same "hide non-matching rows" toggle grid/documents/keyvalue share (P24 D2) —
// a filtered row keeps its real page-row number in the gutter, same as those views.
const displayRows = computed<number[] | null>(() => matchedRows(props.tabId));
const rowIndices = computed(() => {
  void pageVersion.n;
  if (displayRows.value) return displayRows.value;
  return Array.from({ length: page.value?.rowCount ?? 0 }, (_, i) => i);
});

// P42 D11: the same head-row/DocumentTree pair the Mongo data tab renders (rowView/rowHeight —
// views/shared/document/rows.ts, registered onto this result's own key in console/state.ts's
// run()) — collapsed by default, per-result expansion state in the console runtime rather than
// persisted tab state (D11: a console result is runtime-only to begin with).
const documentRows = computed<DocumentRowView[]>(() => {
  void pageVersion.n;
  const out: DocumentRowView[] = [];
  for (const i of rowIndices.value) {
    const view = documentRowsStore.rowView(props.pageKey, i);
    if (view) out.push(view);
  }
  return out;
});

const documentRowHeights = computed<number[]>(() => {
  void pageVersion.n;
  void documentRowsStore.rowsVersion.n;
  return documentRows.value.map((view) =>
    documentRowsStore.rowHeight(
      props.pageKey,
      view.index,
      null,
      consoleViewStore.isResultDocExpanded(props.tabId, props.pageKey, view.id),
    ),
  );
});

function onToggleDocExpanded(id: string): void {
  consoleViewStore.toggleResultDocExpanded(props.tabId, props.pageKey, id);
}

// P104 §3.4: VirtualList's own recipe, rebuilt on @tanstack/vue-virtual via the shared
// useVirtualRows composable — one instance per branch (document/key-value), since only one of
// the two is ever mounted at a time (the template's v-else-if/v-else) but each needs its own
// scroll element, count and row-height source.
const docScrollEl = ref<HTMLElement | null>(null);
const docVirtual = useVirtualRows({
  count: () => documentRows.value.length,
  rowHeight: () => 26,
  rowHeights: () => documentRowHeights.value,
  scrollElement: docScrollEl,
});

const kvScrollEl = ref<HTMLElement | null>(null);
const kvVirtual = useVirtualRows({
  count: () => rowIndices.value.length,
  rowHeight: () => rowHeight.value,
  scrollElement: kvScrollEl,
});

// P42 D39: search state here is keyed by tabId (D9), same as every watcher below — the
// virtualizers report positions within `rowIndices`/`documentRows`, which are ascending but,
// while filtering, non-contiguous page-row indices (same reasoning as DocumentView.vue's own
// onVisibleRange). P43 F2/D3: the same bounds also prune resultPages.ts's decode cache — keyed by
// pageKey (a decode cache is per result set), not tabId (search priority is per tab, resolved to
// whichever result is active) — reusing this one report instead of resultPages.ts growing its own
// watch.
watch(kvVirtual.virtualItems, (items) => {
  if (items.length === 0) return;
  const list = rowIndices.value;
  const from = list[items[0].index];
  const to = list[items[items.length - 1].index];
  if (from === undefined || to === undefined) return;
  setVisibleRows(props.tabId, from, to + 1);
  setVisibleWindow(props.pageKey, from, to + 1);
});

watch(docVirtual.virtualItems, (items) => {
  if (items.length === 0) return;
  const list = documentRows.value;
  const from = list[items[0].index]?.index;
  const to = list[items[items.length - 1].index]?.index;
  if (from === undefined || to === undefined) return;
  setVisibleRows(props.tabId, from, to + 1);
  setVisibleWindow(props.pageKey, from, to + 1);
  // A4/P21 round 1: rows.ts's own parseCache is pruned to the rendered window everywhere else
  // (DocumentView.vue's own onVisibleRange) but had no call site here at all — a Mongo console
  // result's parsed node trees stayed resident for the life of the result instead of the rendered
  // window docs/ARCHITECTURE.md's Caching section already documents for this tier.
  documentRowsStore.pruneRows(props.pageKey, from, to + 1);
});

// Item (regression pass, task batch P46-4): DocumentView.vue's own expand-all/collapse-all pair,
// exposed the same way goToMatch already is (ConsoleView.vue calls through this ref) — its
// toolbar lives one level up since these two buttons only make sense while the active result is
// document-shaped, a fact ConsoleView.vue's own getPage(activeKey) check decides, not this panel.
function expandAll(): void {
  consoleViewStore.setAllResultDocsExpanded(
    props.tabId,
    props.pageKey,
    documentRows.value.map((v) => v.id),
    true,
  );
}
function collapseAll(): void {
  consoleViewStore.setAllResultDocsExpanded(props.tabId, props.pageKey, [], false);
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
  cellSelectionStore.clearSelectedCellFor(props.tabId);
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
  if (index < 0) return;
  if (page.value?.kind === 'document') docVirtual.scrollToIndex(index);
  else kvVirtual.scrollToIndex(index);
}
defineExpose({ goToMatch, expandAll, collapseAll });

function publish(selectedCell: Omit<SelectedCell, 'tabId' | 'connectionId' | 'path'>): void {
  cellSelectionStore.publishSelectedCell({
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

// P105 §5.2(c): Enter/Space both mirror a single click — this row has one action, selection.
function selectKeyValueRowFromKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  const r = datasetNumber(e.currentTarget, 'row');
  if (r !== null) selectKeyValueRow(r);
}

// P19 D6/D11, P22b D11: the document and key-value branches' own row menu — the document branch
// gets P22b D11's Shell/Canonical/Relaxed submenu pair (mongoDocumentRowMenu); key-value has no
// shell/EJSON format of its own and keeps the plain "Copy as JSON"/"Copy all as JSON" pair
// (rowAsJsonMenu). Both cover every row currently displayed (i.e. rowIndices/documentRows — under
// an active find-filter that's the filtered subset, same rule columnsToTsv's own callers already
// follow). A copy failure lands here (component-local, P13 D9's strip precedent) since the
// console has no actionError field the way documents/menu.ts's copyOrReportError writes into.
const copyError = ref<string | null>(null);
function onCopyError(message: string): void {
  copyError.value = message;
}

// P21 round 2 performance finding 2: allJson used to be a materialized array, built eagerly at
// right-click time -- a whole-page decode (plus, for the key-value branch, a full
// JSON.stringify(..., null, 2) per row) on a click that should cost ~0 ms, and one that re-
// populates the decode/view caches for every row, undoing the visible-window pruning until the
// next scroll. Both are thunks now, invoked only inside "Copy all as JSON"'s own run().
function onDocumentRowContextMenu(e: MouseEvent, index: number): void {
  e.preventDefault();
  const body = documentRow(props.pageKey, index)?.body ?? '';
  const allBodies = () =>
    documentRows.value.map((v) => documentRow(props.pageKey, v.index)?.body ?? '');
  contextMenuStore.openContextMenu(e, mongoDocumentRowMenu({ body, allBodies, onError: onCopyError }));
}

function onKeyValueRowContextMenu(e: MouseEvent, row: number): void {
  e.preventDefault();
  const kv = kvRowAt(row);
  const json = JSON.stringify({ [kv.field]: kv.value }, null, 2);
  const allJson = () =>
    rowIndices.value.map((r) => {
      const entry = kvRowAt(r);
      return JSON.stringify({ [entry.field]: entry.value }, null, 2);
    });
  contextMenuStore.openContextMenu(e, rowAsJsonMenu({ json, allJson, onError: onCopyError }));
}

function onKeyValueRowContextMenuFromEvent(e: MouseEvent): void {
  const r = datasetNumber(e.currentTarget, 'row');
  if (r !== null) onKeyValueRowContextMenu(e, r);
}
</script>

<template>
  <div class="h-full min-h-0 flex flex-col text-kira-md font-data" data-testid="console-result-grid">
    <Alert v-if="copyError" variant="destructive" data-testid="console-copy-error">
      <AlertDescription>{{ copyError }}</AlertDescription>
    </Alert>
    <div v-if="!page || page.rowCount === 0" class="no-rows h-full flex items-center justify-center text-muted-foreground text-kira-sm">{{ page ? 'No rows' : '' }}</div>
    <!-- P31 D19/P24 D8 precedent: filtering to zero matches is a distinct empty state from "no
         data loaded" — same discipline as KeyValueView.vue's own EmptyState pair. -->
    <div v-else-if="rowIndices.length === 0" class="no-rows h-full flex items-center justify-center text-muted-foreground text-kira-sm" data-testid="console-no-matching-rows">
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
      class="flex-1 min-h-0"
    />
    <div
      v-else-if="page.kind === 'document'"
      ref="docScrollEl"
      class="flex-1 min-h-0 p-1 overflow-auto"
      data-testid="virtual-list"
      role="listbox"
      aria-label="Documents"
      @scroll="docVirtual.onScroll"
    >
      <div :style="{ height: `${docVirtual.totalSize.value}px`, position: 'relative' }">
        <DocumentRow
          v-for="vi in docVirtual.virtualItems.value"
          :key="String(vi.key)"
          class="virtual-row"
          data-testid="console-result-doc-row"
          :data-row="documentRows[vi.index]?.index"
          :view="documentRows[vi.index]!"
          :row-scope="pageKey"
          :expanded="consoleViewStore.isResultDocExpanded(tabId, pageKey, documentRows[vi.index]!.id)"
          :selected="isSelected(documentRows[vi.index]!.index, 0)"
          :search-match="isSearchMatch(documentRows[vi.index]!.index, 0)"
          :search-match-current="isCurrentSearchMatch(documentRows[vi.index]!.index, 0)"
          :style="{ transform: `translateY(${vi.start}px)` }"
          @toggle="onToggleDocExpanded(documentRows[vi.index]!.id)"
          @select="selectDocumentRow(documentRows[vi.index]!.index)"
          @contextmenu="onDocumentRowContextMenu($event, documentRows[vi.index]!.index)"
        >
          <template #body>
            <div
              v-if="consoleViewStore.isResultDocExpanded(tabId, pageKey, documentRows[vi.index]!.id)"
              class="flex-1 min-h-0 border-t border-border bg-elevated overflow-hidden"
              data-testid="document-body"
            >
              <DocumentTree
                v-if="documentRows[vi.index]!.root"
                :tab-id="pageKey"
                :row="documentRows[vi.index]!.index"
                @toggle-path="(path) => documentRowsStore.togglePath(pageKey, documentRows[vi.index]!.index, path)"
              />
              <pre v-else class="m-0 whitespace-pre-wrap break-words font-data py-1 px-2">{{ documentRow(pageKey, documentRows[vi.index]!.index)?.body }}</pre>
            </div>
          </template>
        </DocumentRow>
      </div>
    </div>
    <div
      v-else
      ref="kvScrollEl"
      class="flex-1 min-h-0 overflow-auto"
      data-testid="virtual-list"
      role="listbox"
      aria-label="Result rows"
      @scroll="kvVirtual.onScroll"
    >
      <div :style="{ height: `${kvVirtual.totalSize.value}px`, position: 'relative' }">
        <div
          v-for="vi in kvVirtual.virtualItems.value"
          :key="String(vi.key)"
          class="row virtual-row flex border-b border-border w-[var(--total-width)]"
          data-testid="console-result-kv-row"
          :data-row="rowIndices[vi.index]"
          :class="{ selected: isSelected(rowIndices[vi.index]!, 0) }"
          :style="{ height: `${vi.size}px`, transform: `translateY(${vi.start}px)` }"
          role="option"
          tabindex="0"
          :aria-selected="isSelected(rowIndices[vi.index]!, 0)"
          @click="selectKeyValueRowFromEvent"
          @keydown="selectKeyValueRowFromKeydown"
          @contextmenu="onKeyValueRowContextMenuFromEvent"
        >
          <div
            class="cell overflow-hidden whitespace-nowrap cursor-default w-52 flex items-center text-muted-foreground text-ellipsis px-2"
            :class="{
              'search-match bg-search-match': isSearchMatch(rowIndices[vi.index]!, 0),
              'search-match-current bg-search-match-current text-bg': isCurrentSearchMatch(
                rowIndices[vi.index]!,
                0,
              ),
            }"
          >
            {{ kvRowAt(rowIndices[vi.index]!).field }}
          </div>
          <div
            class="cell overflow-hidden whitespace-nowrap cursor-default flex-1 flex items-center whitespace-pre-wrap break-words px-2"
            :class="{
              'search-match bg-search-match': isSearchMatch(rowIndices[vi.index]!, 1),
              'search-match-current bg-search-match-current text-bg': isCurrentSearchMatch(
                rowIndices[vi.index]!,
                1,
              ),
            }"
          >
            {{ kvRowAt(rowIndices[vi.index]!).value }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

/* P110 B40: every plain base rule this file had (`.console-result-grid`, `.body`, `.no-rows`,
   `.doc-body`/`-tree`/`-text`, `.kv-field`, `.kv-value`, and `.row`/`.cell`'s own base
   declarations) moved onto the template as Tailwind utilities (scoped CSS is unlayered, so it
   always wins over a layered utility on the same element regardless of class order, per this
   plan's own §1 rule). What's left needs its relative rule to interact with a sibling class or
   Monaco/child-component DOM this template has no element for:
   - `.row:hover .cell:not(.selected)`: real `:hover` plus a descendant-selector guard.
   - `.row.selected`: a state class overriding the same background property.
   - `:deep(.doc-row)`: DocumentRow.vue's own root class, outside this component's scope-id.
   `.row`/`.cell` stay as bare marker classes to anchor the two rules above; `.no-rows` stays as a
   bare marker too — a real test dependency (interaction.spec.ts, sqs/kafka frontend specs all
   locate results by `.no-rows`). */
.row:hover .cell:not(.selected) {
  @apply bg-hover;
}

/* P40 D10: same tokens grid/keyvalue's own search highlighting uses.
   P110 B34: `.search-match`/`.search-match-current` above carry no rule of their own any more --
   bare marker classes, the tint/text-colour is `bg-search-match[-current] text-bg` alongside on
   the same element (--color-search-match[-current] already @theme-registered, base.css). */

/* P48 F10-F12: the row shell and its head now live in views/shared/document/DocumentRow.vue —
   this panel only styles its own #body slot content, read only (no edit/delete affordance, no
   editing chip). `:deep()` since `.doc-row` is that component's own root, outside this panel's
   scope-id — the one place this copy genuinely differed from the document view's (F11): no
   pointer cursor over the row outside its head. */
:deep(.doc-row) {
  @apply cursor-default;
}

.row.selected {
  @apply bg-select;
}
</style>
