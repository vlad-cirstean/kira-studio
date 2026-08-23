<script setup lang="ts">
import type { SortSpec } from '@shared/domain/queries';
import type { DocumentTabRecord, DocumentTabState } from '@shared/domain/tabs';
import { decodePath, pathTail } from '@shared/domain/tree';
import type { ColumnDescriptor } from '@shared/protocol/page';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { control } from '../../bridge/control';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { registerCommand } from '../../shortcuts/commands';
import { clearSelectedCellFor, publishSelectedCell } from '../../state/cellSelection';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import { connColorVar } from '../../theme/connColor';
import Button from '../../theme/primitives/Button.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import IdentifierField from '../../theme/primitives/IdentifierField.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import Strip from '../../theme/primitives/Strip.vue';
import TextField from '../../theme/primitives/TextField.vue';
import ViewChrome from '../../workbench/panels/ViewChrome.vue';
import { openContextMenu } from '../../workbench/state/contextMenu';
import FilterHistoryMenu from '../shared/FilterHistoryMenu.vue';
import DocumentSearchToolbar from './DocumentSearchToolbar.vue';
import { documentRow, fieldNamesOnPage, isIdNull, pageVersion } from './docPage';
import { documentMenu } from './documentMenu';
import { saveDocumentEdit, saveNewDocument } from './documentMutations';
import ProjectionMenu from './ProjectionMenu.vue';
import {
  goFirst,
  goLast,
  goNext,
  goPrev,
  goToPage,
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

// MainView.vue keys this component by tab.id — same discipline as DdlView.vue/ConsoleView.vue.
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

// P18: identifier autocomplete for the filter/sort boxes — field names already computed for the
// Fields/projection menu (fieldNamesOnPage, no extra fetch), plus a small curated set of Mongo
// query operators (filter box only — the sort box's own vocabulary is just 1/-1, handled as a
// separate, tiny candidate list rather than folding into this one).
const MONGO_OPERATORS = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$exists',
  '$regex',
  '$and',
  '$or',
  '$not',
];
const filterCandidates = computed(() => {
  void pageVersion.n;
  return [...fieldNamesOnPage(props.tab.id), ...MONGO_OPERATORS];
});
const sortCandidates = computed(() => {
  void pageVersion.n;
  return fieldNamesOnPage(props.tab.id);
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

const PAGE_SIZES: DocumentTabState['pageSize'][] = [10, 100, 1000, 10000];
const PAGE_SIZE_LABEL: Record<DocumentTabState['pageSize'], string> = {
  10: '10',
  100: '100',
  1000: '1k',
  10000: '10k',
};

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
const newDraft = ref('');

function onAddDocument(): void {
  creatingNew.value = true;
  newDraft.value = '{\n  \n}';
}

function cancelCreate(): void {
  creatingNew.value = false;
  newDraft.value = '';
}

async function commitCreate(): Promise<void> {
  await saveNewDocument(props.tab.id, newDraft.value);
  creatingNew.value = false;
  newDraft.value = '';
}

function onToggleSearch(): void {
  const r = runtime[props.tab.id];
  if (r) r.searchOpen = !r.searchOpen;
}

function onCloseSearch(): void {
  const r = runtime[props.tab.id];
  if (r) r.searchOpen = false;
}

const listBodyRef = ref<HTMLElement | null>(null);

// A search match names a row index into the currently loaded page (docSearch.ts) — jumping to it
// expands that document (if it wasn't already) and scrolls it into view, the closest document
// equivalent of DataGrid.vue's scrollCellIntoView.
function onGoToMatch(row: number): void {
  const doc = rowAt(row);
  if (!doc) return;
  if (!isExpanded(doc.id)) toggleExpanded(props.tab.id, doc.id);
  void nextTick(() => {
    const el = listBodyRef.value?.querySelector(`[data-id="${CSS.escape(doc.id)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  });
}

const rowIndices = computed(() => {
  void pageVersion.n;
  return Array.from({ length: rt.value?.rowCount ?? 0 }, (_, i) => i);
});

const allIds = computed(() => {
  void pageVersion.n;
  return rowIndices.value
    .map((i) => documentRow(props.tab.id, i)?.id)
    .filter((id): id is string => id !== undefined);
});

function rowAt(i: number) {
  void pageVersion.n;
  return documentRow(props.tab.id, i);
}

function isExpanded(id: string): boolean {
  return !!props.tab.state.expanded[id];
}

// One preview line: the body's own text, collapsed to a single line — expanding shows the full
// EJSON via the read-only CodeMirror host below (§8.7's "truncation with a show-all affordance"
// maps onto that same expand action for a document already loaded in the page).
function previewLine(body: string): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}

const editingId = ref<string | null>(null);
const editDraft = ref('');

function startEdit(id: string, body: string): void {
  editingId.value = id;
  editDraft.value = body;
}

function cancelEdit(): void {
  editingId.value = null;
  editDraft.value = '';
}

async function commitEdit(): Promise<void> {
  const id = editingId.value;
  if (id === null) return;
  await saveDocumentEdit(props.tab.id, id, editDraft.value);
  editingId.value = null;
  editDraft.value = '';
}

function onRowContextMenu(e: MouseEvent, id: string, body: string): void {
  e.preventDefault();
  openContextMenu(
    e,
    documentMenu(props.tab.id, id, body, allIds.value, () => startEdit(id, body)),
  );
}

function onStop(): void {
  stop(props.tab.id);
}

function onExpandAll(): void {
  setAllExpanded(props.tab.id, allIds.value, true);
}

function onCollapseAll(): void {
  setAllExpanded(props.tab.id, allIds.value, false);
}

function onRowClick(i: number): void {
  selectRow(props.tab.id, i);
}

// Publishes the cell editor's target (cellSelection.ts's "P8/P10 publish into the same slot" —
// this is P8's). A clicked document publishes its full EJSON body rather than one field within
// it: DocumentView.vue already renders the whole body as one unit (the preview line, the expanded
// CodeMirror host), so the document itself is the natural grain to hand the cell editor, and it's
// the one place a truncated body's full 64 KB is worth seeing formatted. `column` is synthetic —
// a document has no ColumnDescriptor of its own — built with `typeClass: 'json'` so the cell
// editor's format detector opens it pretty-printed by default, and `isPrimaryKey: true` since
// `_id` is exactly that.
watch(
  [() => rt.value?.selectedRow, () => pageVersion.n, () => props.tab.id],
  () => {
    const row = rt.value?.selectedRow;
    const doc = row === null || row === undefined ? null : rowAt(row);
    if (row === null || row === undefined || !doc) {
      publishSelectedCell(null);
      return;
    }
    const column: ColumnDescriptor = {
      name: 'document',
      dataType: 'document',
      typeClass: 'json',
      nullable: false,
      isPrimaryKey: true,
    };
    publishSelectedCell({
      tabId: props.tab.id,
      connectionId: props.tab.connectionId,
      path: props.tab.path,
      columnIndex: 0,
      column,
      row,
      value: doc.body,
      truncated: doc.isTruncated,
      hasPrimaryKey: true,
    });
  },
  { immediate: true },
);

let unregisterCommand: (() => void) | null = null;

onMounted(() => {
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  unregisterCommand = registerCommand('view.refresh', () => void reload(props.tab.id));
});

// The tab-id guard inside clearSelectedCellFor is load-bearing here too (DataGrid.vue's own
// note): MainView.vue keys DocumentView by tab id, so switching tabs unmounts one document view
// and mounts another in an order this can't rely on.
onUnmounted(() => {
  unregisterCommand?.();
  clearSelectedCellFor(props.tab.id);
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
            :size="12"
            title="First page"
            data-testid="document-pager-first"
            :disabled="tab.state.pageIndex === 0"
            @click="goFirst(tab.id)"
          />
          <IconButton
            icon="arrow-left"
            :size="13"
            data-testid="document-prev"
            :disabled="tab.state.pageIndex === 0"
            title="Previous page"
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
            :size="13"
            data-testid="document-next"
            :disabled="!rt?.hasMore"
            title="Next page"
            @click="goNext(tab.id)"
          />
          <IconButton
            icon="chevron-right"
            :size="12"
            :title="pageCount ? 'Last page' : 'Count documents first'"
            data-testid="document-pager-last"
            :disabled="!pageCount"
            @click="goLast(tab.id)"
          />
        </div>
        <div class="sep"></div>
        <!-- Left as the hand-rolled .p-seg group, same as DataToolbar.vue's own page-size picker
             (and for the same reason — tests assert `active` directly on these buttons). -->
        <div class="p-seg" data-testid="document-page-size-picker">
          <button
            v-for="size in PAGE_SIZES"
            :key="size"
            type="button"
            :class="{ active: tab.state.pageSize === size }"
            :data-testid="`document-page-size-${size}`"
            @click="onPageSize(size)"
          >
            {{ PAGE_SIZE_LABEL[size] }}
          </button>
        </div>
        <div class="sep"></div>
        <!-- DataToolbar's [count, columns, preview] group — this collection's equivalents are
             the exact count, the fields/projection menu, and expand/collapse-all. -->
        <div class="group">
          <IconButton
            icon="symbol-number"
            data-testid="document-count"
            title="Run an exact countDocuments() — the estimate above is metadata"
            @click="runCount(tab.id)"
          />
          <div class="projection-anchor">
            <IconButton
              icon="list-selection"
              data-testid="document-toolbar-projection"
              :title="projectionCountLabel ? `Fields — ${projectionCountLabel} shown` : 'Fields'"
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
            :size="13"
            title="Expand all"
            data-testid="document-expand-all"
            @click="onExpandAll"
          />
          <IconButton
            icon="collapse-all"
            :size="13"
            title="Collapse all"
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
            :size="13"
            data-testid="document-add"
            :disabled="!caps?.canInsert"
            :title="caps?.canInsert ? 'Add a document' : 'Connection does not support insert'"
            @click="onAddDocument"
          />
          <IconButton
            icon="search"
            :active="rt?.searchOpen"
            title="Search this page"
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
            title="Saved &amp; recent filters"
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
          <IdentifierField
            v-model="searchText"
            placeholder="Filter (e.g. { name: 'a' })"
            data-testid="document-search"
            :candidates="filterCandidates"
            @enter="onSearchInput"
            @blur="onSearchInput"
          />
        </div>
        <div class="sort-field">
          <IdentifierField
            v-model="sortText"
            prefix="SORT"
            placeholder="{ createdAt: -1, name: 1 }"
            title="Mongo sort document: 1 = ascending, -1 = descending"
            data-testid="document-sort"
            :candidates="sortCandidates"
            @enter="onSortInput"
            @blur="onSortInput"
          />
        </div>
        <Button title="Empty both fields and refetch" data-testid="document-filter-clear" @click="onClearFilter">
          Clear
        </Button>
      </template>

      <template #strips>
        <Strip v-if="rt?.status === 'error' && rt.error" tone="err" data-testid="document-error">
          {{ rt.error.message }}
        </Strip>
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
        <CodeMirrorHost v-model:doc="newDraft" language="json" :read-only="false" />
        <div class="edit-actions">
          <Button variant="primary" data-testid="document-new-save" @click="commitCreate">
            Save
          </Button>
          <Button data-testid="document-new-cancel" @click="cancelCreate"> Cancel </Button>
        </div>
      </div>

      <div ref="listBodyRef" class="list-body" data-testid="document-list">
        <EmptyState v-if="!rt || rt.rowCount === 0" :label="rt ? 'No documents' : ''" />
        <template v-else>
          <div
            v-for="i in rowIndices"
            :key="rowAt(i)?.id ?? i"
            class="doc-row"
            :class="{ open: isExpanded(rowAt(i)?.id ?? ''), selected: rt?.selectedRow === i }"
            data-testid="document-row"
            :data-id="rowAt(i)?.id"
            @contextmenu="rowAt(i) && onRowContextMenu($event, rowAt(i)!.id, rowAt(i)!.body)"
          >
            <!-- Publishes the whole document to the cell editor (see the `watch` above). The
                 expand toggle and Edit button below are nested inside this same click target —
                 clicking either also reselects the row, which is harmless (selecting the row you
                 just expanded/started editing is never wrong) so there is no need to stop
                 propagation out of either. -->
            <div class="doc-head" @click="onRowClick(i)">
              <button
                type="button"
                class="expand-toggle"
                data-testid="document-toggle-expand"
                :aria-label="isExpanded(rowAt(i)?.id ?? '') ? 'Collapse' : 'Expand'"
                @click="rowAt(i) && toggleExpanded(tab.id, rowAt(i)!.id)"
              >
                <Codicon
                  :name="isExpanded(rowAt(i)?.id ?? '') ? 'chevron-down' : 'chevron-right'"
                  :size="13"
                />
              </button>
              <span class="doc-id" data-testid="document-id">{{ rowAt(i)?.id }}</span>
              <span class="doc-preview">{{ previewLine(rowAt(i)?.body ?? '') }}</span>
              <div class="doc-row-actions">
                <span v-if="editingId === rowAt(i)?.id" class="p-chip warn">editing</span>
                <IconButton
                  icon="edit"
                  :size="12"
                  :active="editingId === rowAt(i)?.id"
                  data-testid="document-edit"
                  title="Edit"
                  @click="rowAt(i) && startEdit(rowAt(i)!.id, rowAt(i)!.body)"
                />
              </div>
            </div>
            <!-- The editor is the same code surface DDL and the console views use — the only
                 difference is the language. -->
            <div v-if="isExpanded(rowAt(i)?.id ?? '')" class="doc-body" data-testid="document-body">
              <template v-if="editingId === rowAt(i)?.id">
                <CodeMirrorHost v-model:doc="editDraft" language="json" :read-only="false" />
                <div class="edit-actions">
                  <Button
                    variant="primary"
                    data-testid="document-edit-save"
                    @click="commitEdit"
                  >
                    Save
                  </Button>
                  <Button
                    data-testid="document-edit-cancel"
                    @click="cancelEdit"
                  >
                    Cancel
                  </Button>
                </div>
              </template>
              <CodeMirrorHost
                v-else
                :doc="rowAt(i)?.body ?? ''"
                language="json"
                :read-only="true"
              />
              <span
                v-if="rowAt(i)?.isTruncated"
                class="p-badge truncated-marker"
                title="value truncated"
                >truncated</span
              >
            </div>
          </div>
        </template>
      </div>
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

/* .p-seg's own primitive only paints `.on` (see primitives.css) — kept as `active` because
   tests/ui assert on it directly (DataToolbar.vue's identical page-size picker and its own
   comment on why this stays hand-rolled rather than <Segmented>). */
.p-seg > button.active {
  background: var(--kira-bg-input);
  color: var(--kira-fg);
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

.doc-row {
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.doc-head {
  height: var(--kira-h-md);
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

.doc-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--kira-font-family);
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-muted);
}

.doc-row-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.doc-body {
  height: 220px;
  border-top: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-elevated);
  display: flex;
  flex-direction: column;
}

.edit-actions {
  flex-shrink: 0;
  display: flex;
  gap: var(--kira-s-3);
  padding: var(--kira-s-2) var(--kira-s-4);
  border-top: var(--kira-border-width) solid var(--kira-border);
}

.truncated-marker {
  flex-shrink: 0;
  align-self: flex-start;
  margin: var(--kira-s-2) var(--kira-s-4);
}
</style>
