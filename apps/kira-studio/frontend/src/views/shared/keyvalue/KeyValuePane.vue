<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { registerCommand } from '../../../shortcuts/commands';
import { clearSelectedCellFor } from '../../../state/cellSelection';
import { openContextMenu } from '../../../state/contextMenu';
import { settingsState } from '../../../state/settings';
import AppButton from '../../../theme/primitives/AppButton.vue';
import EmptyState from '../../../theme/primitives/EmptyState.vue';
import ReconnectGate from '../../../theme/primitives/ReconnectGate.vue';
import VirtualList from '../../../theme/primitives/VirtualList.vue';
import { datasetNumber } from '../eventCoords';
import SearchToolbar from '../page/SearchToolbar.vue';
import { createMatchIndex } from '../page/search';
import { setSearchFiltering } from '../page/searchFilter';
import { setVisibleRows } from '../page/visibleRows';
import { refreshOrReconnect, useConnectionGate } from '../useConnectionGate';
import { keyValueHost } from './host';
import { rowMenu } from './menu';
import { getPage, keyValueRow, pageVersion, setVisibleWindow } from './page';
import {
  canDelete,
  canDownload,
  canUpdate,
  objectEditGate,
  onDeleteKey,
  onDownload,
  onRowClick,
  openEdit,
} from './pane';
import { type Match, matchedRows, pageSearchApi, searchState } from './search';
import { load, reload, runtime, setSearchOpen } from './state';

// P63 §2.2: the extracted "body" from KeyValueView.vue — the row table (search/virtual list/
// context menu, the cell-editor selection wiring) that both a real KeyValue tab (via
// KeyValueView.vue, wrapping this in ViewChrome) and the browse split's own value pane (via
// BrowseView.vue's `.detail-pane`) render identically. Badges/toolbar/strips are NOT here — they
// stay authored at each host's own call site (KeyValueView.vue's ViewChrome slots must keep
// byte-identical DOM for the existing tab; the split pane gets its own, differently-shaped header
// band) — see docs/v1.6/plans/P63-browse-split-and-redis-types.md §2.2 for why.
const props = withDefaults(
  defineProps<{
    viewKey: string;
    /** True for a real KeyValue tab (KeyValueView.vue): the reconnect-gate/hydration dance and
     *  the view.refresh/view.find shortcuts behave exactly as before. False for the browse
     *  split's preview: the browse tab's own ReconnectGate already covers connectivity (this
     *  pane's connection is the same one), and the view-level shortcuts belong to the browse
     *  list, not to whichever key happens to be selected — so both are skipped here, and loading
     *  is instead driven by the selected key's path changing rather than by mount+reconnect. */
    standalone?: boolean;
  }>(),
  { standalone: true },
);

const { needsReconnect, onReconnectAndLoad } = useConnectionGate(
  () => ({ id: props.viewKey, connectionId: keyValueHost(props.viewKey)?.connectionId ?? null }),
  () => load(props.viewKey),
);

const rt = computed(() => runtime[props.viewKey]);

const page = computed(() => {
  void pageVersion.n;
  return getPage(props.viewKey);
});

// P31 D17/D18: the same "hide non-matching rows" toggle grid/documents/stream share (P24 D2) —
// filtered rows keep their real row number (the `i + 1` gutter below), same as those views.
const displayRows = computed<number[] | null>(() => matchedRows(props.viewKey));
const rowIndices = computed(() => {
  void pageVersion.n;
  if (displayRows.value) return displayRows.value;
  return Array.from({ length: rt.value?.rowCount ?? 0 }, (_, i) => i);
});

function rowAt(i: number) {
  void pageVersion.n;
  return keyValueRow(props.viewKey, i);
}

// P49 F7/D5: matches the density this row's own CSS (`--kira-row-height`) already resolves to —
// VirtualList needs the pixel value in JS for its offset math, the CSS var alone isn't reachable
// from there.
const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

// A reload (a Save, a manual Refresh, a relaunch, a newly selected key in the split) means the
// row a staged S3 draft was against no longer necessarily matches what's on screen — dropped here
// rather than left as a stale draft a later Save could silently commit over newer data. P43 iter2
// F20/D27: the cell editor's own published cell is the same case — a row index into a page that
// no longer exists identifies nothing, so it's cleared here too.
watch(page, () => {
  const runtimeEntry = runtime[props.viewKey];
  if (runtimeEntry) {
    runtimeEntry.objectDraft = null;
    runtimeEntry.objectSaveError = null;
  }
  clearSelectedCellFor(props.viewKey);
});

function onRowContextMenu(e: MouseEvent, field: string, value: string): void {
  e.preventDefault();
  const p = page.value;
  if (!p) return;
  const isObject = p.redisType === 'object';
  const gate = objectEditGate(props.viewKey);
  openContextMenu(
    e,
    rowMenu({
      field,
      value,
      redisType: p.redisType,
      canUpdate: canUpdate(props.viewKey),
      canDelete: canDelete(props.viewKey),
      canDownload: canDownload(props.viewKey),
      editable: isObject ? gate.editable : p.redisType === 'string',
      editUnavailableLabel: isObject ? gate.reason : 'Edit value (string keys only)',
      onEdit: () => openEdit(props.viewKey),
      onDelete: () => void onDeleteKey(props.viewKey),
      onDownload: () => void onDownload(props.viewKey),
    }),
  );
}

// §11's cell-editor seam: clicking a row previews its value read-only in the cell editor panel,
// regardless of type — see pane.ts's onRowClick for the rest of the reasoning.
function onRowClickHandler(i: number): void {
  onRowClick(props.viewKey, i);
}

// P2 R2 (task #98): `@click="onRowClick(i)"` closes over the v-for's `i`, so Vue's compiler can
// never cache the handler (hasScopeRef) — every row gets a fresh closure on every render, scroll
// included. These recover `i` from `data-row` on the element the event actually fired on instead,
// so the template can bind these two stable, module-scope functions directly.
function onRowClickFromEvent(e: MouseEvent): void {
  const i = datasetNumber(e.currentTarget, 'row');
  if (i !== null) onRowClickHandler(i);
}
function onRowContextMenuFromEvent(e: MouseEvent): void {
  const i = datasetNumber(e.currentTarget, 'row');
  if (i === null) return;
  const row = rowAt(i);
  if (row) onRowContextMenu(e, row.field, row.value);
}

function onCloseSearch(): void {
  setSearchOpen(props.viewKey, false);
}

// P49 F7/D5: rowIndices is the *filtered* array when the filter toggle is on, so a match's page-row
// number has to be looked up by position rather than assumed to equal it.
const listRef = ref<{ scrollToIndex: (index: number) => void } | null>(null);
function onGoToMatch(match: Match): void {
  const index = rowIndices.value.indexOf(match.row);
  if (index >= 0) listRef.value?.scrollToIndex(index);
}

// P49 F7/D5: closes the hole keyvalue/search.ts's own runSearch doc comment named — until this
// view virtualized its rows, nothing ever reported a visible window, so a find's priority scan
// always started from row 0 with no on-screen rows to prioritize first.
function onVisibleRangeIndices(range: { start: number; end: number }): void {
  const list = rowIndices.value;
  const from = list[range.start];
  const to = list[Math.max(range.start, range.end - 1)];
  if (from === undefined || to === undefined) return;
  setVisibleRows(props.viewKey, from, to + 1);
  setVisibleWindow(props.viewKey, from, to + 1);
}

// Rebuilt only when the search result changes (a completed scan or prev/next), not per row.
const matchIndex = createMatchIndex(searchState, () => props.viewKey);
function isSearchMatch(row: number, col: 'field' | 'value'): boolean {
  return matchIndex.value?.has(row, col) ?? false;
}
function isCurrentSearchMatch(row: number, col: 'field' | 'value'): boolean {
  return matchIndex.value?.isCurrent(row, col) ?? false;
}

let unregisterCommand: (() => void) | null = null;
let unregisterFindCommand: (() => void) | null = null;

onMounted(() => {
  if (props.standalone) {
    if (!needsReconnect.value && !runtime[props.viewKey]) void load(props.viewKey);
    // Item 4 (regression pass, task batch P46-4): route through the same gate-aware onRefresh the
    // toolbar button uses — this used to call reload() directly, a doomed no-op behind the gate.
    unregisterCommand = registerCommand('view.refresh', () =>
      refreshOrReconnect(needsReconnect.value, onReconnectAndLoad, () => reload(props.viewKey)),
    );
    unregisterFindCommand = registerCommand('view.find', () => setSearchOpen(props.viewKey, true));
  }
});

// Non-standalone (the browse split's own preview): reload whenever the underlying path changes —
// covers both the very first selection (this fires immediately on setup) and every later one,
// since the component itself stays mounted across a selection change (only what its viewKey's
// host resolves to changes).
watch(
  () => keyValueHost(props.viewKey)?.path ?? null,
  (path, oldPath) => {
    if (!props.standalone && path !== null && path !== oldPath) void load(props.viewKey);
  },
  { immediate: true },
);

onUnmounted(() => {
  unregisterCommand?.();
  unregisterFindCommand?.();
});
</script>

<template>
  <ReconnectGate
    v-if="standalone && needsReconnect"
    container-testid="keyvalue-reconnect"
    button-testid="keyvalue-reconnect-load"
    @reconnect="onReconnectAndLoad"
  />
  <template v-else>
    <SearchToolbar
      v-if="rt?.searchOpen"
      :tab-id="viewKey"
      testid-prefix="keyvalue-"
      row-noun="rows"
      :api="pageSearchApi"
      @go-to-match="onGoToMatch"
      @close="onCloseSearch"
    />

    <div class="p-panel table-panel">
      <div class="p-thead">
        <div class="p-th gutter kv-col-gutter"></div>
        <div class="p-th kv-col-field">
          <span class="name">{{
            page?.redisType === 'string' ? '' : page?.redisType === 'list' ? 'index' : 'field'
          }}</span>
        </div>
        <div class="p-th kv-col-value">
          <span class="name">{{ page?.redisType === 'zset' ? 'score' : 'value' }}</span>
        </div>
      </div>
      <div class="tbody" data-testid="keyvalue-list">
        <EmptyState
          v-if="!rt || rt.rowCount === 0"
          :icon="rt ? 'database' : 'loading'"
          :label="rt ? 'No data' : 'Loading…'"
        />
        <!-- P31 D19 (P24 D8's precedent): filtering to zero matches is a distinct empty state
             from "no data loaded". -->
        <EmptyState
          v-else-if="displayRows && displayRows.length === 0"
          icon="search"
          label="No matching rows"
          data-testid="keyvalue-no-matching-rows"
        >
          <AppButton data-testid="keyvalue-show-all-rows" @click="setSearchFiltering(viewKey, false)">
            Show all rows
          </AppButton>
        </EmptyState>
        <VirtualList
          v-else
          ref="listRef"
          :items="rowIndices"
          :row-height="rowHeight"
          @visible-range="onVisibleRangeIndices"
        >
          <template #default="{ item: i }">
            <div
              class="kv-row"
              data-testid="keyvalue-row"
              :data-row="i"
              @click="onRowClickFromEvent"
              @contextmenu="onRowContextMenuFromEvent"
            >
              <div class="p-td gutter kv-col-gutter">{{ i + 1 }}</div>
              <div
                class="p-td kv-col-field"
                :class="{
                  'search-match': isSearchMatch(i, 'field'),
                  'search-match-current': isCurrentSearchMatch(i, 'field'),
                }"
                v-tooltip="rowAt(i)?.field"
                data-testid="keyvalue-field"
              >
                {{ rowAt(i)?.field }}
              </div>
              <div
                class="p-td kv-col-value"
                :class="{
                  'search-match': isSearchMatch(i, 'value'),
                  'search-match-current': isCurrentSearchMatch(i, 'value'),
                }"
                v-tooltip="rowAt(i)?.value"
                data-testid="keyvalue-value"
              >
                {{ rowAt(i)?.value }}
                <span v-if="rowAt(i)?.isTruncated" class="p-chip truncated-chip" v-tooltip="'value truncated'"
                  >truncated</span
                >
              </div>
            </div>
          </template>
        </VirtualList>
      </div>
    </div>
  </template>
</template>

<style scoped>
.table-panel {
  flex: 1;
  min-height: 0;
  border: none;
  border-radius: 0;
}

.tbody {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* P49 D5: VirtualList owns scrolling internally now (its own `.virtual-list { overflow: auto }`,
     height:100% against this flex:1/min-height:0 parent) — EmptyState's two branches above never
     needed to scroll either. */
  overflow: hidden;
}

.kv-col-gutter {
  width: 40px;
  flex-shrink: 0;
}

.kv-col-field {
  width: 220px;
  flex-shrink: 0;
}

.kv-col-value {
  flex: 1;
  min-width: 0;
}

.kv-row {
  height: var(--kira-row-height);
  display: flex;
  cursor: pointer;
}

.kv-row:hover {
  background: var(--kira-hover);
}

.truncated-chip {
  margin-left: var(--kira-s-3);
  flex-shrink: 0;
  background: var(--kira-bg-input);
  color: var(--kira-fg-subtle);
}

.search-match {
  background: var(--kira-search-match);
}

.search-match-current {
  background: var(--kira-search-match-current);
  color: var(--kira-bg);
}
</style>
