<script setup lang="ts">
import type { SortSpec } from '@shared/domain/queries';
import type { DocumentTabRecord, DocumentTabState } from '@shared/domain/tabs';
import { decodePath, pathTail } from '@shared/domain/tree';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { control } from '../../bridge/control';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { registerCommand } from '../../shortcuts/commands';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { connColorVar } from '../../theme/connColor';
import AppButton from '../../theme/primitives/AppButton.vue';
import AutocompleteField from '../../theme/primitives/AutocompleteField.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import TextField from '../../theme/primitives/TextField.vue';
import ViewChrome from '../../workbench/panels/ViewChrome.vue';
import { openContextMenu } from '../../workbench/state/contextMenu';
import VirtualList from '../../workbench/VirtualList.vue';
import CellEditorDock from '../celleditor/CellEditorDock.vue';
import EditBufferActions from '../shared/EditBufferActions.vue';
import FilterHistoryMenu from '../shared/FilterHistoryMenu.vue';
import { setSearchFiltering } from '../shared/searchFilter';
import { useEditBuffer } from '../shared/useEditBuffer';
import DocumentSearchToolbar from './DocumentSearchToolbar.vue';
import DocumentTree from './DocumentTree.vue';
import { documentRow, fieldNamesOnPage, pageVersion } from './docPage';
import { searchState as docSearchState, matchedRows, previewLineFor } from './docSearch';
import { documentMenu } from './documentMenu';
import { deleteDocument, saveDocumentEdit, saveNewDocument } from './documentMutations';
import { type DocumentRowView, rowHeight, rowsVersion, rowView, togglePath } from './documentRows';
import { beautifyShellText, toShellText } from './ejson';
import { mongoFilterCandidates, mongoSortCandidates } from './filterCompletion';
import ProjectionMenu from './ProjectionMenu.vue';
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
  setAllExpanded,
  setPageSize,
  setSearch,
  setSort,
  stop,
  toggleExpanded,
} from './state';

// MainView.vue keys this component by tab.id — same discipline as DefinitionView.vue/ConsoleView.vue.
const props = defineProps<{ tab: DocumentTabRecord }>();

const connectionStatus = computed(() =>
  props.tab.connectionId
    ? (connectionsState.states[props.tab.connectionId]?.status ?? 'disconnected')
    : 'disconnected',
);

const needsReconnect = computed(
  () => !isHydrated(props.tab.id) || connectionStatus.value !== 'connected',
);

async function onReconnectAndLoad(): Promise<void> {
  if (!props.tab.connectionId) return;
  if (connectionStatus.value !== 'connected') {
    await connectConnection(props.tab.connectionId);
  }
  markHydrated(props.tab.id);
  await load(props.tab.id);
}

const rt = computed(() => runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'loading');

// DataToolbar.vue's own gate, narrowed to the one flag this view's Add-document button reads
// (§0 note: "A renderer gating a single action ... reads the matching flag instead of `writable`").
const caps = computed(() => {
  const connectionId = props.tab.connectionId;
  return connectionId ? (connectionsState.states[connectionId]?.caps ?? null) : null;
});

const targetTail = computed(() => pathTail(props.tab.path));

// P16 design system LAW: the connection colour reaches a view as a 2px rail (here: the
// toolbar cap and the view-head dot) — never a tint or a full border on the panel itself.
// No colour assigned leaves the rail slot unpainted rather than unrendered, so nothing shifts
// when a colour is set later. Mirrors Toolbar.vue's `color`/`railStyle` computed pair.
const connectionColor = computed(() => {
  const id = props.tab.connectionId;
  if (!id) return undefined;
  return connectionsState.records.find((r) => r.id === id)?.color;
});

const iconColor = computed(() => connColorVar(connectionColor.value) ?? 'var(--kira-fg-muted)');

// The view-head's breadcrumb prefix ("connection / database / "): derived from the already
// loaded connection record and the tab's own path, purely for display — no new state.
const pathPrefix = computed(() => {
  const connectionId = props.tab.connectionId;
  if (!connectionId) return '';
  const connectionName = connectionsState.records.find((r) => r.id === connectionId)?.name;
  const segments = decodePath(connectionId, props.tab.path).segments;
  const parts = [connectionName, ...segments.slice(0, -1).map((s) => s.name)].filter(
    (p): p is string => !!p,
  );
  return parts.length ? `${parts.join(' / ')} / ` : '';
});

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

// The Mongo dialect of FilterToolbar.vue's ORDER BY box: unlike SQL's free-text sort, Mongo's
// read.ts explicitly rejects a `{kind:'text'}` sort (a free-text expression has no server-side
// meaning here) — so this box parses straight into the structured form itself, never the text
// variant, mirroring how clicking a grid column header builds structured terms. The box's own
// syntax is Mongo's own sort-document shape (`{ field: 1, field2: -1 }`, `1` ascending / `-1`
// descending — a `db.collection.find().sort(...)` argument, not SQL's `ORDER BY field ASC`) so a
// Mongo user can type what they already know; `sortSpecToText`/`parseSortText` are this box's own
// serializer/parser and must round-trip each other exactly.
const sortText = ref(sortSpecToText(props.tab.state.sort));

function sortSpecToText(sort: SortSpec | null): string {
  if (sort?.kind !== 'structured' || sort.terms.length === 0) return '';
  const body = sort.terms.map((t) => `${t.column}: ${t.direction === 'desc' ? -1 : 1}`).join(', ');
  return `{ ${body} }`;
}

// Lenient by design (matches how a Mongo shell user actually types a sort document): braces are
// optional, keys may be bare or quoted (single or double), and `asc`/`desc` are tolerated
// alongside Mongo's own `1`/`-1` for anyone still transitioning off the old ORDER BY-style box.
// Anything that isn't a `key: value` pair is simply skipped rather than rejecting the whole
// string, since a half-typed sort document while the user is still editing is not an error.
const SORT_TERM_RE = /(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.$]+))\s*:\s*(-?1|asc|desc)/gi;

function parseSortText(text: string): SortSpec | null {
  const terms: { column: string; direction: 'asc' | 'desc' }[] = [];
  for (const match of text.matchAll(SORT_TERM_RE)) {
    const column = match[1] ?? match[2] ?? match[3];
    if (!column) continue;
    const value = match[4].toLowerCase();
    const direction: 'asc' | 'desc' = value === '-1' || value === 'desc' ? 'desc' : 'asc';
    terms.push({ column, direction });
  }
  return terms.length > 0 ? { kind: 'structured', terms } : null;
}

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
const PAGE_SIZE_OPTIONS: { value: DocumentTabState['pageSize']; label: string; testid: string }[] =
  [
    { value: 10, label: '10', testid: 'document-page-size-10' },
    { value: 100, label: '100', testid: 'document-page-size-100' },
    { value: 1000, label: '1k', testid: 'document-page-size-1000' },
    { value: 10000, label: '10k', testid: 'document-page-size-10000' },
  ];

function onPageSize(size: DocumentTabState['pageSize']): void {
  setPageSize(props.tab.id, size);
}

// Mirrors DataToolbar.vue's own pageDisplay/pageInputValue/pageCount/onJump exactly, now that
// goFirst/goLast/goToPage give Document the same absolute-offset jump SQL has.
const pageDisplay = computed(() => props.tab.state.pageIndex + 1);
const pageInputValue = ref(String(pageDisplay.value));
watch(pageDisplay, (v) => {
  pageInputValue.value = String(v);
});
const pageCount = computed(() => {
  const count = rt.value?.count;
  const size = props.tab.state.pageSize;
  if (!count || !size) return null;
  return Math.max(1, Math.ceil(count.value / size));
});
function onJump(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value);
  if (Number.isFinite(value) && value >= 1) void goToPage(props.tab.id, value - 1);
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
  await saveNewDocument(props.tab.id, newBuffer.doc.value);
  creatingNew.value = false;
  newBuffer.reseed();
}

function onToggleSearch(): void {
  const r = runtime[props.tab.id];
  if (r) r.searchOpen = !r.searchOpen;
}

function onCloseSearch(): void {
  const r = runtime[props.tab.id];
  if (r) r.searchOpen = false;
}

const virtualListRef = ref<{ scrollToIndex: (index: number) => void } | null>(null);

const editingId = ref<string | null>(null);
// The row currently being edited seeds from toShellText(body) — the shell-literal spelling, not
// the raw canonical-EJSON wire text — so editing reads the same ObjectId(…)/ISODate(…) form the
// collapsed row and the tree already show (D14/D29).
const editOriginal = ref('');
const editBuffer = useEditBuffer({
  original: () => editOriginal.value,
  beautifier: () => beautifyShellText,
});

// D23: the list's v-for iterates this — plain per-row view objects, not an index range resolved
// by a function. Carries the raw body alongside documentRows.ts's own DocumentRowView (whose
// `root` is a parsed tree, not text) since Edit/context-menu/cell-editor-publish still need the
// literal EJSON string.
interface DocumentRowEntry {
  view: DocumentRowView;
  body: string;
}

// P31 D17/D18: the same "hide non-matching rows" toggle grid/keyvalue/stream share (P24 D2).
const displayRows = computed<number[] | null>(() => matchedRows(props.tab.id));

const rows = computed<DocumentRowEntry[]>(() => {
  void pageVersion.n;
  const indices = displayRows.value ?? Array.from({ length: rt.value?.rowCount ?? 0 }, (_, i) => i);
  const out: DocumentRowEntry[] = [];
  for (const i of indices) {
    const doc = documentRow(props.tab.id, i);
    const view = rowView(props.tab.id, i);
    if (!doc || !view) continue;
    out.push({ view, body: doc.body });
  }
  return out;
});

// P31 D20: real match highlighting — .search-match/.search-match-current on the row, and the
// matched substring wrapped in <mark> inside a preview line built with docSearch's own
// previewLineFor, so the highlighted offsets can never disagree with what the scanner matched
// against. Keyed by row (docSearch's Match has no column, unlike the grid/keyvalue's).
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
// docSearch.ts's Match.start/end are offsets into exactly this string (previewLineFor(body)), so
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
const rowHeights = computed<number[]>(() => {
  void pageVersion.n;
  void rowsVersion.n;
  return rows.value.map((r) => {
    const expanded = isDocumentExpanded(props.tab.id, r.view.id);
    return rowHeight(
      props.tab.id,
      r.view.index,
      editingId.value,
      expanded,
      !expanded && isSearchMatch(r.view.index),
    );
  });
});

// A search match names a row index into the currently loaded page (docSearch.ts) — jumping to it
// expands that document (if it wasn't already) and scrolls it into view via VirtualList's own
// offset-aware scrollToIndex (D8) rather than querySelector + scrollIntoView, which silently did
// nothing for a match outside the rendered window (F10). scrollToIndex takes a position in
// `rows.value` (the rendered array), not a raw page-row number — the two only coincide when the
// filter toggle (D17) is off, so this always looks the position up rather than assuming they match.
function onGoToMatch(row: number): void {
  const view = rowView(props.tab.id, row);
  if (!view) return;
  if (!isDocumentExpanded(props.tab.id, view.id)) toggleExpanded(props.tab.id, view.id);
  void nextTick(() => {
    const index = rows.value.findIndex((r) => r.view.index === row);
    if (index >= 0) virtualListRef.value?.scrollToIndex(index);
  });
}

function startEdit(id: string, body: string): void {
  editingId.value = id;
  editOriginal.value = toShellText(body);
  editBuffer.reseed();
}

function cancelEdit(): void {
  editingId.value = null;
}

async function commitEdit(): Promise<void> {
  const id = editingId.value;
  if (id === null) return;
  await saveDocumentEdit(props.tab.id, id, editBuffer.doc.value);
  editingId.value = null;
}

function onRowContextMenu(e: MouseEvent, id: string, body: string): void {
  e.preventDefault();
  const ids = rows.value.map((r) => r.view.id);
  openContextMenu(
    e,
    documentMenu(props.tab.id, id, body, ids, () => startEdit(id, body)),
  );
}

// D6: the same confirm + deleteDocument path the context menu's own Delete item already uses
// (documentMenu.ts) — one delete path, not two.
function onDeleteRow(id: string): void {
  if (!window.confirm(`Delete this document (_id: ${id})?`)) return;
  void deleteDocument(props.tab.id, id);
}

function onStop(): void {
  stop(props.tab.id);
}

function onExpandAll(): void {
  setAllExpanded(
    props.tab.id,
    rows.value.map((r) => r.view.id),
    true,
  );
}

function onCollapseAll(): void {
  setAllExpanded(
    props.tab.id,
    rows.value.map((r) => r.view.id),
    false,
  );
}

function onRowClick(i: number): void {
  selectRow(props.tab.id, i);
}

let unregisterCommand: (() => void) | null = null;
let unregisterFindCommand: (() => void) | null = null;

onMounted(() => {
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  unregisterCommand = registerCommand('view.refresh', () => void reload(props.tab.id));
  unregisterFindCommand = registerCommand('view.find', onToggleSearch);
});

onUnmounted(() => {
  unregisterCommand?.();
  unregisterFindCommand?.();
});
</script>

<template>
  <div class="document-view" data-testid="document-view" :data-path="tab.path">
    <ReconnectGate
      v-if="needsReconnect"
      container-testid="document-reconnect"
      button-testid="document-reconnect-load"
      @reconnect="onReconnectAndLoad"
    />
    <ViewChrome
      v-else
      :tab="tab"
      icon="json"
      :icon-color="iconColor"
      :path="pathPrefix"
      :name="targetTail?.name ?? tab.path"
      target-testid="document-target"
      refresh-testid="document-refresh"
      stop-testid="document-stop"
      :can-stop="running"
      @refresh="reload(tab.id)"
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
        <div class="group pager" data-testid="document-pager">
          <IconButton
            icon="chevron-left"
            v-tooltip="'First page'"
            data-testid="document-pager-first"
            :disabled="tab.state.pageIndex === 0"
            @click="goFirst(tab.id)"
          />
          <IconButton
            icon="arrow-left"
            data-testid="document-prev"
            :disabled="tab.state.pageIndex === 0"
            v-tooltip="'Previous page'"
            @click="goPrev(tab.id)"
          />
          <span class="page-label p-sm muted">
            page
            <div class="page-input">
              <TextField
                v-model="pageInputValue"
                type="number"
                min="1"
                hide-stepper
                data-testid="document-pager-page-input"
                @change="onJump"
              />
            </div>
            <template v-if="pageCount"> of {{ pageCount }}</template>
          </span>
          <IconButton
            icon="arrow-right"
            data-testid="document-next"
            :disabled="!rt?.hasMore"
            v-tooltip="'Next page'"
            @click="goNext(tab.id)"
          />
          <IconButton
            icon="chevron-right"
            v-tooltip="pageCount ? 'Last page' : 'Count documents first'"
            data-testid="document-pager-last"
            :disabled="!pageCount"
            @click="goLast(tab.id)"
          />
        </div>
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
              :count="tab.state.projection !== null ? (projectionCountLabel ?? undefined) : undefined"
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
           SORT box beside it (read.ts's structured-sort-only rule, see sortSpecToText/
           parseSortText above), FilterToolbar.vue's ORDER BY box narrowed to the one form Mongo
           can actually execute and reworded to Mongo's own sort-document syntax rather than SQL's.
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
            @enter="onSearchInput"
            @blur="onSearchInput"
          />
        </div>
        <div class="sort-field">
          <AutocompleteField
            v-model="sortText"
            prefix="SORT"
            placeholder="{ createdAt: -1, name: 1 }"
            v-tooltip="'Mongo sort document: 1 = ascending, -1 = descending'"
            data-testid="document-sort"
            :candidates="sortCandidates"
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
        <!-- Below the filter/sort row, above the list it searches — SearchToolbar.vue's own
             "docks at the bottom of the toolbar it belongs to" placement (LAW 03). -->
        <DocumentSearchToolbar
          v-if="rt?.searchOpen"
          :tab-id="tab.id"
          @go-to-match="onGoToMatch"
          @close="onCloseSearch"
        />
      </template>

      <div v-if="creatingNew" class="new-doc-panel" data-testid="document-new">
        <CodeMirrorHost v-model:doc="newBuffer.doc.value" language="json" :read-only="false" />
        <div class="edit-actions">
          <EditBufferActions :buffer="newBuffer" testid-prefix="document-new" />
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
        >
          <template #default="{ item, index }">
            <div
              class="doc-row"
              :class="{
                open: isDocumentExpanded(tab.id, item.view.id),
                selected: rt?.selectedRow === index,
                'search-match': isSearchMatch(item.view.index),
                'search-match-current': isCurrentSearchMatch(item.view.index),
              }"
              data-testid="document-row"
              :data-id="item.view.id"
              :style="{ height: `${rowHeights[index]}px` }"
              @contextmenu="onRowContextMenu($event, item.view.id, item.body)"
            >
              <!-- Publishes the whole document to the cell editor (see the `watch` above). The
                   expand toggle and the Edit/Delete buttons below are nested inside this same click
                   target — clicking any of them also reselects the row, which is harmless (selecting
                   the row you just acted on is never wrong), so their own handlers stop propagation
                   rather than double-firing selectRow with the same index. -->
              <div class="doc-head" @click="onRowClick(index)">
                <button
                  type="button"
                  class="expand-toggle"
                  data-testid="document-toggle-expand"
                  :aria-label="isDocumentExpanded(tab.id, item.view.id) ? 'Collapse' : 'Expand'"
                  @click.stop="toggleExpanded(tab.id, item.view.id)"
                >
                  <CodiconIcon
                    :name="isDocumentExpanded(tab.id, item.view.id) ? 'chevron-down' : 'chevron-right'"
                    :size="13"
                  />
                </button>
                <span class="doc-id" data-testid="document-id">{{ item.view.idLabel }}</span>
                <span class="p-badge" data-testid="document-field-count"
                  >{{ item.view.fieldCount }} fields</span
                >
                <span class="p-badge" data-testid="document-byte-badge">{{
                  item.view.byteLabel
                }}</span>
                <span
                  v-if="item.view.isTruncated"
                  class="p-badge warn"
                  v-tooltip="'value truncated'"
                  data-testid="document-truncated"
                  >truncated</span
                >
                <span class="doc-head-spacer"></span>
                <div class="doc-row-actions">
                  <span v-if="editingId === item.view.id" class="p-chip warn">editing</span>
                  <IconButton
                    icon="edit"
                    :active="editingId === item.view.id"
                    data-testid="document-edit"
                    :disabled="!caps?.canUpdate"
                    v-tooltip="caps?.canUpdate ? 'Edit' : 'Connection does not support update'"
                    @click.stop="startEdit(item.view.id, item.body)"
                  />
                  <IconButton
                    icon="trash"
                    data-testid="document-delete"
                    :disabled="!caps?.canDelete"
                    v-tooltip="caps?.canDelete ? 'Delete' : 'Connection does not support delete'"
                    @click.stop="onDeleteRow(item.view.id)"
                  />
                </div>
              </div>
              <!-- P31 D20/F21: a search match said nothing about *which* document matched (the
                   collapsed row otherwise shows only `_id`, per D1) — this wraps the matched
                   substring in <mark> inside the same string docSearch.ts's scanner matched
                   against, so it cannot disagree with the offsets. Only while collapsed: an
                   expanded document's own body is out of scope (§6). -->
              <div
                v-if="isSearchMatch(item.view.index) && !isDocumentExpanded(tab.id, item.view.id)"
                class="doc-preview-match"
                data-testid="document-search-preview"
              >
                <template v-for="(seg, si) in previewSegments(item.view.index, item.body)" :key="si">
                  <mark v-if="seg.matched">{{ seg.text }}</mark>
                  <template v-else>{{ seg.text }}</template>
                </template>
              </div>
              <div
                v-if="isDocumentExpanded(tab.id, item.view.id)"
                class="doc-body"
                data-testid="document-body"
              >
                <!-- The editor is the same code surface the definition view and the console views
                     use — the only difference is the language. -->
                <template v-if="editingId === item.view.id">
                  <CodeMirrorHost v-model:doc="editBuffer.doc.value" language="json" :read-only="false" />
                  <div class="edit-actions">
                    <EditBufferActions :buffer="editBuffer" testid-prefix="document-edit" />
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
                  v-else-if="item.view.root"
                  :tab-id="tab.id"
                  :row="item.view.index"
                  @toggle-path="(path) => togglePath(tab.id, item.view.index, path)"
                />
                <!-- D22: a body that doesn't parse (truncated mid-token, or genuinely not an
                     object) falls back to raw text rather than a tree that has nothing to walk. -->
                <CodeMirrorHost v-else :doc="item.body" language="json" :read-only="true" />
              </div>
            </div>
          </template>
        </VirtualList>
      </div>
    </ViewChrome>
    <CellEditorDock :tab-id="tab.id" />
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

/* Mirrors DataToolbar.vue's own .pager/.page-label/.page-input rules exactly. */
.pager {
  gap: var(--kira-s-1);
}

.page-label {
  display: inline-flex;
  align-items: center;
  gap: var(--kira-s-1);
  white-space: nowrap;
}

.page-input {
  width: 46px;
}

.page-input :deep(.p-input) {
  width: 100%;
  padding: 0 var(--kira-s-2);
}

.page-input :deep(input) {
  text-align: center;
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

/* The row's own total height is set inline from documentRows.ts's rowHeight() (P27 D20) — CSS
   only distributes it between the fixed-height head and whatever's left for the body, never
   restates the number itself. */
.doc-row {
  display: flex;
  flex-direction: column;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.doc-head {
  height: var(--kira-h-md);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  padding: 0 var(--kira-s-4);
  cursor: pointer;
}

.doc-head:hover {
  background: var(--kira-hover);
}

.doc-row.open > .doc-head {
  background: var(--kira-bg-elevated);
}

/* The row currently published to the cell editor (this view's `watch` above) — a left rail,
   never a full-row tint, so it stays legible under `.open`'s own background and a search match's
   highlight at the same time. */
.doc-row.selected > .doc-head {
  box-shadow: inset 2px 0 0 var(--kira-accent);
}

/* P31 D20: the same color-mix tint / solid-current pair DataGrid.vue and KeyValueView.vue use —
   a row-level tint (not `.doc-head`'s own opaque `.open` background, so `.selected`'s rail above
   still reads through it) since a document match has no single cell to point at. */
.doc-row.search-match {
  background: color-mix(in srgb, var(--kira-warn) 25%, transparent);
}

.doc-row.search-match-current {
  background: var(--kira-warn);
}

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
   inheritance) — this compound selector is what actually flips it on the current match. */
.doc-row.search-match-current .doc-preview-match {
  color: var(--kira-bg);
}

.doc-preview-match mark {
  background: var(--kira-warn);
  color: var(--kira-bg);
  border-radius: var(--kira-radius-sm);
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
  font-family: var(--kira-font-family);
  font-size: var(--kira-t-md);
  color: var(--kira-fg);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
