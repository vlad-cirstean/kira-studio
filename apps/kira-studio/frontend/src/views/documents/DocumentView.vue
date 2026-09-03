<script setup lang="ts">
import type { SortSpec } from '@shared/domain/queries';
import type { DocumentTabRecord, PageSize } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { control } from '../../bridge/control';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { registerCommand } from '../../shortcuts/commands';
import { confirmDialog } from '../../state/confirmDialog';
import { connectionRecord, connectionsState } from '../../state/connections';
import { openContextMenu } from '../../state/contextMenu';
import { connColorVar } from '../../theme/connColor';
import AppButton from '../../theme/primitives/AppButton.vue';
import AutocompleteField from '../../theme/primitives/AutocompleteField.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import ViewChrome from '../../theme/primitives/ViewChrome.vue';
import VirtualList from '../../theme/primitives/VirtualList.vue';
import DocumentRow from '../shared/document/DocumentRow.vue';
import DocumentTree from '../shared/document/DocumentTree.vue';
import { beautifyShellText, toShellText } from '../shared/document/ejson';
import {
  type DocumentRowView,
  pruneRows,
  registerDocumentRows,
  rowHeight,
  rowsVersion,
  rowView,
  togglePath,
  unregisterDocumentRows,
} from '../shared/document/rows';
import EditBufferActions from '../shared/EditBufferActions.vue';
import FilterHistoryMenu from '../shared/FilterHistoryMenu.vue';
import PagerControls from '../shared/page/PagerControls.vue';
import SearchToolbar from '../shared/page/SearchToolbar.vue';
import { setSearchFiltering } from '../shared/page/searchFilter';
import { pageSizeOptions } from '../shared/page/sizes';
import { setVisibleRows } from '../shared/page/visibleRows';
import { ancestorPathPrefix } from '../shared/targetPath';
import { refreshOrReconnect, useConnectionGate } from '../shared/useConnectionGate';
import { useEditBuffer } from '../shared/useEditBuffer';
import { mongoFilterCandidates, mongoSortCandidates } from './filterCompletion';
import { rowMenu } from './menu';
import { deleteDocument, saveDocumentEdit, saveNewDocument } from './mutations';
import ProjectionMenu from './ProjectionMenu.vue';
import { documentRow, fieldNamesOnPage, pageVersion, setVisibleWindow } from './page';
import {
  searchState as docSearchState,
  type Match,
  matchedRows,
  pageSearchApi,
  previewLineFor,
} from './search';
import { parseSortText, sortSpecToText } from './sortDocument';
import {
  goFirst,
  goLast,
  goNext,
  goPrev,
  goToPage,
  isDocumentExpanded,
  load,
  reload,
  runCount,
  runtime,
  selectRow,
  setActionError,
  setAllExpanded,
  setPageSize,
  setSearch,
  setSearchOpen,
  setSort,
  stop,
  toggleExpanded,
  toggleSearchOpen,
} from './state';

// MainView.vue keys this component by tab.id — same discipline as DefinitionView.vue/ConsoleView.vue.
const props = defineProps<{ tab: DocumentTabRecord }>();

// Item (regression pass, task batch P46-5): registered here, at setup's own top level, rather
// than inside onMounted below (P42 D9's original placement) — Vue's first render already reads
// `rows` (and so, transitively, this source) before onMounted ever fires, so registering it there
// raced every remount: switching back to an already-loaded tab skipped load() (data was already
// there), so nothing ever forced `rows` to recompute after the late registration landed, leaving
// its first, empty-sourced result cached for good. A restored tab returning empty on reopen was
// the reported symptom (never a fresh load — this only shows up once a tab is loaded and remounts
// without reloading, so the fresh-open path this comment used to describe never hit it).
registerDocumentRows(props.tab.id, (row) => documentRow(props.tab.id, row));

const { connectionStatus, needsReconnect, onReconnectAndLoad } = useConnectionGate(
  () => props.tab,
  () => load(props.tab.id),
);

const rt = computed(() => runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'loading');

// DataToolbar.vue's own gate, narrowed to the one flag this view's Add-document button reads
// (§0 note: "A renderer gating a single action ... reads the matching flag instead of `writable`").
const caps = computed(() => {
  const connectionId = props.tab.connectionId;
  return connectionId ? (connectionsState.states[connectionId]?.caps ?? null) : null;
});

const targetTail = computed(() => pathTail(props.tab.path));

// Task: mutate.ts's update op is a whole-document replaceOne({_id}, body) — when a projection is
// active the fetched (and therefore edited) body holds only the projected fields, so committing
// it would silently drop every field the projection hid. Editing is refused outright rather than
// attempting a partial merge, since "which fields the user meant to keep" isn't recoverable from
// a projected body alone; the fix is clearing the projection first.
const editGate = computed<{ editable: boolean; label: string }>(() => {
  if (!caps.value?.canUpdate) {
    return { editable: false, label: 'Connection does not support update' };
  }
  if (props.tab.state.projection !== null) {
    return {
      editable: false,
      label:
        'Clear the field projection before editing — a projected document would replace the full one',
    };
  }
  return { editable: true, label: 'Edit' };
});

// P16 design system LAW: the connection colour reaches a view as a 2px rail (here: the
// toolbar cap and the view-head dot) — never a tint or a full border on the panel itself.
// No colour assigned leaves the rail slot unpainted rather than unrendered, so nothing shifts
// when a colour is set later. Mirrors Toolbar.vue's `color`/`railStyle` computed pair.
const connectionColor = computed(() => connectionRecord(props.tab.connectionId)?.color);

const iconColor = computed(() => connColorVar(connectionColor.value) ?? 'var(--kira-fg-muted)');

// The view-head's breadcrumb prefix ("connection / database / "): derived from the already
// loaded connection record and the tab's own path, purely for display — no new state.
const pathPrefix = computed(() => ancestorPathPrefix(props.tab.connectionId, props.tab.path));

const searchText = ref(props.tab.state.search);

function onSearchInput(): void {
  setSearch(props.tab.id, searchText.value);
  recordFilterHistory(searchText.value, props.tab.state.sort);
}

// P18 D9/D13: candidate lists computed here (not inside filterCompletion.ts, which is plain and
// Vue-unaware) so `void pageVersion.n` — fieldNamesOnPage's own non-reactive-Map dependency,
// same line projectionCountLabel below already carries — is what drives the recompute. Without
// it the candidate list would freeze at whatever the first loaded page happened to contain.
const filterCandidates = computed(() => {
  void pageVersion.n;
  return mongoFilterCandidates(props.tab.id);
});
const sortCandidates = computed(() => {
  void pageVersion.n;
  return mongoSortCandidates(props.tab.id);
});

const sortText = ref(sortSpecToText(props.tab.state.sort));

function onSortInput(): void {
  const sort = parseSortText(sortText.value);
  setSort(props.tab.id, sort);
  recordFilterHistory(props.tab.state.search, sort);
}

// Mirrors FilterToolbar.vue's own history recording/Clear/apply — same generic {connectionId,
// path} keyed storage (queriesHistoryRecord/queriesSave), just filed under Document's own
// filter/sort vocabulary (a Mongo filter document + sort document, not a WHERE/ORDER BY pair).
function recordFilterHistory(search: string, sort: SortSpec | null): void {
  const connectionId = props.tab.connectionId;
  if (!connectionId) return;
  void control.queriesHistoryRecord(
    connectionId,
    props.tab.path,
    search === '' ? null : search,
    sort,
  );
}

function onClearFilter(): void {
  searchText.value = '';
  sortText.value = '';
  setSearch(props.tab.id, '');
  setSort(props.tab.id, null);
  recordFilterHistory('', null);
}

const filterHistoryOpen = ref(false);

function applyFromFilterHistory(where: string | null, orderBy: SortSpec | null): void {
  searchText.value = where ?? '';
  sortText.value = sortSpecToText(orderBy);
  setSearch(props.tab.id, where ?? '');
  setSort(props.tab.id, orderBy);
}

// P24 D30: <SegmentedControl>, mirroring views/grid/DataToolbar.vue's own swap.
const PAGE_SIZE_OPTIONS = pageSizeOptions('document-');

function onPageSize(size: PageSize): void {
  setPageSize(props.tab.id, size);
}

function onJump(pageIndex: number): void {
  void goToPage(props.tab.id, pageIndex);
}

const projectionOpen = ref(false);

// P16 design system's p-badge on the Columns button (DataToolbar.vue's own `columnCountLabel`
// precedent) — narrowed to "fields seen so far" since a document collection has no fixed total.
const projectionCountLabel = computed(() => {
  void pageVersion.n;
  const total = fieldNamesOnPage(props.tab.id).length;
  if (total === 0) return null;
  const projection = props.tab.state.projection;
  return `${projection ? projection.length : total} / ${total}`;
});

const creatingNew = ref(false);
const NEW_DOCUMENT_TEMPLATE = '{\n  \n}';
// P27 D28/D29: the new-document panel adopts the same edit-buffer row the document editor uses —
// "revert" here means back to the empty template, not to a stored value that doesn't exist yet.
const newBuffer = useEditBuffer({
  original: () => NEW_DOCUMENT_TEMPLATE,
  beautifier: () => beautifyShellText,
});

function onAddDocument(): void {
  creatingNew.value = true;
  newBuffer.reseed();
}

function cancelCreate(): void {
  creatingNew.value = false;
}

async function commitCreate(): Promise<void> {
  try {
    await saveNewDocument(props.tab.id, newBuffer.doc.value);
    setActionError(props.tab.id, null);
    creatingNew.value = false;
    newBuffer.reseed();
  } catch (err) {
    setActionError(props.tab.id, err instanceof Error ? err.message : String(err));
  }
}

function onToggleSearch(): void {
  toggleSearchOpen(props.tab.id);
}

function onCloseSearch(): void {
  setSearchOpen(props.tab.id, false);
}

const virtualListRef = ref<{ scrollToIndex: (index: number) => void } | null>(null);

const editingId = ref<string | null>(null);
// P5 C2: tracked alongside `editingId` by row index, not just by id — rows.ts's own `rowHeight`
// compares against this directly (below), so the height pass never has to decode a row's id
// purely to ask "is this the one being edited".
const editingRow = ref<number | null>(null);
// The row currently being edited seeds from toShellText(body) — the shell-literal spelling, not
// the raw canonical-EJSON wire text — so editing reads the same ObjectId(…)/ISODate(…) form the
// collapsed row and the tree already show (D14/D29).
const editOriginal = ref('');
const editBuffer = useEditBuffer({
  original: () => editOriginal.value,
  beautifier: () => beautifyShellText,
});

// P5 C2/F4: the list's v-for now iterates plain page-row indices, not per-row view objects — a
// document row is resolved (id/body decoded, body parsed into a DocNode tree) through `rowAt`
// below, only for the row actually being rendered, mirroring KeyValueView.vue's/StreamView.vue's
// own `rowIndices`/`rowAt` pattern (which never had this problem, §2 F4). Previously `rows` called
// `documentRow`/`rowView` for *every* row on the page on every load — +15.56 MB of permanently
// cached parse trees for a 5 000-document page, none of it visible.
interface DocumentRowEntry {
  view: DocumentRowView;
  body: string;
}

// P31 D17/D18: the same "hide non-matching rows" toggle grid/keyvalue/stream share (P24 D2).
const displayRows = computed<number[] | null>(() => matchedRows(props.tab.id));

const rows = computed<number[]>(() => {
  void pageVersion.n;
  return displayRows.value ?? Array.from({ length: rt.value?.rowCount ?? 0 }, (_, i) => i);
});

/** Resolves one page row for rendering — id/body decode plus the body's own parsed tree, both
 *  memoized by page.ts/rows.ts's own caches (C3 prunes them to the visible window), so repeat
 *  calls for the same row within one render are cheap Map lookups, not a re-decode/re-parse. */
function rowAt(row: number): DocumentRowEntry | null {
  const doc = documentRow(props.tab.id, row);
  const view = rowView(props.tab.id, row);
  if (!doc || !view) return null;
  return { view, body: doc.body };
}

/** Expand all/Collapse all and the row context menu's own "every id on this page" (menu.ts's
 *  `allIds`) need every row's `_id` — a decode, not `rowAt`'s own parse — over whichever index
 *  list is current (the full page, or the filtered subset while a find's filter toggle is on,
 *  matching `rows`' own scope exactly). */
function idsOf(indices: readonly number[]): string[] {
  const out: string[] = [];
  for (const i of indices) {
    const doc = documentRow(props.tab.id, i);
    if (doc) out.push(doc.id);
  }
  return out;
}

// P42 D39: VirtualList reports positions *within* `rows` (§ above) — while filtering, that array
// is a non-contiguous subset of page-row indices, so the reported bounds are the page rows
// themselves now that `rows` holds plain row numbers (no `.view.index` indirection left to
// resolve). `rows` is itself always ascending (matchedRows' own ascending-de-duplicated
// contract), so the first and last entries of the slice are its min/max.
//
// P5 C3/F5: the same bounds also prune the decode cache (page.ts's own `setVisibleWindow`, mirrors
// grid/console) and rows.ts's `parseCache` (`pruneRows`) — both already widened by VirtualList's
// own overscan (VirtualList.vue's `visible-range` emit includes it), so a fling never prunes a row
// about to be re-rendered.
function onVisibleRange(range: { start: number; end: number }): void {
  const list = rows.value;
  const from = list[range.start];
  const to = list[Math.max(range.start, range.end - 1)];
  if (from === undefined || to === undefined) return;
  setVisibleRows(props.tab.id, from, to + 1);
  setVisibleWindow(props.tab.id, from, to + 1);
  pruneRows(props.tab.id, from, to + 1);
}

// P31 D20: real match highlighting — .search-match/.search-match-current on the row, and the
// matched substring wrapped in <mark> inside a preview line built with search.ts's own
// previewLineFor, so the highlighted offsets can never disagree with what the scanner matched
// against. Keyed by row (search.ts's Match has no column, unlike the grid/keyvalue's).
const docMatchIndex = computed(() => {
  const entry = docSearchState[props.tab.id];
  if (!entry) return null;
  const byRow = new Map<number, Array<{ start: number; end: number }>>();
  for (const m of entry.matches) {
    const list = byRow.get(m.row);
    if (list) list.push(m);
    else byRow.set(m.row, [m]);
  }
  return { byRow, current: entry.index >= 0 ? entry.matches[entry.index] : undefined };
});
function isSearchMatch(row: number): boolean {
  return docMatchIndex.value?.byRow.has(row) ?? false;
}
function isCurrentSearchMatch(row: number): boolean {
  return docMatchIndex.value?.current?.row === row;
}

interface PreviewSegment {
  text: string;
  matched: boolean;
}

// Splits the same string the scanner matched against into matched/unmatched runs, in order —
// documents/search.ts's Match.start/end are offsets into exactly this string (previewLineFor(body)), so
// there is no separate "what did it match" computation to keep in sync.
function previewSegments(row: number, body: string): PreviewSegment[] {
  const matches = docMatchIndex.value?.byRow.get(row);
  const line = previewLineFor(body);
  if (!matches || matches.length === 0) return [{ text: line, matched: false }];
  const segments: PreviewSegment[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) segments.push({ text: line.slice(cursor, m.start), matched: false });
    segments.push({ text: line.slice(m.start, m.end), matched: true });
    cursor = m.end;
  }
  if (cursor < line.length) segments.push({ text: line.slice(cursor), matched: false });
  return segments;
}

// One height per row, in `rows`' own order — VirtualList's `rowHeights` prop (P27 D18/D20).
// Depends on `rowsVersion` too: a nested-path toggle inside DocumentTree.vue changes a row's
// visible line count without changing `rows` itself (id/fieldCount/byteLabel/root are unaffected).
//
// P5 C2/F4: `documentRow` here is a decode only (id, to resolve the persisted-by-id expansion
// flag) — `rowHeight` (rows.ts) itself no longer decodes or parses anything for a collapsed,
// unedited, non-preview row, which is the common case for every row outside the rendered window.
const rowHeights = computed<number[]>(() => {
  void pageVersion.n;
  void rowsVersion.n;
  return rows.value.map((row) => {
    const id = documentRow(props.tab.id, row)?.id ?? null;
    const expanded = id !== null && isDocumentExpanded(props.tab.id, id);
    return rowHeight(
      props.tab.id,
      row,
      editingRow.value,
      expanded,
      !expanded && isSearchMatch(row),
    );
  });
});

// A search match names a row index into the currently loaded page (documents/search.ts) — jumping to it
// expands that document (if it wasn't already) and scrolls it into view via VirtualList's own
// offset-aware scrollToIndex (D8) rather than querySelector + scrollIntoView, which silently did
// nothing for a match outside the rendered window (F10). scrollToIndex takes a position in
// `rows.value` (the rendered array), not a raw page-row number — the two only coincide when the
// filter toggle (D17) is off, so this always looks the position up rather than assuming they match.
function onGoToMatch(match: Match): void {
  const row = match.row;
  const view = rowView(props.tab.id, row);
  if (!view) return;
  if (!isDocumentExpanded(props.tab.id, view.id)) toggleExpanded(props.tab.id, view.id);
  void nextTick(() => {
    const index = rows.value.indexOf(row);
    if (index >= 0) virtualListRef.value?.scrollToIndex(index);
  });
}

function startEdit(row: number, id: string, body: string): void {
  if (!editGate.value.editable) return;
  editingRow.value = row;
  editingId.value = id;
  editOriginal.value = toShellText(body);
  editBuffer.reseed();
}

function cancelEdit(): void {
  editingRow.value = null;
  editingId.value = null;
}

async function commitEdit(): Promise<void> {
  const id = editingId.value;
  if (id === null) return;
  try {
    await saveDocumentEdit(props.tab.id, id, editBuffer.doc.value);
    setActionError(props.tab.id, null);
    editingRow.value = null;
    editingId.value = null;
  } catch (err) {
    setActionError(props.tab.id, err instanceof Error ? err.message : String(err));
  }
}

function onRowContextMenu(e: MouseEvent, row: number): void {
  e.preventDefault();
  const entry = rowAt(row);
  if (!entry) return;
  const ids = idsOf(rows.value);
  openContextMenu(
    e,
    rowMenu(
      props.tab.id,
      entry.view.id,
      entry.body,
      ids,
      () => startEdit(row, entry.view.id, entry.body),
      editGate.value,
    ),
  );
}

// D6: the same confirm + deleteDocument path the context menu's own Delete item already uses
// (documents/menu.ts) — one delete path, not two.
async function onDeleteRow(id: string): Promise<void> {
  if (!(await confirmDialog(`Delete this document (_id: ${id})?`))) return;
  deleteDocument(props.tab.id, id)
    .then(() => setActionError(props.tab.id, null))
    .catch((err: unknown) => {
      setActionError(props.tab.id, err instanceof Error ? err.message : String(err));
    });
}

function onStop(): void {
  stop(props.tab.id);
}

function onRefresh(): void {
  refreshOrReconnect(needsReconnect.value, onReconnectAndLoad, () => reload(props.tab.id));
}

function onExpandAll(): void {
  setAllExpanded(props.tab.id, idsOf(rows.value), true);
}

function onCollapseAll(): void {
  setAllExpanded(props.tab.id, idsOf(rows.value), false);
}

function onRowClick(i: number): void {
  selectRow(props.tab.id, i);
}

let unregisterCommand: (() => void) | null = null;
let unregisterFindCommand: (() => void) | null = null;

onMounted(() => {
  // P42 D9: this tab's own page.ts documentRow is where views/shared/document/rows.ts's
  // functions resolve `props.tab.id` to actual rows — now registered at setup's own top level
  // (see the comment up there for why), not here.
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  // Item 4 (regression pass, task batch P46-4): route through the same gate-aware onRefresh the
  // toolbar button uses — this used to call reload() directly, a doomed no-op behind the gate.
  unregisterCommand = registerCommand('view.refresh', onRefresh);
  unregisterFindCommand = registerCommand('view.find', onToggleSearch);
});

onUnmounted(() => {
  unregisterDocumentRows(props.tab.id);
  unregisterCommand?.();
  unregisterFindCommand?.();
});
</script>

<template>
  <div class="document-view" data-testid="document-view" :data-path="tab.path">
    <!-- Item (regression pass, task batch P46-5): Vue casts an *absent* Boolean-typed prop to
         `false`, not `undefined` — ViewChrome.vue's own `:disabled="canRefresh === false"` made
         omitting can-refresh here silently mean "always disabled", regardless of connection or
         load state. Every other gated view already passes something explicit (BrowseView/
         KeyValueView's own literal `true`, mirrored here) — this was the one view (Stream too,
         same fix) that didn't, and so had a permanently-grey Refresh button the whole time. -->
    <ViewChrome
      :tab="tab"
      icon="json"
      :icon-color="iconColor"
      :path="pathPrefix"
      :name="targetTail?.name ?? tab.path"
      target-testid="document-target"
      refresh-testid="document-refresh"
      stop-testid="document-stop"
      :can-refresh="true"
      :can-stop="running"
      @refresh="onRefresh"
      @stop="onStop"
    >
      <template #badges>
        <span class="p-badge">collection</span>
      </template>

      <template #toolbar>
        <div class="sep"></div>
        <!-- Canonical order and shape (DataToolbar.vue is the reference): first/prev/page-jump/
             next/last, then page-size, then a count/columns-equivalent group, then the
             add/search group. Mongo supports an arbitrary skip()/limit() offset, so — unlike
             Redis/Kafka/SQS's cursor-only pagination — a real page-N jump box applies here too. -->
        <PagerControls
          :page-index="tab.state.pageIndex"
          :page-size="tab.state.pageSize"
          :count="rt?.count?.value ?? null"
          :has-more="!!rt?.hasMore"
          testid-prefix="document-"
          last-tooltip="Count documents first"
          @first="goFirst(tab.id)"
          @prev="goPrev(tab.id)"
          @next="goNext(tab.id)"
          @last="goLast(tab.id)"
          @jump="onJump"
        />
        <div class="sep"></div>
        <SegmentedControl
          :model-value="tab.state.pageSize"
          :options="PAGE_SIZE_OPTIONS"
          data-testid="document-page-size-picker"
          @update:model-value="onPageSize"
        />
        <div class="sep"></div>
        <!-- DataToolbar's [count, columns, preview] group — this collection's equivalents are
             the exact count, the fields/projection menu, and expand/collapse-all. -->
        <div class="group">
          <IconButton
            icon="symbol-number"
            data-testid="document-count"
            v-tooltip="'Run an exact countDocuments() — the estimate above is metadata'"
            @click="runCount(tab.id)"
          />
          <div class="projection-anchor">
            <IconButton
              icon="list-selection"
              data-testid="document-toolbar-projection"
              :indicator="tab.state.projection !== null"
              :active="projectionOpen"
              v-tooltip="projectionCountLabel ? `Fields — ${projectionCountLabel} shown` : 'Fields'"
              @click="projectionOpen = !projectionOpen"
            />
            <ProjectionMenu
              v-if="projectionOpen"
              :tab-id="tab.id"
              :caps="caps"
              @close="projectionOpen = false"
            />
          </div>
          <IconButton
            icon="expand-all"
            v-tooltip="'Expand all'"
            data-testid="document-expand-all"
            @click="onExpandAll"
          />
          <IconButton
            icon="collapse-all"
            v-tooltip="'Collapse all'"
            data-testid="document-collapse-all"
            @click="onCollapseAll"
          />
        </div>
        <div class="sep"></div>
        <!-- DataToolbar's [add-row, delete-row, search] group — this collection has no delete
             affordance in the toolbar (deletion lives on the row's own context menu). -->
        <div class="group">
          <IconButton
            icon="add"
            data-testid="document-add"
            :disabled="!caps?.canInsert"
            v-tooltip="caps?.canInsert ? 'Add a document' : 'Connection does not support insert'"
            @click="onAddDocument"
          />
          <IconButton
            icon="search"
            :active="rt?.searchOpen"
            v-tooltip="'Search this page'"
            data-testid="document-toolbar-search"
            @click="onToggleSearch"
          />
        </div>
      </template>

      <!-- The Mongo dialect of the filter row: one filter box, permanent, never closed — plus a
           SORT box beside it (read.ts's structured-sort-only rule, see ./sortDocument.ts's
           sortSpecToText/parseSortText), FilterToolbar.vue's ORDER BY box narrowed to the one form
           Mongo can actually execute and reworded to Mongo's own sort-document syntax rather than SQL's.
           History button and Clear button match FilterToolbar.vue's own layout exactly — this row
           used to have neither. -->
      <template #toolbar-2>
        <div class="history-anchor">
          <IconButton
            icon="history"
            v-tooltip="'Saved & recent filters'"
            data-testid="document-filter-history-button"
            @click="filterHistoryOpen = !filterHistoryOpen"
          />
          <FilterHistoryMenu
            v-if="filterHistoryOpen"
            :connection-id="tab.connectionId"
            :path="tab.path"
            :current-filter="searchText === '' ? null : searchText"
            :current-sort="tab.state.sort"
            @apply="applyFromFilterHistory"
            @close="filterHistoryOpen = false"
          />
        </div>
        <div class="filter-field">
          <AutocompleteField
            v-model="searchText"
            placeholder="Filter (e.g. { name: 'a' })"
            data-testid="document-search"
            :candidates="filterCandidates"
            language="mongo"
            @enter="onSearchInput"
            @blur="onSearchInput"
          />
        </div>
        <div class="sort-field">
          <AutocompleteField
            v-model="sortText"
            prefix="SORT"
            :prefix-active="!!tab.state.sort"
            placeholder="{ createdAt: -1, name: 1 }"
            v-tooltip="'Mongo sort document: 1 = ascending, -1 = descending'"
            data-testid="document-sort"
            :candidates="sortCandidates"
            language="mongo"
            @enter="onSortInput"
            @blur="onSortInput"
          />
        </div>
        <AppButton v-tooltip="'Empty both fields and refetch'" data-testid="document-filter-clear" @click="onClearFilter">
          Clear
        </AppButton>
      </template>

      <template #strips>
        <MessageStrip v-if="rt?.status === 'error' && rt.error" tone="err" data-testid="document-error">
          {{ rt.error.message }}
        </MessageStrip>
        <!-- P43 F6/D7: a failed insert/edit/delete, distinct from a failed load above — the list
             is still showing a perfectly valid page, only the write was refused. -->
        <MessageStrip v-if="rt?.actionError" tone="err" data-testid="document-action-error">
          {{ rt.actionError }}
        </MessageStrip>
        <!-- Below the filter/sort row, above the list it searches — views/shared/page/SearchToolbar.vue's own
             "docks at the bottom of the toolbar it belongs to" placement (LAW 03). -->
        <SearchToolbar
          v-if="rt?.searchOpen"
          :tab-id="tab.id"
          testid-prefix="document-"
          row-noun="documents"
          :api="pageSearchApi"
          @go-to-match="onGoToMatch"
          @close="onCloseSearch"
        />
      </template>

      <!-- Item 4: the reconnect gate used to replace this whole ViewChrome (header, toolbar and
           all) — every other view but the grid's DataView.vue did the same, the one inconsistency
           this fixes. ViewChrome itself (and so its toolbar slots above) now always renders; only
           the body — the part that actually needs a live connection — swaps for the gate. -->
      <ReconnectGate
        v-if="needsReconnect"
        container-testid="document-reconnect"
        button-testid="document-reconnect-load"
        @reconnect="onReconnectAndLoad"
      />
      <template v-else>
      <div v-if="creatingNew" class="new-doc-panel" data-testid="document-new">
        <CodeMirrorHost v-model:doc="newBuffer.doc.value" language="json" :read-only="false" />
        <div class="edit-actions">
          <EditBufferActions :buffer="newBuffer" testid-prefix="document-new" :show-compact="false" />
          <span class="edit-actions-spacer"></span>
          <AppButton variant="primary" data-testid="document-new-save" @click="commitCreate">
            Save
          </AppButton>
          <AppButton data-testid="document-new-cancel" @click="cancelCreate"> Cancel </AppButton>
        </div>
      </div>

      <div class="list-body" data-testid="document-list">
        <EmptyState
          v-if="!rt || rt.rowCount === 0"
          :icon="rt ? 'json' : 'loading'"
          :label="rt ? 'No documents' : 'Loading…'"
        />
        <!-- P31 D19 (P24 D8's precedent): filtering to zero matches is a distinct empty state
             from "no documents loaded". -->
        <EmptyState
          v-else-if="displayRows && displayRows.length === 0"
          icon="search"
          label="No matching rows"
          data-testid="document-no-matching-rows"
        >
          <AppButton data-testid="document-show-all-rows" @click="setSearchFiltering(tab.id, false)">
            Show all rows
          </AppButton>
        </EmptyState>
        <!-- D1/D19: the row shows only its `_id` and two facts (field count, size) — no part of
             the body — until expanded; an expanded document renders through DocumentTree.vue's
             flat line list, never a per-row CodeMirror instance, which is what makes "every
             document expanded by default" (D2) affordable at all. -->
        <VirtualList
          v-else
          ref="virtualListRef"
          class="document-virtual-list"
          :items="rows"
          :row-height="26"
          :row-heights="rowHeights"
          @visible-range="onVisibleRange"
        >
          <!-- P5 C2: `item` is now a plain page-row number — `rowAt` (script above) resolves it
               (id/body decode, body parse) only for the row VirtualList is actually rendering.
               Guarded by `v-if="rowAt(item)"` (never false for a row VirtualList hands back; page
               rows in range always resolve) so `rowAt(item)!` below can carry a definite,
               non-null DocumentRowView into DocumentRow's own required `view` prop. -->
          <template #default="{ item, index }">
            <!-- P43 iter3 F31a: onRowClick only sets the row's own highlight (state.ts's
                 selectRow) — this view mounts no cell editor dock to publish a selection into
                 (§8.7: a document's own row is already the read/write surface). The expand
                 toggle and the Edit/Delete buttons below are nested inside this same click
                 target — clicking any of them also reselects the row, which is harmless (selecting
                 the row you just acted on is never wrong), so their own handlers stop propagation
                 rather than double-firing selectRow with the same index. -->
            <DocumentRow
              v-if="rowAt(item)"
              data-testid="document-row"
              :style="{ height: `${rowHeights[index]}px` }"
              @contextmenu="onRowContextMenu($event, item)"
              :view="rowAt(item)!.view"
              :scope="tab.id"
              :expanded="isDocumentExpanded(tab.id, rowAt(item)!.view.id)"
              :selected="rt?.selectedRow === index"
              :search-match="isSearchMatch(item)"
              :search-match-current="isCurrentSearchMatch(item)"
              @toggle="toggleExpanded(tab.id, rowAt(item)!.view.id)"
              @select="onRowClick(index)"
            >
              <template #actions>
                <span class="doc-head-spacer"></span>
                <div class="doc-row-actions">
                  <span v-if="editingRow === item" class="p-chip warn">editing</span>
                  <IconButton
                    icon="edit"
                    :active="editingRow === item"
                    data-testid="document-edit"
                    :disabled="!editGate.editable"
                    v-tooltip="editGate.editable ? 'Edit' : editGate.label"
                    @click.stop="startEdit(item, rowAt(item)!.view.id, rowAt(item)!.body)"
                  />
                  <IconButton
                    icon="trash"
                    data-testid="document-delete"
                    :disabled="!caps?.canDelete"
                    v-tooltip="caps?.canDelete ? 'Delete' : 'Connection does not support delete'"
                    @click.stop="onDeleteRow(rowAt(item)!.view.id)"
                  />
                </div>
              </template>
              <template #body>
                <!-- P31 D20/F21: a search match said nothing about *which* document matched (the
                     collapsed row otherwise shows only `_id`, per D1) — this wraps the matched
                     substring in <mark> inside the same string documents/search.ts's scanner matched
                     against, so it cannot disagree with the offsets. Only while collapsed: an
                     expanded document's own body is out of scope (§6). -->
                <div
                  v-if="isSearchMatch(item) && !isDocumentExpanded(tab.id, rowAt(item)!.view.id)"
                  class="doc-preview-match"
                  data-testid="document-search-preview"
                >
                  <template v-for="(seg, si) in previewSegments(item, rowAt(item)!.body)" :key="si">
                    <mark v-if="seg.matched">{{ seg.text }}</mark>
                    <template v-else>{{ seg.text }}</template>
                  </template>
                </div>
                <div
                  v-if="isDocumentExpanded(tab.id, rowAt(item)!.view.id)"
                  class="doc-body"
                  data-testid="document-body"
                >
                  <!-- The editor is the same code surface the definition view and the console views
                       use — the only difference is the language. -->
                  <template v-if="editingRow === item">
                    <CodeMirrorHost v-model:doc="editBuffer.doc.value" language="json" :read-only="false" />
                    <div class="edit-actions">
                      <EditBufferActions :buffer="editBuffer" testid-prefix="document-edit" :show-compact="false" />
                      <span class="edit-actions-spacer"></span>
                      <AppButton variant="primary" data-testid="document-edit-save" @click="commitEdit">
                        Save
                      </AppButton>
                      <AppButton data-testid="document-edit-cancel" @click="cancelEdit">
                        Cancel
                      </AppButton>
                    </div>
                  </template>
                  <DocumentTree
                    v-else-if="rowAt(item)!.view.root"
                    :tab-id="tab.id"
                    :row="item"
                    @toggle-path="(path) => togglePath(tab.id, item, path)"
                  />
                  <!-- D22: a body that doesn't parse (truncated mid-token, or genuinely not an
                       object) falls back to raw text rather than a tree that has nothing to walk. -->
                  <CodeMirrorHost v-else :doc="rowAt(item)!.body" language="json" :read-only="true" />
                </div>
              </template>
            </DocumentRow>
          </template>
        </VirtualList>
      </div>
      </template>
    </ViewChrome>
  </div>
</template>

<style scoped>
.document-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* TextField's root <span class="p-input"> only receives fallthrough attrs on its inner <input>
   (see TextField.vue's inheritAttrs:false), so the permanent filter row's "grow to fill" sizing
   moves onto this wrapper instead of a style attribute on the component tag itself. */
.history-anchor {
  position: relative;
}

.filter-field {
  flex: 1;
  min-width: 0;
}

.filter-field :deep(.p-input) {
  width: 100%;
}

/* FilterToolbar.vue's orderby-input precedent: a fixed width beside the filter field that grows
   to fill, same TextField inheritAttrs:false reasoning as `.filter-field` above. Widened from the
   SQL-style box's 230px — a Mongo sort document (`{ createdAt: -1, name: 1 }`) runs a bit longer
   than the old `field ASC, field2 DESC` text it replaced. */
.sort-field {
  width: 280px;
  flex-shrink: 0;
}

.sort-field :deep(.p-input) {
  width: 100%;
}

.projection-anchor {
  position: relative;
}

.new-doc-panel {
  height: 220px;
  flex-shrink: 0;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-elevated);
  display: flex;
  flex-direction: column;
}

.list-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.document-virtual-list {
  height: 100%;
}

/* P48 F10-F12: the row shell and its head (.doc-row/.doc-head and friends, .expand-toggle,
   .doc-id) now live in views/shared/document/DocumentRow.vue — this view only styles its own
   #actions/#body slot content. The row's own total height is set inline from
   documentRows.ts's rowHeight() (P27 D20) — CSS only distributes it between the fixed-height
   head and whatever's left for the body, never restates the number itself. */
.doc-preview-match {
  padding: 0 var(--kira-s-4) var(--kira-s-2);
  font-family: var(--kira-font-family);
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* .doc-preview-match's own `color` above otherwise wins over the row's (specificity, not
   inheritance) — this compound selector is what actually flips it on the current match.
   :deep() on the ancestor half: `.doc-row.search-match-current` is DocumentRow.vue's own root
   now, outside this component's scope-id — only `.doc-preview-match` itself needs scoping. */
:deep(.doc-row.search-match-current) .doc-preview-match {
  color: var(--kira-bg);
}

.doc-preview-match mark {
  background: var(--kira-warn);
  color: var(--kira-bg);
  border-radius: var(--kira-radius-sm);
}

/* Pushes .doc-row-actions to the trailing edge, the same role .doc-preview played before D1
   emptied that slot. */
.doc-head-spacer {
  flex: 1;
  min-width: 0;
}

.doc-row-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

/* flex: 1 over the row's own inline height (above) rather than a literal number — matches
   HEAD_H + visibleLines().length * LINE_H (or the fixed editing height) exactly, whichever this
   row currently is. */
.doc-body {
  flex: 1;
  min-height: 0;
  border-top: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-elevated);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.edit-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  padding: var(--kira-s-2) var(--kira-s-4);
  border-top: var(--kira-border-width) solid var(--kira-border);
}

/* Pushes Save/Cancel to the trailing edge, past P27 D28's EditBufferActions row. */
.edit-actions-spacer {
  flex: 1;
  min-width: 0;
}
</style>
