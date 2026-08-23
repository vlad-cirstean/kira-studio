<script setup lang="ts">
import type { PageSize, StreamTabRecord } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { registerCommand } from '../../shortcuts/commands';
import { publishSelectedCell, type SelectedCell } from '../../state/cellSelection';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import { cellClass } from '../../theme/cellClass';
import { connColorVar } from '../../theme/connColor';
import Button from '../../theme/primitives/Button.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import Strip from '../../theme/primitives/Strip.vue';
import TextField from '../../theme/primitives/TextField.vue';
import ViewChrome from '../../workbench/panels/ViewChrome.vue';
import { openContextMenu } from '../../workbench/state/contextMenu';
import StreamComposeMessage from './StreamComposeMessage.vue';
import StreamFilterHistoryMenu from './StreamFilterHistoryMenu.vue';
import StreamSearchToolbar from './StreamSearchToolbar.vue';
import {
  applyStreamFilter,
  goNext,
  load,
  poll,
  reload,
  runCount,
  runtime,
  selectRow,
  setPageSize,
  stop,
} from './state';
import { streamMenu } from './streamMenu';
import { deleteSqsMessage } from './streamMutations';
import { getPage, pageVersion, streamRow } from './streamPage';
import { streamSearchState } from './streamSearch';

// MainView.vue keys this component by tab.id — same discipline as KeyValueView.vue.
const props = defineProps<{ tab: StreamTabRecord }>();

const connectionStatus = computed(() =>
  props.tab.connectionId
    ? (connectionsState.states[props.tab.connectionId]?.status ?? 'disconnected')
    : 'disconnected',
);

const needsReconnect = computed(
  () => !isHydrated(props.tab.id) || connectionStatus.value !== 'connected',
);

const caps = computed(() => {
  const connectionId = props.tab.connectionId;
  return connectionId ? (connectionsState.states[connectionId]?.caps ?? null) : null;
});

// P16 design system LAW: connection colour is a 2px rail — here capping the toolbar and as a
// dot in the view header — never a background tint. Mirrors Toolbar.vue's `color`/`railStyle`
// pair exactly. No colour assigned leaves `--kira-rail` unset, so the reserved slot stays blank
// instead of shifting anything.
const connectionRecord = computed(() =>
  props.tab.connectionId
    ? connectionsState.records.find((r) => r.id === props.tab.connectionId)
    : undefined,
);
const iconColor = computed(
  () => connColorVar(connectionRecord.value?.color) ?? 'var(--kira-fg-muted)',
);

const pathPrefix = computed(() =>
  connectionRecord.value ? `${connectionRecord.value.name} / ` : '',
);

// D10/D12: SQS's 'batch' pagination is never auto-loaded — the user must click Poll, because
// every poll consumes messages from the queue (subject to VisibilityTimeout) rather than
// merely browsing them. Kafka's 'offsetWindow' strategy is a pure browse and auto-loads like
// every other read-only view.
const isBatch = computed(() => caps.value?.pagination === 'batch');
// Item 2/3/4: Kafka gets the offset/partition/timestamp filter row and Add-message (no Delete —
// a topic's log is immutable, kafkaCaps.canDelete stays false permanently). SQS gets Add and
// Delete but no filter row at all (queue-based, no topic/partition/offset concept to filter by).
const isKafka = computed(() => connectionRecord.value?.kind === 'kafka');
const isSqs = computed(() => connectionRecord.value?.kind === 'sqs');
const canInsert = computed(() => caps.value?.canInsert ?? false);
const canDelete = computed(() => caps.value?.canDelete ?? false);

async function onReconnectAndLoad(): Promise<void> {
  if (!props.tab.connectionId) return;
  if (connectionStatus.value !== 'connected') {
    await connectConnection(props.tab.connectionId);
  }
  markHydrated(props.tab.id);
  if (!isBatch.value) await load(props.tab.id);
}

const rt = computed(() => runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'loading');

const targetTail = computed(() => pathTail(props.tab.path));

const page = computed(() => {
  void pageVersion.n;
  return getPage(props.tab.id);
});

const rowIndices = computed(() => {
  void pageVersion.n;
  return Array.from({ length: rt.value?.rowCount ?? 0 }, (_, i) => i);
});

function rowAt(i: number) {
  void pageVersion.n;
  return streamRow(props.tab.id, i);
}

function onRowContextMenu(e: MouseEvent, key: string | null, body: string): void {
  e.preventDefault();
  openContextMenu(e, streamMenu(key, body));
}

// Item 6: publishes into cellSelection.ts's shared slot (the same one DataGrid.vue uses) so
// CellEditorView.vue can show the clicked row's body, read-only — a synthetic single-column
// ColumnDescriptor stands in for the grid's real per-table columns, since a stream row has no
// catalog-described schema at all (§8.9 has no column navigation for streams).
function onRowClick(i: number): void {
  selectRow(props.tab.id, i);
  const row = rowAt(i);
  if (!row) {
    publishSelectedCell(null);
    return;
  }
  const selected: SelectedCell = {
    tabId: props.tab.id,
    connectionId: props.tab.connectionId,
    path: props.tab.path,
    columnIndex: 0,
    column: {
      name: 'body',
      dataType: 'text',
      typeClass: 'text',
      nullable: false,
      isPrimaryKey: false,
    },
    row: i,
    value: row.body,
    truncated: row.isTruncated,
    // Always true here (unlike the grid's real per-table computation, state.ts's own doc comment)
    // — "no primary key" would misleadingly suggest the grid's editability story applies to a
    // stream row at all, when this panel is read-only for every row regardless (CellEditorView.vue
    // always renders CodeMirrorHost with `:read-only="true"`).
    hasPrimaryKey: true,
  };
  publishSelectedCell(selected);
}

function onStop(): void {
  stop(props.tab.id);
}

function onPoll(): void {
  void poll(props.tab.id);
}

const statusLine = computed(() => {
  const r = rt.value;
  if (!r) return '';
  const parts: string[] = [];
  parts.push(`${r.rowCount} row${r.rowCount === 1 ? '' : 's'} on this page`);
  if (r.count) {
    parts.push(`${r.count.exact ? '' : '~'}${r.count.value.toLocaleString()} total`);
  }
  return parts.join(' · ');
});

// Item 1: kept as the hand-rolled .p-seg group rather than a shared component — grid/
// DataToolbar.vue's own comment explains why (tests assert `active` directly on these buttons).
const PAGE_SIZES: PageSize[] = [10, 100, 1000, 10000];
const PAGE_SIZE_LABEL: Record<PageSize, string> = {
  10: '10',
  100: '100',
  1000: '1k',
  10000: '10k',
};
function onPageSize(size: PageSize): void {
  void setPageSize(props.tab.id, size);
}

// Item 2's filter row (Kafka only) — local text buffers mirror FilterToolbar.vue's own
// whereText/orderByText pattern (a plain string an <input> can bind to; `null` only exists in
// the persisted/wire shapes). MainView.vue keys this whole component by tab.id, so a plain
// initializer (no watcher) already covers "just opened" and "tab changed" — same reasoning
// FilterToolbar.vue's own comment gives for needing `immediate: true` where it does have a watch
// (that component isn't remounted per tab; this one is).
const offsetText = ref(props.tab.state.offsetFilter ?? '');
const partitionText = ref(props.tab.state.partitionFilter ?? '');
const timestampText = ref(props.tab.state.timestampFilter ?? '');

function currentFilterInput(): {
  offset: string | null;
  partition: string | null;
  timestamp: string | null;
} {
  return {
    offset: offsetText.value.trim() === '' ? null : offsetText.value.trim(),
    partition: partitionText.value.trim() === '' ? null : partitionText.value.trim(),
    timestamp: timestampText.value.trim() === '' ? null : timestampText.value.trim(),
  };
}

async function onApplyFilter(): Promise<void> {
  await applyStreamFilter(props.tab.id, currentFilterInput());
}

async function onClearFilter(): Promise<void> {
  offsetText.value = '';
  partitionText.value = '';
  timestampText.value = '';
  await applyStreamFilter(props.tab.id, { offset: null, partition: null, timestamp: null });
}

function onApplyFromHistory(
  offset: string | null,
  partition: string | null,
  timestamp: string | null,
): void {
  offsetText.value = offset ?? '';
  partitionText.value = partition ?? '';
  timestampText.value = timestamp ?? '';
  void applyStreamFilter(props.tab.id, { offset, partition, timestamp });
}

const filterHistoryOpen = ref(false);

const hasSelectedRow = computed(
  () => rt.value?.selectedRow !== null && rt.value?.selectedRow !== undefined,
);

// Item 3/4: the Add-message panel — Kafka's produce vs. SQS's SendMessage differ only in which
// fields StreamComposeMessage.vue shows (its own `kind` prop switches the shape).
const composeOpen = ref(false);

// Item 4: SQS-only Delete, gated on canDelete and on a row actually being selected (item 6's
// click-to-select doubles as this button's target — there is no separate per-row delete
// affordance, since streamMenu.ts's context menu stays copy-only for every engine per P10's D13).
async function onDeleteMessage(): Promise<void> {
  const selectedRow = rt.value?.selectedRow;
  if (selectedRow === null || selectedRow === undefined) return;
  const row = rowAt(selectedRow);
  if (!row?.key) return;
  if (!window.confirm(`Delete this message (id: ${row.key})? This cannot be undone.`)) return;
  await deleteSqsMessage(props.tab.id, row.key);
}

// Item 5: toggles the client-side, current-page-only search bar (DataView.vue's same pattern).
function onToggleSearch(): void {
  const r = rt.value;
  if (r) r.searchOpen = !r.searchOpen;
}

const matchSet = computed(() => new Set(streamSearchState[props.tab.id]?.matches ?? []));
const currentMatchRow = computed(() => {
  const s = streamSearchState[props.tab.id];
  return s && s.index >= 0 ? (s.matches[s.index] ?? null) : null;
});

const scrollContainerRef = ref<HTMLDivElement | null>(null);
function onGoToMatch(row: number): void {
  scrollContainerRef.value
    ?.querySelector(`[data-row-index="${row}"]`)
    ?.scrollIntoView({ block: 'nearest' });
}
function onCloseSearch(): void {
  const r = rt.value;
  if (r) r.searchOpen = false;
}

let unregisterCommand: (() => void) | null = null;

onMounted(() => {
  if (!needsReconnect.value && !isBatch.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  unregisterCommand = registerCommand('view.refresh', () => void reload(props.tab.id));
});

onUnmounted(() => {
  unregisterCommand?.();
});
</script>

<template>
  <div class="stream-view" data-testid="stream-view" :data-path="tab.path">
    <ReconnectGate
      v-if="needsReconnect"
      icon="debug-disconnect"
      label="Not connected"
      container-testid="stream-reconnect"
      button-testid="stream-reconnect-load"
      @reconnect="onReconnectAndLoad"
    />
    <ViewChrome
      v-else
      :tab="tab"
      icon="broadcast"
      :icon-color="iconColor"
      :path="pathPrefix"
      :name="targetTail?.name ?? tab.path"
      name-testid="stream-target"
      refresh-testid="stream-refresh"
      stop-testid="stream-stop"
      :can-stop="running"
      @refresh="reload(tab.id)"
      @stop="onStop"
    >
      <template #head-trailing>
        <span
          v-if="page?.visibilityTimeoutSeconds !== null && page?.visibilityTimeoutSeconds !== undefined"
          class="p-badge"
          data-testid="stream-visibility-timeout"
        >
          visibility {{ page.visibilityTimeoutSeconds }}s
        </span>
      </template>

      <template #toolbar>
        <!-- Item 1: Count/Poll-or-Next and the page-size picker sit together as one group, kept
             in this same main toolbar (there is no separate DataToolbar-equivalent for streams). -->
        <div class="group">
          <IconButton
            icon="symbol-number"
            :size="13"
            data-testid="stream-count"
            title="Count"
            @click="runCount(tab.id)"
          />
          <Button
            v-if="isBatch"
            icon="arrow-swap"
            active
            data-testid="stream-poll"
            title="Poll for messages"
            @click="onPoll"
          >
            Poll
          </Button>
          <IconButton
            v-else
            icon="arrow-right"
            :size="13"
            data-testid="stream-next"
            :disabled="!rt?.hasMore"
            title="Next page"
            @click="goNext(tab.id)"
          />
        </div>

        <div class="p-seg" data-testid="stream-page-size-picker">
          <button
            v-for="size in PAGE_SIZES"
            :key="size"
            type="button"
            :class="{ active: tab.state.pageSize === size }"
            :data-testid="`stream-page-size-${size}`"
            @click="onPageSize(size)"
          >
            {{ PAGE_SIZE_LABEL[size] }}
          </button>
        </div>

        <div class="sep" />

        <div class="group">
          <IconButton
            v-if="canInsert"
            icon="add"
            :size="13"
            data-testid="stream-add-message"
            :title="isKafka ? 'Produce a message' : 'Send a message'"
            @click="composeOpen = !composeOpen"
          />
          <IconButton
            v-if="isSqs && canDelete"
            icon="trash"
            :size="13"
            data-testid="stream-delete-message"
            :disabled="!hasSelectedRow"
            :title="hasSelectedRow ? 'Delete the selected message' : 'Select a message first'"
            @click="onDeleteMessage"
          />
          <IconButton
            icon="search"
            :size="13"
            :active="rt?.searchOpen"
            title="Search this page"
            data-testid="stream-search-toggle"
            @click="onToggleSearch"
          />
        </div>
      </template>

      <template v-if="isKafka" #toolbar-2>
        <!-- Item 2: Kafka-only positioning filters — SQS shows none of this (no topic/partition/
             offset concept, per connection.kind above). Applies only to a *fresh* browse
             (state.ts's applyStreamFilter always restarts one); a token-continued page ignores it. -->
        <div class="history-anchor">
          <IconButton
            icon="history"
            title="Filter history"
            data-testid="stream-filter-history-button"
            @click="filterHistoryOpen = !filterHistoryOpen"
          />
          <StreamFilterHistoryMenu
            v-if="filterHistoryOpen"
            :tab-id="tab.id"
            @apply="onApplyFromHistory"
            @close="filterHistoryOpen = false"
          />
        </div>
        <div class="filter-field">
          <TextField
            v-model="offsetText"
            prefix="offset"
            placeholder="e.g. 1000"
            data-testid="stream-filter-offset"
            @enter="onApplyFilter"
            @blur="onApplyFilter"
          />
        </div>
        <div class="filter-field">
          <TextField
            v-model="partitionText"
            prefix="partition"
            placeholder="e.g. 0"
            data-testid="stream-filter-partition"
            @enter="onApplyFilter"
            @blur="onApplyFilter"
          />
        </div>
        <div class="filter-field">
          <TextField
            v-model="timestampText"
            prefix="since"
            placeholder="ISO timestamp"
            data-testid="stream-filter-timestamp"
            @enter="onApplyFilter"
            @blur="onApplyFilter"
          />
        </div>
        <Button data-testid="stream-filter-clear" title="Empty every field and refetch" @click="onClearFilter">
          Clear
        </Button>
      </template>

      <!-- The one destructive truth of this view, stated once at the top. -->
      <template #strips>
      <Strip v-if="isBatch" tone="warn" icon="warning" :icon-size="13" data-testid="stream-poll-warning">
        <span
          >Each poll <b>consumes</b> messages from the queue (subject to the visibility timeout
          above) — it does not browse a stable position.</span
        >
      </Strip>

      <Strip v-if="rt?.status === 'error' && rt.error" tone="err" icon="error" :icon-size="13" data-testid="stream-error">
        <span>{{ rt.error.message }}</span>
      </Strip>

      <StreamSearchToolbar
        v-if="rt?.searchOpen"
        :tab-id="tab.id"
        @go-to-match="onGoToMatch"
        @close="onCloseSearch"
      />
      </template>

      <div class="list-body" data-testid="stream-list">
        <EmptyState
          v-if="isBatch && !rt?.polled"
          class="no-rows"
          icon="arrow-swap"
          label="Click Poll to fetch messages"
        />
        <EmptyState
          v-else-if="!rt || rt.rowCount === 0"
          class="no-rows"
          icon="inbox"
          :label="rt ? 'No messages' : ''"
        />
        <template v-else>
          <div class="p-thead">
            <div class="p-th gutter" style="width: 40px" />
            <div class="p-th" style="width: 160px"><span class="name">key</span></div>
            <div class="p-th" style="width: 160px"><span class="name">timestamp</span></div>
            <div class="p-th" style="width: 140px"><span class="name">headers</span></div>
            <div class="p-th" style="width: 140px"><span class="name">attrs</span></div>
            <div class="p-th" style="flex: 1"><span class="name">body</span></div>
          </div>
          <div class="tbody-scroll" ref="scrollContainerRef">
            <div
              v-for="i in rowIndices"
              :key="i"
              class="stream-row"
              data-testid="stream-row"
              :data-row-index="i"
              :class="{
                selected: rt?.selectedRow === i,
                'search-match': matchSet.has(i),
                'search-match-current': currentMatchRow === i,
              }"
              @click="onRowClick(i)"
              @contextmenu="onRowContextMenu($event, rowAt(i)?.key ?? null, rowAt(i)?.body ?? '')"
            >
              <div class="p-td gutter" style="width: 40px">{{ i + 1 }}</div>
              <div
                class="p-td"
                :class="cellClass({ isNull: rowAt(i)?.key === null })"
                style="width: 160px"
                data-testid="stream-key"
              >
                {{ rowAt(i)?.key ?? '(none)' }}
              </div>
              <div class="p-td" style="width: 160px" data-testid="stream-timestamp">
                {{ rowAt(i)?.timestamp ?? '' }}
              </div>
              <div class="p-td" style="width: 140px" data-testid="stream-headers">
                {{ rowAt(i)?.headers }}
              </div>
              <div class="p-td" style="width: 140px" data-testid="stream-attrs">
                {{ rowAt(i)?.attrs }}
              </div>
              <div class="p-td msg-body" style="flex: 1" data-testid="stream-body">
                {{ rowAt(i)?.body }}
                <span v-if="rowAt(i)?.isTruncated" class="p-xs muted" title="body truncated"
                  >(truncated)</span
                >
              </div>
            </div>
          </div>
        </template>
      </div>

      <div class="status-line" data-testid="stream-status">{{ statusLine }}</div>
    </ViewChrome>

    <StreamComposeMessage
      v-if="composeOpen && (isKafka || isSqs)"
      :tab-id="tab.id"
      :kind="isKafka ? 'kafka' : 'sqs'"
      @close="composeOpen = false"
    />
  </div>
</template>

<style scoped>
.stream-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* view header: 28px, connection colour appears only as the dot (LAW — see template comment) */
.path {
  color: var(--kira-fg-disabled);
}

/* tabular body shared shape (P16's .thead/.th/.td law) — .p-thead/.p-th/.p-td come from
   primitives.css; the flex row container and the scrolling wrapper around it are local glue,
   same as the source design's own (unshared) .tbody/.tr rules. */
.tbody-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.stream-row {
  display: flex;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  cursor: pointer;
}

.stream-row:hover {
  background: var(--kira-hover);
}

.stream-row.selected {
  background: var(--kira-hover);
}

.stream-row.search-match {
  box-shadow: inset 2px 0 0 var(--kira-warn);
}

.stream-row.search-match-current {
  background: var(--kira-hover);
}

/* body column: monospace and slightly muted, matching the mockup's `.msg-body` */
.msg-body {
  font-family: var(--kira-font-family);
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-muted);
}

.list-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.list-body .p-empty {
  height: 100%;
}

.status-line {
  flex-shrink: 0;
  padding: 0 var(--kira-s-4);
  height: var(--kira-h-xs);
  display: flex;
  align-items: center;
  border-top: var(--kira-border-width) solid var(--kira-border);
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* .p-seg's own primitive only paints `.on` (see primitives.css) — the page-size control keeps
   the `active` class name because tests/ui assert on it directly (mirrors DataToolbar.vue). */
.p-seg > button.active {
  background: var(--kira-bg-input);
  color: var(--kira-fg);
}

.history-anchor {
  position: relative;
}

.filter-field {
  width: 160px;
  flex-shrink: 0;
}

.filter-field :deep(.p-input) {
  width: 100%;
}
</style>
