<script setup lang="ts">
import type { SortSpec } from '@shared/domain/queries';
import type { DocumentTabRecord, DocumentTabState } from '@shared/domain/tabs';
import { decodePath, pathTail } from '@shared/domain/tree';
import type { ColumnDescriptor } from '@shared/protocol/page';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
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
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import Strip from '../../theme/primitives/Strip.vue';
import TextField from '../../theme/primitives/TextField.vue';
import ViewChrome from '../../workbench/panels/ViewChrome.vue';
import { openContextMenu } from '../../workbench/state/contextMenu';
import DocumentSearchToolbar from './DocumentSearchToolbar.vue';
import { documentRow, fieldNamesOnPage, isIdNull, pageVersion } from './docPage';
import { documentMenu } from './documentMenu';
import { saveDocumentEdit, saveNewDocument } from './documentMutations';
import ProjectionMenu from './ProjectionMenu.vue';
import {
  goNext,
  goPrev,
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
}

// The Mongo dialect of FilterToolbar.vue's ORDER BY box: unlike SQL's free-text sort, Mongo's
// read.ts explicitly rejects a `{kind:'text'}` sort (a free-text expression has no server-side
// meaning here) — so this box parses straight into the structured form itself, never the text
// variant, mirroring how clicking a grid column header builds structured terms.
const sortText = ref(sortSpecToText(props.tab.state.sort));

function sortSpecToText(sort: SortSpec | null): string {
  if (sort?.kind !== 'structured') return '';
  return sort.terms.map((t) => `${t.column} ${t.direction.toUpperCase()}`).join(', ');
}

function parseSortText(text: string): SortSpec | null {
  const terms = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const [column, dirRaw] = part.split(/\s+/);
      const direction: 'asc' | 'desc' = dirRaw?.toLowerCase() === 'desc' ? 'desc' : 'asc';
      return { column, direction };
    })
    .filter((t) => t.column !== '');
  return terms.length > 0 ? { kind: 'structured', terms } : null;
}

function onSortInput(): void {
  setSort(props.tab.id, parseSortText(sortText.value));
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
        <div class="group">
          <IconButton
            icon="arrow-left"
            :size="13"
            data-testid="document-prev"
            :disabled="!rt?.prevToken"
            title="Previous page"
            @click="goPrev(tab.id)"
          />
          <span class="mono p-sm">{{ rt?.rowCount ?? 0 }} loaded</span>
          <template v-if="rt?.count">
            <span class="p-sm dim">of</span>
            <span class="mono p-sm muted"
              >{{ rt.count.exact ? '' : '≈ ' }}{{ rt.count.value.toLocaleString() }}</span
            >
          </template>
          <IconButton
            icon="arrow-right"
            :size="13"
            data-testid="document-next"
            :disabled="!rt?.hasMore"
            title="Next page"
            @click="goNext(tab.id)"
          />
          <Button
            icon="symbol-number"
            data-testid="document-count"
            title="Run an exact countDocuments() — the estimate above is metadata"
            @click="runCount(tab.id)"
          >Exact count</Button>
        </div>
        <div class="sep"></div>
        <div class="group">
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
        <div class="group">
          <IconButton
            icon="add"
            :size="13"
            data-testid="document-add"
            :disabled="!caps?.canInsert"
            :title="caps?.canInsert ? 'Add a document' : 'Connection does not support insert'"
            @click="onAddDocument"
          />
          <div class="projection-anchor">
            <IconButton
              icon="list-selection"
              data-testid="document-toolbar-projection"
              :count="projectionCountLabel ?? undefined"
              title="Fields"
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
           can actually execute. -->
      <template #toolbar-2>
        <div class="filter-field">
          <TextField
            v-model="searchText"
            placeholder="Filter (e.g. { name: 'a' })"
            data-testid="document-search"
            @keyup.enter="onSearchInput"
            @blur="onSearchInput"
          />
        </div>
        <div class="sort-field">
          <TextField
            v-model="sortText"
            prefix="SORT"
            placeholder="name ASC, price DESC"
            data-testid="document-sort"
            @keyup.enter="onSortInput"
            @blur="onSortInput"
          />
        </div>
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
.filter-field {
  flex: 1;
  min-width: 0;
}

.filter-field :deep(.p-input) {
  width: 100%;
}

/* FilterToolbar.vue's orderby-input precedent: a fixed width beside the filter field that grows
   to fill, same TextField inheritAttrs:false reasoning as `.filter-field` above. */
.sort-field {
  width: 230px;
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
