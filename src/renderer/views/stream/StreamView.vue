<script setup lang="ts">
import type { PageSize, StreamTabRecord } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { control } from '../../bridge/control';
import { registerCommand } from '../../shortcuts/commands';
import {
  clearSelectedCellFor,
  publishSelectedCell,
  type SelectedCell,
} from '../../state/cellSelection';
import { confirmDialog } from '../../state/confirmDialog';
import { connectionRecord, connectionsState } from '../../state/connections';
import { openContextMenu } from '../../state/contextMenu';
import { settingsState } from '../../state/settings';
import { patchStreamTabState } from '../../state/tabs';
import { cellClass } from '../../theme/cellClass';
import { connColorVar } from '../../theme/connColor';
import AppButton from '../../theme/primitives/AppButton.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import PopoverPanel from '../../theme/primitives/PopoverPanel.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import TextField from '../../theme/primitives/TextField.vue';
import ViewChrome from '../../theme/primitives/ViewChrome.vue';
import VirtualList from '../../theme/primitives/VirtualList.vue';
import CellEditorDock from '../shared/celleditor/CellEditorDock.vue';
import DateTimePicker from '../shared/DateTimePicker.vue';
import { setSearchFiltering } from '../shared/page/searchFilter';
import { pageSizeOptions } from '../shared/page/sizes';
import { refreshOrReconnect, useConnectionGate } from '../shared/useConnectionGate';
import { rowMenu } from './menu';
import { deleteSqsMessage } from './mutations';
import { getPage, pageVersion, streamRow } from './page';
import StreamComposeMessage from './StreamComposeMessage.vue';
import StreamFilterHistoryMenu from './StreamFilterHistoryMenu.vue';
import StreamSearchToolbar from './StreamSearchToolbar.vue';
import { matchedRows, searchState } from './search';
import {
  applyStreamFilter,
  goNext,
  load,
  poll,
  reload,
  runCount,
  runtime,
  selectRow,
  setActionError,
  setPageSize,
  setSearchOpen,
  stop,
  toggleSearchOpen,
} from './state';

// MainView.vue keys this component by tab.id — same discipline as KeyValueView.vue.
const props = defineProps<{ tab: StreamTabRecord }>();

const caps = computed(() => {
  const connectionId = props.tab.connectionId;
  return connectionId ? (connectionsState.states[connectionId]?.caps ?? null) : null;
});

// P16 design system LAW: connection colour is a 2px rail — here capping the toolbar and as a
// dot in the view header — never a background tint. Mirrors Toolbar.vue's `color`/`railStyle`
// pair exactly. No colour assigned leaves `--kira-rail` unset, so the reserved slot stays blank
// instead of shifting anything.
const connRecord = computed(() => connectionRecord(props.tab.connectionId));
const iconColor = computed(() => connColorVar(connRecord.value?.color) ?? 'var(--kira-fg-muted)');

const pathPrefix = computed(() => (connRecord.value ? `${connRecord.value.name} / ` : ''));

// D10/D12: SQS's 'batch' pagination is never auto-loaded — the user must click Poll, because
// every poll consumes messages from the queue (subject to VisibilityTimeout) rather than
// merely browsing them. Kafka's 'offsetWindow' strategy is a pure browse and auto-loads like
// every other read-only view.
const isBatch = computed(() => caps.value?.pagination === 'batch');
// Item 2/3/4: Kafka gets the offset/partition/timestamp filter row and Add-message (no Delete —
// a topic's log is immutable, kafkaCaps.canDelete stays false permanently). SQS gets Add and
// Delete but no filter row at all (queue-based, no topic/partition/offset concept to filter by).
const isKafka = computed(() => connRecord.value?.kind === 'kafka');
const isSqs = computed(() => connRecord.value?.kind === 'sqs');
const canInsert = computed(() => caps.value?.canInsert ?? false);
const canDelete = computed(() => caps.value?.canDelete ?? false);

// D10/D12: a batch tab (SQS) never auto-loads on reconnect — only an explicit Poll does,
// since every poll consumes from the queue rather than merely browsing it.
const { connectionStatus, needsReconnect, onReconnectAndLoad } = useConnectionGate(
  () => props.tab,
  () => {
    if (!isBatch.value) return load(props.tab.id);
  },
);

const rt = computed(() => runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'loading');

const targetTail = computed(() => pathTail(props.tab.path));

const page = computed(() => {
  void pageVersion.n;
  return getPage(props.tab.id);
});

// P31 D17/D18: the same "hide non-matching rows" toggle grid/keyvalue/documents share (P24 D2) —
// filtered rows keep their real row number (the `i + 1` gutter below), same as those views.
const displayRows = computed<number[] | null>(() => matchedRows(props.tab.id));
const rowIndices = computed(() => {
  void pageVersion.n;
  if (displayRows.value) return displayRows.value;
  return Array.from({ length: rt.value?.rowCount ?? 0 }, (_, i) => i);
});

function rowAt(i: number) {
  void pageVersion.n;
  return streamRow(props.tab.id, i);
}

// P49 F7/D5: `.stream-row` never had an explicit height before this view was virtualized — its
// rows sized themselves off whichever cell had text (`.p-td`'s own line-height), which is why
// `.stream-row`'s CSS rule below carries none — VirtualList needs one fixed pixel value for its
// offset math, so this adopts the same density-driven height DataGrid.vue/ConsoleResultGrid.vue/
// KeyValueView.vue already use rather than inventing a fourth number.
const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

function onRowContextMenu(e: MouseEvent, key: string | null, body: string): void {
  e.preventDefault();
  openContextMenu(e, rowMenu(key, body));
}

// Row click alone (gutter, empty row background) just selects the row for highlighting/delete-
// eligibility — it does not touch the cell editor. Publishing there is per-column, via
// onCellClick below.
function onRowClick(i: number): void {
  selectRow(props.tab.id, i);
}

// Item 6 (widened, task #75): publishes into cellSelection.ts's shared slot (the same one
// DataGrid.vue uses) so CellEditorView.vue can show whichever column of the clicked row was
// actually clicked, read-only — not just the body. A synthetic single-column ColumnDescriptor
// stands in for the grid's real per-table columns, since a stream row has no catalog-described
// schema at all (§8.9 has no column navigation for streams).
function onCellClick(i: number, name: string, value: string | null, truncated = false): void {
  selectRow(props.tab.id, i);
  const selected: SelectedCell = {
    tabId: props.tab.id,
    connectionId: props.tab.connectionId,
    path: props.tab.path,
    columnIndex: 0,
    column: {
      name,
      dataType: 'text',
      typeClass: 'text',
      nullable: value === null,
      isPrimaryKey: false,
      generated: false,
    },
    row: i,
    value,
    truncated,
    // Always true here (unlike the grid's real per-table computation, state.ts's own doc comment)
    // — "no primary key" would misleadingly suggest the grid's editability story applies to a
    // stream row at all, when this panel is a viewer for every row regardless (P43 F3/D4: the dock
    // mount below passes `:read-only="true"`, the same flag the console's own viewer mount uses).
    hasPrimaryKey: true,
  };
  publishSelectedCell(selected);
}

// P43 iter2 F20/D27: rt.selectedRow is already reset to null on every load (state.ts's own
// comment: "a fresh page invalidates whatever row index used to be selected") — the published
// cell is the other half of the same idea and was left out of it, so a Poll cleared the row
// highlight while the dock kept showing the previous batch's message body.
watch(
  () => pageVersion.n,
  () => clearSelectedCellFor(props.tab.id),
);

function onStop(): void {
  stop(props.tab.id);
}

function onRefresh(): void {
  refreshOrReconnect(needsReconnect.value, onReconnectAndLoad, () => reload(props.tab.id));
}

function onPoll(): void {
  void poll(props.tab.id);
}

// Item 2 (task #61): the bottom-of-view full-width status bar was redundant with the toolbar per
// the user's own report — this computed and its text survive, just relocated inline into the
// toolbar's first group (mirrors KeyValueView.vue's own prev/status/next arrangement) rather than
// a separate row spanning the view's full width. Keeps the same `stream-status` testid/wording so
// existing coverage (kafka.spec.ts's exact-count assertion, sqs.spec.ts's approximate-count one)
// still holds.
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

// P24 D30: <SegmentedControl>, mirroring views/grid/DataToolbar.vue's own swap. P43 iter3 D46: a
// computed over caps.maxPageSize rather than the plain module-level constant every other view's
// own pageSizeOptions() call still is — the ceiling is per-connection, so it can only be known
// once caps has actually arrived for this tab's connection.
const PAGE_SIZE_OPTIONS = computed(() => pageSizeOptions('stream-', caps.value?.maxPageSize));
function onPageSize(size: PageSize): void {
  void setPageSize(props.tab.id, size);
}

// P43 iter3 D46: a tab whose persisted pageSize predates this cap (or was set on a different
// engine before a connection swap) is corrected to the largest size actually offered — required,
// not cosmetic: PageSize is a closed union and SegmentedControl renders nothing selected when
// model-value isn't among its own options.
watch(
  PAGE_SIZE_OPTIONS,
  (options) => {
    if (options.length === 0) return;
    if (options.some((o) => o.value === props.tab.state.pageSize)) return;
    const largest = options[options.length - 1];
    if (largest) patchStreamTabState(props.tab.id, { pageSize: largest.value });
  },
  { immediate: true },
);

// Item 2's filter row (Kafka only) — local text buffers mirror FilterToolbar.vue's own
// whereText/orderByText pattern (a plain string an <input> can bind to; `null` only exists in
// the persisted/wire shapes). MainView.vue keys this whole component by tab.id, so a plain
// initializer (no watcher) already covers "just opened" and "tab changed" — same reasoning
// FilterToolbar.vue's own comment gives for needing `immediate: true` where it does have a watch
// (that component isn't remounted per tab; this one is).
const offsetText = ref(props.tab.state.offsetFilter ?? '');
// Item 1 (task #61): the partition filter widened from a single free-text field to a multiselect
// — a plain array buffer, same "just opened"/"tab changed" reasoning as offsetText/timestampText
// above (no watcher needed, MainView.vue keys this whole component by tab.id).
const selectedPartitions = ref<number[]>([...props.tab.state.partitions]);
const timestampText = ref(props.tab.state.timestampFilter ?? '');

function currentFilterInput(): {
  offset: string | null;
  partitions: number[];
  timestamp: string | null;
} {
  return {
    offset: offsetText.value.trim() === '' ? null : offsetText.value.trim(),
    partitions: [...selectedPartitions.value].sort((a, b) => a - b),
    timestamp: timestampText.value.trim() === '' ? null : timestampText.value.trim(),
  };
}

// P31 D14/F17: an unparseable "since" timestamp used to be swallowed silently — Date.parse
// returned NaN, isEmptyKafkaStreamFilter's `!== null` check didn't catch it, and the browse
// quietly started at the low watermark while the invalid text sat in the field looking applied.
// Validated here, on apply, so the read is never issued for it — state.ts's own NaN guard
// (D14's second half) keeps the wire payload honest regardless of caller.
const timestampError = ref<string | null>(null);
function validateTimestamp(): boolean {
  if (timestampText.value.trim() === '') {
    timestampError.value = null;
    return true;
  }
  if (Number.isNaN(Date.parse(timestampText.value.trim()))) {
    timestampError.value = 'Not a recognizable timestamp';
    return false;
  }
  timestampError.value = null;
  return true;
}

async function onApplyFilter(): Promise<void> {
  if (!validateTimestamp()) return;
  await applyStreamFilter(props.tab.id, currentFilterInput());
}

async function onClearFilter(): Promise<void> {
  offsetText.value = '';
  selectedPartitions.value = [];
  timestampText.value = '';
  timestampError.value = null;
  await applyStreamFilter(props.tab.id, { offset: null, partitions: [], timestamp: null });
}

function onApplyFromHistory(
  offset: string | null,
  partitions: number[],
  timestamp: string | null,
): void {
  offsetText.value = offset ?? '';
  selectedPartitions.value = [...partitions];
  timestampText.value = timestamp ?? '';
  timestampError.value = null;
  void applyStreamFilter(props.tab.id, { offset, partitions, timestamp });
}

// P31 D12/D13: the same trigger arrangement TimestampPane.vue:117-134 already uses (calendar
// IconButton + PopoverPanel + DateTimePicker) — DateTimePicker.vue moved to views/shared/ (D12)
// since this is the second view that needs it and views/* may not import each other sideways
// (§11). toISOString(), not P24's shape-preserving encodeTimestamp: this field is an input to a
// query with no original spelling to preserve, and state.ts's load() feeds it straight to
// Date.parse.
const timestampCalendarOpen = ref(false);
const timestampPickerDate = computed(() => {
  if (timestampText.value.trim() === '') return new Date();
  const ms = Date.parse(timestampText.value.trim());
  return Number.isNaN(ms) ? new Date() : new Date(ms);
});
function onPickTimestamp(date: Date): void {
  timestampText.value = date.toISOString();
  void onApplyFilter();
}

// Item 1's partition popover — a checkbox list anchored to a button (mirrors ColumnsMenu.vue's
// own anchor+PopoverPanel pattern), rather than the old free-text field. `partitionOptions` is
// (re)fetched every time the popover opens, via the same tree.children IPC ProjectTree.vue uses
// (a topic's path already resolves to its partition list one level down, kafka/index.ts's
// `children()`) — cheap enough for an on-demand round trip, and keeps the list honest if the
// topic's partition count changed since the tab was opened.
const filterHistoryOpen = ref(false);
const partitionMenuOpen = ref(false);
const partitionOptions = ref<number[]>([]);
const partitionOptionsLoading = ref(false);

async function loadPartitionOptions(): Promise<void> {
  const connectionId = props.tab.connectionId;
  if (!connectionId) return;
  partitionOptionsLoading.value = true;
  try {
    const result = await control.treeChildren(connectionId, props.tab.path, false);
    partitionOptions.value = result.nodes
      .map((n) => Number(n.name))
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => a - b);
  } catch {
    partitionOptions.value = [];
  } finally {
    partitionOptionsLoading.value = false;
  }
}

async function onTogglePartitionMenu(): Promise<void> {
  partitionMenuOpen.value = !partitionMenuOpen.value;
  if (partitionMenuOpen.value) await loadPartitionOptions();
}

function isPartitionSelected(p: number): boolean {
  return selectedPartitions.value.includes(p);
}

function onTogglePartition(p: number): void {
  const idx = selectedPartitions.value.indexOf(p);
  if (idx >= 0) selectedPartitions.value.splice(idx, 1);
  else selectedPartitions.value.push(p);
  void onApplyFilter();
}

const partitionButtonLabel = computed(() => {
  const n = selectedPartitions.value.length;
  if (n === 0) return 'all partitions';
  if (n === 1) return `partition ${selectedPartitions.value[0]}`;
  return `${n} partitions`;
});

const hasSelectedRow = computed(
  () => rt.value?.selectedRow !== null && rt.value?.selectedRow !== undefined,
);

// Item 3/4: the Add-message panel — Kafka's produce vs. SQS's SendMessage differ only in which
// fields StreamComposeMessage.vue shows (its own `kind` prop switches the shape).
const composeOpen = ref(false);

// Item 4: SQS-only Delete, gated on canDelete and on a row actually being selected (item 6's
// click-to-select doubles as this button's target — there is no separate per-row delete
// affordance, since stream/menu.ts's context menu stays copy-only for every engine per P10's D13).
async function onDeleteMessage(): Promise<void> {
  const selectedRow = rt.value?.selectedRow;
  if (selectedRow === null || selectedRow === undefined) return;
  const row = rowAt(selectedRow);
  if (!row?.key) return;
  if (!(await confirmDialog(`Delete this message (id: ${row.key})? This cannot be undone.`))) {
    return;
  }
  try {
    await deleteSqsMessage(props.tab.id, row.key);
    setActionError(props.tab.id, null);
  } catch (err) {
    setActionError(props.tab.id, err instanceof Error ? err.message : String(err));
  }
}

// Item 5: toggles the client-side, current-page-only search bar (DataView.vue's same pattern).
function onToggleSearch(): void {
  toggleSearchOpen(props.tab.id);
}

const matchSet = computed(() => new Set(searchState[props.tab.id]?.matches ?? []));
const currentMatchRow = computed(() => {
  const s = searchState[props.tab.id];
  return s && s.index >= 0 ? (s.matches[s.index] ?? null) : null;
});

// P49 F7/D5: rowIndices is the *filtered* array when the filter toggle is on, so a match's page-row
// number has to be looked up by position rather than assumed to equal it — same as
// KeyValueView.vue's/ConsoleResultGrid.vue's own goToMatch, now that this view's rows are
// virtualized too (a plain querySelector can no longer find an off-screen row's DOM node).
const listRef = ref<{ scrollToIndex: (index: number) => void } | null>(null);
function onGoToMatch(row: number): void {
  const index = rowIndices.value.indexOf(row);
  if (index >= 0) listRef.value?.scrollToIndex(index);
}
function onCloseSearch(): void {
  setSearchOpen(props.tab.id, false);
}

// Item 4: per-column resize for the four fixed-width columns (mirrors DataGrid.vue's own
// resize-handle pattern) — the `body` column stays `flex: 1` and is never resizable. Defaults
// match the previous hardcoded inline widths exactly, so a tab that never resized anything renders
// identically to before.
const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  key: 160,
  timestamp: 160,
  headers: 140,
  attrs: 140,
};

function widthFor(column: string): number {
  return props.tab.state.columnWidths[column] ?? DEFAULT_COLUMN_WIDTHS[column] ?? 96;
}

let resizing: { column: string; startX: number; startWidth: number } | null = null;

function onResizeStart(e: PointerEvent, column: string): void {
  e.stopPropagation();
  resizing = { column, startX: e.clientX, startWidth: widthFor(column) };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onResizeMove(e: PointerEvent): void {
  if (!resizing) return;
  const width = Math.max(40, resizing.startWidth + (e.clientX - resizing.startX));
  patchStreamTabState(props.tab.id, {
    columnWidths: { ...props.tab.state.columnWidths, [resizing.column]: width },
  });
}
function onResizeEnd(e: PointerEvent): void {
  resizing = null;
  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
}

let unregisterCommand: (() => void) | null = null;
let unregisterFindCommand: (() => void) | null = null;

onMounted(() => {
  if (!needsReconnect.value && !isBatch.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  // Item 4 (regression pass, task batch P46-4): route through the same gate-aware onRefresh the
  // toolbar button uses — this used to call reload() directly, a doomed no-op behind the gate.
  unregisterCommand = registerCommand('view.refresh', onRefresh);
  unregisterFindCommand = registerCommand('view.find', onToggleSearch);
});

onUnmounted(() => {
  unregisterCommand?.();
  unregisterFindCommand?.();
});
</script>

<template>
  <div class="stream-view" data-testid="stream-view" :data-path="tab.path">
    <!-- Item (regression pass, task batch P46-5): Vue casts an *absent* Boolean-typed prop to
         `false`, not `undefined` — ViewChrome.vue's own `:disabled="canRefresh === false"` made
         omitting can-refresh here silently mean "always disabled", regardless of connection or
         load state (DocumentView.vue had the identical bug, same fix). -->
    <ViewChrome
      :tab="tab"
      icon="broadcast"
      :icon-color="iconColor"
      :path="pathPrefix"
      :name="targetTail?.name ?? tab.path"
      name-testid="stream-target"
      refresh-testid="stream-refresh"
      stop-testid="stream-stop"
      :can-refresh="true"
      :can-stop="running"
      @refresh="onRefresh"
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
        <!-- Toolbar-consistency pass: a leading separator after ViewChrome's own built-in
             refresh/stop group, matching every other view's #toolbar slot (KeyValueView.vue,
             DocumentView.vue) and DataToolbar.vue's own canonical ordering. -->
        <div class="sep" />

        <!-- Item 1: Count/Poll-or-Next and the page-size picker sit together as one group, kept
             in this same main toolbar (there is no separate DataToolbar-equivalent for streams). -->
        <div class="group">
          <IconButton
            icon="symbol-number"
            data-testid="stream-count"
            v-tooltip="'Count'"
            @click="runCount(tab.id)"
          />
          <span class="p-sm muted" data-testid="stream-status">{{ statusLine }}</span>
          <AppButton
            v-if="isBatch"
            icon="arrow-swap"
            active
            data-testid="stream-poll"
            v-tooltip="'Poll for messages'"
            @click="onPoll"
          >
            Poll
          </AppButton>
          <IconButton
            v-else
            icon="arrow-right"
            data-testid="stream-next"
            :disabled="!rt?.hasMore"
            v-tooltip="'Next page'"
            @click="goNext(tab.id)"
          />
        </div>

        <!-- P48 F3: every sibling's page-size picker sits inside a sep boundary on both sides
             (DataToolbar.vue, DocumentView.vue, KeyValueView.vue) — this one was missing its
             leading sep. -->
        <div class="sep" />

        <SegmentedControl
          :model-value="tab.state.pageSize"
          :options="PAGE_SIZE_OPTIONS"
          data-testid="stream-page-size-picker"
          @update:model-value="onPageSize"
        />

        <div class="sep" />

        <div class="group">
          <div class="add-message-anchor">
            <IconButton
              v-if="canInsert"
              icon="add"
              data-testid="stream-add-message"
              v-tooltip="isKafka ? 'Produce a message' : 'Send a message'"
              @click="composeOpen = !composeOpen"
            />
            <StreamComposeMessage
              v-if="composeOpen && (isKafka || isSqs)"
              :tab-id="tab.id"
              :kind="isKafka ? 'kafka' : 'sqs'"
              @close="composeOpen = false"
            />
          </div>
          <IconButton
            v-if="isSqs && canDelete"
            icon="trash"
            data-testid="stream-delete-message"
            :disabled="!hasSelectedRow"
            v-tooltip="hasSelectedRow ? 'Delete the selected message' : 'Select a message first'"
            @click="onDeleteMessage"
          />
          <IconButton
            icon="search"
            :active="rt?.searchOpen"
            v-tooltip="'Search this page'"
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
            v-tooltip="'Filter history'"
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
        <div class="partition-anchor">
          <AppButton
            icon="filter"
            data-testid="stream-filter-partition"
            v-tooltip="'Filter by partition'"
            @click="onTogglePartitionMenu"
          >
            {{ partitionButtonLabel }}
          </AppButton>
          <PopoverPanel
            v-if="partitionMenuOpen"
            anchor="left"
            :width="200"
            test-id="stream-partition-menu"
            backdrop-test-id="stream-partition-menu-backdrop"
            @close="partitionMenuOpen = false"
          >
            <div class="partition-menu">
              <div v-if="partitionOptionsLoading" class="p-sm muted partition-menu-empty">
                Loading…
              </div>
              <div
                v-else-if="partitionOptions.length === 0"
                class="p-sm muted partition-menu-empty"
              >
                No partitions
              </div>
              <label
                v-for="p in partitionOptions"
                :key="p"
                class="partition-option"
                :data-testid="`stream-filter-partition-option-${p}`"
              >
                <input
                  type="checkbox"
                  :checked="isPartitionSelected(p)"
                  @change="onTogglePartition(p)"
                />
                <span>partition {{ p }}</span>
              </label>
            </div>
          </PopoverPanel>
        </div>
        <div class="timestamp-filter-field">
          <div class="ts-input-row">
            <TextField
              v-model="timestampText"
              prefix="since"
              placeholder="ISO timestamp"
              data-testid="stream-filter-timestamp"
              :invalid="!!timestampError"
              v-tooltip="timestampError ?? undefined"
              @enter="onApplyFilter"
              @blur="onApplyFilter"
            />
            <span class="ts-calendar-anchor">
              <IconButton
                icon="calendar"
                data-testid="stream-filter-timestamp-calendar"
                v-tooltip="'Pick a date and time'"
                @click="timestampCalendarOpen = !timestampCalendarOpen"
              />
              <PopoverPanel
                v-if="timestampCalendarOpen"
                :width="228"
                anchor="left"
                test-id="stream-filter-timestamp-calendar-popover"
                backdrop-testid="stream-filter-timestamp-calendar-backdrop"
                @close="timestampCalendarOpen = false"
              >
                <DateTimePicker :model-value="timestampPickerDate" zone="local" @update:model-value="onPickTimestamp" />
              </PopoverPanel>
            </span>
          </div>
          <span
            v-if="timestampError"
            class="filter-field-error"
            data-testid="stream-filter-timestamp-error"
            >{{ timestampError }}</span
          >
        </div>
        <AppButton data-testid="stream-filter-clear" v-tooltip="'Empty every field and refetch'" @click="onClearFilter">
          Clear
        </AppButton>
      </template>

      <!-- The one destructive truth of this view, stated once at the top. -->
      <template #strips>
      <MessageStrip v-if="isBatch" tone="warn" icon="warning" :icon-size="13" data-testid="stream-poll-warning">
        <span
          >Each poll <b>consumes</b> messages from the queue (subject to the visibility timeout
          above) — it does not browse a stable position.</span
        >
      </MessageStrip>

      <MessageStrip v-if="rt?.status === 'error' && rt.error" tone="err" icon="error" :icon-size="13" data-testid="stream-error">
        <span>{{ rt.error.message }}</span>
      </MessageStrip>

      <!-- P43 F6/D7: a failed SQS delete, distinct from a failed load above. -->
      <MessageStrip v-if="rt?.actionError" tone="err" icon="error" :icon-size="13" data-testid="stream-action-error">
        <span>{{ rt.actionError }}</span>
      </MessageStrip>

      <StreamSearchToolbar
        v-if="rt?.searchOpen"
        :tab-id="tab.id"
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
        container-testid="stream-reconnect"
        button-testid="stream-reconnect-load"
        @reconnect="onReconnectAndLoad"
      />
      <template v-else>
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
        <!-- P31 D19 (P24 D8's precedent): filtering to zero matches is a distinct empty state
             from "no messages loaded". -->
        <EmptyState
          v-else-if="displayRows && displayRows.length === 0"
          class="no-rows"
          icon="search"
          label="No matching rows"
          data-testid="stream-no-matching-rows"
        >
          <AppButton data-testid="stream-show-all-rows" @click="setSearchFiltering(tab.id, false)">
            Show all rows
          </AppButton>
        </EmptyState>
        <template v-else>
          <div class="p-thead">
            <div class="p-th gutter" style="width: 40px" />
            <div class="p-th" :style="{ width: `${widthFor('key')}px` }">
              <span class="name">key</span>
              <span
                class="resize-handle"
                draggable="false"
                data-testid="stream-column-resize-key"
                @pointerdown="onResizeStart($event, 'key')"
                @pointermove="onResizeMove"
                @pointerup="onResizeEnd"
                @click.stop
              />
            </div>
            <div class="p-th" :style="{ width: `${widthFor('timestamp')}px` }">
              <span class="name">timestamp</span>
              <span
                class="resize-handle"
                draggable="false"
                data-testid="stream-column-resize-timestamp"
                @pointerdown="onResizeStart($event, 'timestamp')"
                @pointermove="onResizeMove"
                @pointerup="onResizeEnd"
                @click.stop
              />
            </div>
            <div class="p-th" :style="{ width: `${widthFor('headers')}px` }">
              <span class="name">headers</span>
              <span
                class="resize-handle"
                draggable="false"
                data-testid="stream-column-resize-headers"
                @pointerdown="onResizeStart($event, 'headers')"
                @pointermove="onResizeMove"
                @pointerup="onResizeEnd"
                @click.stop
              />
            </div>
            <div class="p-th" :style="{ width: `${widthFor('attrs')}px` }">
              <span class="name">attrs</span>
              <span
                class="resize-handle"
                draggable="false"
                data-testid="stream-column-resize-attrs"
                @pointerdown="onResizeStart($event, 'attrs')"
                @pointermove="onResizeMove"
                @pointerup="onResizeEnd"
                @click.stop
              />
            </div>
            <div class="p-th" style="flex: 1"><span class="name">body</span></div>
          </div>
          <VirtualList ref="listRef" class="tbody-scroll" :items="rowIndices" :row-height="rowHeight">
            <template #default="{ item: i }">
              <div
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
                  :style="{ width: `${widthFor('key')}px` }"
                  data-testid="stream-key"
                  @click.stop="onCellClick(i, 'key', rowAt(i)?.key ?? null)"
                >
                  {{ rowAt(i)?.key ?? '(none)' }}
                </div>
                <div
                  class="p-td"
                  :style="{ width: `${widthFor('timestamp')}px` }"
                  data-testid="stream-timestamp"
                  @click.stop="onCellClick(i, 'timestamp', rowAt(i)?.timestamp ?? null)"
                >
                  {{ rowAt(i)?.timestamp ?? '' }}
                </div>
                <div
                  class="p-td"
                  :style="{ width: `${widthFor('headers')}px` }"
                  data-testid="stream-headers"
                  @click.stop="onCellClick(i, 'headers', rowAt(i)?.headers ?? null)"
                >
                  {{ rowAt(i)?.headers }}
                </div>
                <div
                  class="p-td"
                  :style="{ width: `${widthFor('attrs')}px` }"
                  data-testid="stream-attrs"
                  @click.stop="onCellClick(i, 'attrs', rowAt(i)?.attrs ?? null)"
                >
                  {{ rowAt(i)?.attrs }}
                </div>
                <div
                  class="p-td msg-body"
                  style="flex: 1"
                  data-testid="stream-body"
                  @click.stop="onCellClick(i, 'body', rowAt(i)?.body ?? null, rowAt(i)?.isTruncated)"
                >
                  {{ rowAt(i)?.body }}
                  <span v-if="rowAt(i)?.isTruncated" class="p-xs muted" v-tooltip="'body truncated'"
                    >(truncated)</span
                  >
                </div>
              </div>
            </template>
          </VirtualList>
        </template>
      </div>
      </template>
    </ViewChrome>
    <CellEditorDock :tab-id="tab.id" :read-only="true" />
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

/* Task #64: the compose-message popover was rendered as a sibling of ViewChrome, far from the
   "Add message" button that opens it — PopoverPanel.vue anchors to its own DOM parent, so it needs to
   be a sibling of the trigger, same wrapper shape as .columns-anchor/.add-anchor elsewhere. */
.add-message-anchor {
  position: relative;
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
  /* P49 F7/D5: previously unset (sized off whatever text a cell happened to hold) — now fixed,
     matching the density-driven rowHeight computed VirtualList's offset math needs. */
  height: var(--kira-row-height);
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

/* P31 D21: adopts the same color-mix tint / solid-current pair as DataGrid.vue and
   KeyValueView.vue, replacing the inset bar so all four search-capable views agree. */
.stream-row.search-match {
  background: var(--kira-search-match);
}

.stream-row.search-match-current {
  background: var(--kira-search-match-current);
  color: var(--kira-bg);
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


.history-anchor,
.partition-anchor {
  position: relative;
}

.filter-field {
  width: 160px;
  flex-shrink: 0;
}

.filter-field :deep(.p-input) {
  width: 100%;
}

/* P31 D12/D13: the "since" field's own wrapper — not `.filter-field` (that class's fixed 160px
   width and 100%-wide input are sized for a single bare TextField; this one also carries a
   calendar trigger beside the input and an error line below it). */
.timestamp-filter-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
}

.ts-input-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-1);
}

.ts-input-row :deep(.p-input) {
  width: 160px;
}

.ts-calendar-anchor {
  position: relative;
  flex-shrink: 0;
}

.filter-field-error {
  color: var(--kira-error);
  font-size: var(--kira-t-xs);
  white-space: nowrap;
}

/* Item 1's partition checkbox list — mirrors ColumnsMenu.vue's own list-inside-a-PopoverPanel shape. */
.partition-menu {
  display: flex;
  flex-direction: column;
  max-height: 240px;
  overflow-y: auto;
  padding: var(--kira-s-2);
  gap: var(--kira-s-1);
}

.partition-menu-empty {
  padding: var(--kira-s-2);
}

.partition-option {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-1) var(--kira-s-2);
  border-radius: var(--kira-radius);
  cursor: pointer;
}

.partition-option:hover {
  background: var(--kira-hover);
}

/* Item 4: a resize handle on the right edge of the four fixed-width header cells (mirrors
   DataGrid.vue's own `.header-cell`/`.resize-handle` pair) — `.p-th` needs `position: relative`
   as its positioning context, scoped here rather than in primitives.css since it's a stream-only
   affordance (grid/keyvalue/console reuse `.p-th` too but never resize it this way). Unlike
   DataGrid.vue's `.header-cell` (no overflow rule of its own), primitives.css's shared `.p-th`
   sets `overflow: hidden` — `right: 0` (rather than DataGrid's `right: -2px`) keeps the whole
   4px handle inside `.p-th`'s own box instead of half-clipped by that overflow. */
.p-th {
  position: relative;
}

.resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  z-index: 1;
}
</style>
