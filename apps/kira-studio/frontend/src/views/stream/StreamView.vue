<script setup lang="ts">
import { KuiColumnResizeHandle } from '@kira/kira-ui';
import type { PageSize } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { Popover, PopoverAnchor, PopoverContent } from '@theme/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import { useEventListener } from '@vueuse/core';
import { registerCommand } from '@workbench/shortcuts/commands';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { useContextMenuStore } from '@workbench/state/contextMenu';
import { useVirtualRows } from '@workbench/util/virtualRows';
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { control } from '../../bridge/control';
import { type SelectedCell, useCellSelectionStore } from '../../state/cellSelection';
import { useConnectionsStore } from '../../state/connections';
import { useRunState } from '../../state/runState';
import { useSettingsStore } from '../../state/settings';
import type { StreamTabRecord } from '../../state/tabDomain';
import { useTabsStore } from '../../state/tabs';
import { cellClass } from '../../theme/cellClass';
import EngineIcon from '../../theme/EngineIcon.vue';
import CellEditorDock from '../shared/celleditor/CellEditorDock.vue';
import DateTimePicker from '../shared/DateTimePicker.vue';
import { datasetNumber } from '../shared/eventCoords';
import { usePageSearchFilterStore } from '../shared/page/searchFilter';
import { pageSizeOptions } from '../shared/page/sizes';
import { setVisibleRows } from '../shared/page/visibleRows';
import { refreshOrReconnect, useConnectionGate } from '../shared/useConnectionGate';
import { rowMenu } from './menu';
import { deleteSqsMessage } from './mutations';
import { getPage, pageVersion, setVisibleWindow, streamRow } from './page';
import StreamComposeMessage from './StreamComposeMessage.vue';
import StreamFilterHistoryMenu from './StreamFilterHistoryMenu.vue';
import StreamSearchToolbar from './StreamSearchToolbar.vue';
import { useStreamSearchStore } from './search';
import { useStreamViewStore } from './state';

const cellSelectionStore = useCellSelectionStore();
const hasCellDock = computed(() => cellSelectionStore.selectedCellFor(props.tab.id) !== null);
const confirmDialogStore = useConfirmDialogStore();
const contextMenuStore = useContextMenuStore();
const pageSearchFilterStore = usePageSearchFilterStore();
const streamSearchStore = useStreamSearchStore();
const connectionsStore = useConnectionsStore();
const tabsStore = useTabsStore();
const settingsStore = useSettingsStore();
const streamViewStore = useStreamViewStore();

// MainView.vue keys this component by tab.id — same discipline as KeyValueView.vue.
const props = defineProps<{ tab: StreamTabRecord }>();

const caps = computed(() => {
  const connectionId = props.tab.connectionId;
  return connectionId ? (connectionsStore.states[connectionId]?.caps ?? null) : null;
});

// P16 design system LAW: connection colour is a 2px rail — here capping the toolbar and as a
// dot in the view header — never a background tint. Mirrors Toolbar.vue's `color`/`railStyle`
// pair exactly. No colour assigned leaves `--kira-rail` unset, so the reserved slot stays blank
// instead of shifting anything.
const connRecord = computed(() => connectionsStore.connectionRecord(props.tab.connectionId));
const iconColor = computed(() => connColorVar(connRecord.value?.color) ?? 'var(--kira-fg-muted)');

const pathPrefix = computed(() => (connRecord.value ? `${connRecord.value.name} / ` : ''));

// P104 §3: ViewChrome/ViewHeader/RunState inlined -- railColor mirrors ViewChrome.vue's own
// `envColor ?? (connection ? connection.color ?? null : undefined)`; this view has no envColor.
const railColor = computed(() => (connRecord.value ? (connRecord.value.color ?? null) : undefined));
const runState = useRunState(() => props.tab.id);
const runStateLabel = computed(() => {
  if (runState.value.status === 'error') return 'failed';
  if (runState.value.elapsedMs === null) return '—';
  return runState.value.elapsedMs < 1000
    ? `${Math.round(runState.value.elapsedMs)} ms`
    : `${(runState.value.elapsedMs / 1000).toFixed(1)} s`;
});

// D10/D12: SQS's 'batch' pagination is never auto-loaded — the user must click Poll, because
// every poll consumes messages from the queue (subject to VisibilityTimeout) rather than
// merely browsing them. Kafka's 'offsetWindow' strategy is a pure browse and auto-loads like
// every other read-only view.
const isBatch = computed(() => caps.value?.pagination === 'batch');
// Item 2/3/4: Kafka gets the offset/partition/timestamp filter row and Add-message (no Delete —
// a topic's log is immutable, kafkaCaps.canDelete stays false permanently). SQS gets Add and
// Delete but no filter row at all (queue-based, no topic/partition/offset concept to filter by).
// P21 round 1 architecture/security finding 11: isKafka/isSqs used to gate whether the compose
// dialog rendered and whether Delete was offered — ARCHITECTURE.md states the UI reads only Caps
// to decide what to show, never a connection.kind check (kind-based *wording*, like the tooltip
// text below, is the one thing the doc carves out as fine). isKafka survives only as wording/data
// selection now; isSqs had no remaining use once the v-ifs below read canInsert/canDelete instead.
const isKafka = computed(() => connRecord.value?.kind === 'kafka');
// P21 round 2 functional finding 3: Caps is a static per-adapter literal that never narrows for
// a connection's own read-only flag — this view read it alone, so Produce/Send/Delete-message
// stayed fully live (not greyed — these are v-ifs, not :disabled) on a read-only Kafka/SQS
// connection and only failed server-side with a raw E_UNSUPPORTED. Mirrors KeyValueView.vue's
// own canInsert/canDelete, which already combine the two.
const canInsert = computed(() => (caps.value?.canInsert ?? false) && !connRecord.value?.readOnly);
const canDelete = computed(() => (caps.value?.canDelete ?? false) && !connRecord.value?.readOnly);

// D10/D12: a batch tab (SQS) never auto-loads on reconnect — only an explicit Poll does,
// since every poll consumes from the queue rather than merely browsing it.
const { needsReconnect, onReconnectAndLoad } = useConnectionGate(
  () => props.tab,
  () => {
    if (!isBatch.value) return streamViewStore.load(props.tab.id);
  },
);

const rt = computed(() => streamViewStore.runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'loading');

const targetTail = computed(() => pathTail(props.tab.path));

const page = computed(() => {
  void pageVersion.n;
  return getPage(props.tab.id);
});

// P31 D17/D18: the same "hide non-matching rows" toggle grid/keyvalue/documents share (P24 D2) —
// filtered rows keep their real row number (the `i + 1` gutter below), same as those views.
const displayRows = computed<number[] | null>(() => streamSearchStore.matchedRows(props.tab.id));
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
// offset math, so this adopts the same density-driven height ConsoleResultGrid.vue/KeyValueView.vue
// (and the deleted DataGrid.vue) already use rather than inventing a fourth number.
const rowHeight = computed(() => (settingsStore.appearance.rowDensity === 'compact' ? 22 : 28));

function onRowContextMenu(e: MouseEvent, key: string | null, body: string): void {
  e.preventDefault();
  contextMenuStore.openContextMenu(e, rowMenu(key, body));
}

// Row click alone (gutter, empty row background) just selects the row for highlighting/delete-
// eligibility — it does not touch the cell editor. Publishing there is per-column, via
// onCellClick below.
function onRowClick(i: number): void {
  streamViewStore.selectRow(props.tab.id, i);
}

// Item 6 (widened, task #75): publishes into cellSelection.ts's shared slot (the same one
// SlickGridHost.vue uses) so CellEditorView.vue can show whichever column of the clicked row was
// actually clicked, read-only — not just the body. A synthetic single-column ColumnDescriptor
// stands in for the grid's real per-table columns, since a stream row has no catalog-described
// schema at all (§8.9 has no column navigation for streams).
function onCellClick(i: number, name: string, value: string | null, truncated = false): void {
  streamViewStore.selectRow(props.tab.id, i);
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
  cellSelectionStore.publishSelectedCell(selected);
}

// P2 R2 (task #98): same closure-per-render problem the deleted DataGrid.vue found first (P2 R1) — a template
// handler that calls out with the v-for's `i` can never be cached by Vue's compiler (hasScopeRef),
// so every visible row/cell got a fresh wrapper closure on every render, scroll included. These
// recover `i` from the row's `data-row-index` (walking up from a cell to its ancestor `.stream-row`
// where needed) so the template can bind stable, module-scope functions instead.
function onRowClickFromEvent(e: MouseEvent): void {
  const i = datasetNumber(e.currentTarget, 'rowIndex');
  if (i !== null) onRowClick(i);
}
// P105 §5.2(c): Enter/Space on the gutter cell mirror clicking it — role="grid"/"row"/"gridcell"
// all want real <table>/<tr>/<td> per Biome's useSemanticElements, so each column (gutter
// included) is its own role="option" instead, verified clean; the row div itself carries no
// role or keyboard handler of its own now.
function onRowKeydownFromEvent(e: KeyboardEvent): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  const i = datasetNumber(e.currentTarget, 'rowIndex');
  if (i !== null) onRowClick(i);
}
// P105 §5.2(c): delegated off the container rather than each row — a keyboard equivalent for
// "open context menu" already exists (the OS/browser's own Shift+F10 on whichever cell is
// focused), so this is a pointer-only convenience, not an element needing its own role/tabindex.
function onRowContextMenuFromEvent(e: MouseEvent): void {
  const i = datasetNumber(e.target, 'rowIndex');
  if (i === null) return;
  onRowContextMenu(e, rowAt(i)?.key ?? null, rowAt(i)?.body ?? '');
}
function onKeyCellClickFromEvent(e: MouseEvent): void {
  const i = datasetNumber(e.currentTarget, 'rowIndex');
  if (i !== null) onCellClick(i, 'key', rowAt(i)?.key ?? null);
}
function onTimestampCellClickFromEvent(e: MouseEvent): void {
  const i = datasetNumber(e.currentTarget, 'rowIndex');
  if (i !== null) onCellClick(i, 'timestamp', rowAt(i)?.timestamp ?? null);
}
function onHeadersCellClickFromEvent(e: MouseEvent): void {
  const i = datasetNumber(e.currentTarget, 'rowIndex');
  if (i !== null) onCellClick(i, 'headers', rowAt(i)?.headers ?? null);
}
function onAttrsCellClickFromEvent(e: MouseEvent): void {
  const i = datasetNumber(e.currentTarget, 'rowIndex');
  if (i !== null) onCellClick(i, 'attrs', rowAt(i)?.attrs ?? null);
}
function onBodyCellClickFromEvent(e: MouseEvent): void {
  const i = datasetNumber(e.currentTarget, 'rowIndex');
  if (i !== null) onCellClick(i, 'body', rowAt(i)?.body ?? null, rowAt(i)?.isTruncated);
}
// P105 §5.2(c): Enter/Space on a cell mirror clicking it.
function onCellKeydownFromEvent(e: KeyboardEvent, column: 'key' | 'timestamp' | 'headers' | 'attrs' | 'body'): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  e.stopPropagation();
  const i = datasetNumber(e.currentTarget, 'rowIndex');
  if (i === null) return;
  if (column === 'body') onCellClick(i, 'body', rowAt(i)?.body ?? null, rowAt(i)?.isTruncated);
  else onCellClick(i, column, rowAt(i)?.[column] ?? null);
}

// P43 iter2 F20/D27: rt.selectedRow is already reset to null on every load (state.ts's own
// comment: "a fresh page invalidates whatever row index used to be selected") — the published
// cell is the other half of the same idea and was left out of it, so a Poll cleared the row
// highlight while the dock kept showing the previous batch's message body.
watch(
  () => pageVersion.n,
  () => cellSelectionStore.clearSelectedCellFor(props.tab.id),
);

function onStop(): void {
  streamViewStore.stop(props.tab.id);
}

// D10/D12: same "never auto-loads" rule as mount/reconnect above — SQS's Refresh affordance
// (toolbar button, F5, and the app menu's View > Refresh all route here via view.refresh) must
// never itself call ReceiveMessage. can-refresh is set to !isBatch below so the affordance is
// inert for SQS in the first place; this guard is the backstop for the command-registry path,
// which reaches onRefresh directly regardless of what's rendered.
function onRefresh(): void {
  if (isBatch.value) return;
  refreshOrReconnect(needsReconnect.value, onReconnectAndLoad, () => streamViewStore.reload(props.tab.id));
}

function onPoll(): void {
  void streamViewStore.poll(props.tab.id);
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
  void streamViewStore.setPageSize(props.tab.id, size);
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
    if (largest) tabsStore.patchStreamTabState(props.tab.id, { pageSize: largest.value });
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
  await streamViewStore.applyStreamFilter(props.tab.id, currentFilterInput());
}

async function onClearFilter(): Promise<void> {
  offsetText.value = '';
  selectedPartitions.value = [];
  timestampText.value = '';
  timestampError.value = null;
  await streamViewStore.applyStreamFilter(props.tab.id, { offset: null, partitions: [], timestamp: null });
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
  void streamViewStore.applyStreamFilter(props.tab.id, { offset, partitions, timestamp });
}

// P31 D12/D13: the same trigger arrangement TimestampPane.vue:117-134 already uses (calendar
// IconButton + PopoverPanel + DateTimePicker) — DateTimePicker.vue moved to views/shared/ (D12)
// since this is the second view that needs it and views/* may not import each other sideways
// (§11). toISOString(), not P24's shape-preserving encodeTimestamp: this field is an input to a
// query with no original spelling to preserve, and state.ts's load() feeds it straight to
// Date.parse.
const timestampCalendarOpen = ref(false);
// P104 §3: PopoverAnchor's own `:reference` takes the trigger's real DOM node directly (the
// established `.$el` idiom, GitPanel.vue's promptInput) -- one ref per popover's own trigger.
const timestampCalendarTriggerEl = ref<{ $el: HTMLElement } | null>(null);
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
const partitionTriggerEl = ref<{ $el: HTMLElement } | null>(null);
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
const addMessageTriggerEl = ref<{ $el: HTMLElement } | null>(null);

// Item 4: SQS-only Delete, gated on canDelete and on a row actually being selected (item 6's
// click-to-select doubles as this button's target — there is no separate per-row delete
// affordance, since stream/menu.ts's context menu stays copy-only for every engine per P10's D13).
async function onDeleteMessage(): Promise<void> {
  const selectedRow = rt.value?.selectedRow;
  if (selectedRow === null || selectedRow === undefined) return;
  const row = rowAt(selectedRow);
  if (!row?.key) return;
  if (!(await confirmDialogStore.confirmDialog(`Delete this message (id: ${row.key})? This cannot be undone.`))) {
    return;
  }
  try {
    await deleteSqsMessage(props.tab.id, row.key);
    streamViewStore.setActionError(props.tab.id, null);
  } catch (err) {
    streamViewStore.setActionError(props.tab.id, err instanceof Error ? err.message : String(err));
  }
}

// Item 5: toggles the client-side, current-page-only search bar (DataView.vue's same pattern).
function onToggleSearch(): void {
  streamViewStore.toggleSearchOpen(props.tab.id);
}

const matchSet = computed(
  () => new Set(streamSearchStore.searchState[props.tab.id]?.matches ?? []),
);
const currentMatchRow = computed(() => {
  const s = streamSearchStore.searchState[props.tab.id];
  return s && s.index >= 0 ? (s.matches[s.index] ?? null) : null;
});

// P49 F7/D5: rowIndices is the *filtered* array when the filter toggle is on, so a match's page-row
// number has to be looked up by position rather than assumed to equal it — same as
// KeyValueView.vue's/ConsoleResultGrid.vue's own goToMatch, now that this view's rows are
// virtualized too (a plain querySelector can no longer find an off-screen row's DOM node).
// P104 §3.4: VirtualList's own recipe, rebuilt on @tanstack/vue-virtual via the shared
// useVirtualRows composable.
const scrollEl = ref<HTMLElement | null>(null);
const { virtualItems, totalSize, onScroll, scrollToIndex } = useVirtualRows({
  count: () => rowIndices.value.length,
  rowHeight: () => rowHeight.value,
  scrollElement: scrollEl,
});
useEventListener(scrollEl, 'contextmenu', onRowContextMenuFromEvent);

function onGoToMatch(row: number): void {
  const index = rowIndices.value.indexOf(row);
  if (index >= 0) scrollToIndex(index);
}
function onCloseSearch(): void {
  streamViewStore.setSearchOpen(props.tab.id, false);
}

// P5 C3/F5: this view never reported a visible window before — page.ts's decode cache (five
// subkeys per row: key/headers/attrs/timestamp/body, F5's own most expensive per-cell shape) never
// pruned, growing monotonically for the tab's lifetime. Mirrors KeyValueView.vue's own
// onVisibleRangeIndices exactly, resolving `rowIndices`' (possibly filtered) positions back to
// real page rows the same way. Derived from `virtualItems` (no more `@visible-range` emit) since
// useVirtualRows exposes no visible-range equivalent of its own -- see DocumentView.vue's own
// identical note.
watch(virtualItems, (items) => {
  if (items.length === 0) return;
  const list = rowIndices.value;
  const from = list[items[0].index];
  const to = list[items[items.length - 1].index];
  if (from === undefined || to === undefined) return;
  setVisibleRows(props.tab.id, from, to + 1);
  setVisibleWindow(props.tab.id, from, to + 1);
});

// Item 4: per-column resize for the four fixed-width columns (mirrors the deleted DataGrid.vue's
// own resize-handle pattern — SlickGrid handles its own column resize natively, so this view is
// now the only hand-rolled one left) — the `body` column stays `flex: 1` and is never resizable. Defaults
// match the previous hardcoded inline widths exactly, so a tab that never resized anything renders
// identically to before.
const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  key: 160,
  timestamp: 160,
  headers: 140,
  attrs: 140,
};

// P21 round 2 performance finding 10(c): onResizeMove used to call patchStreamTabState on every
// single pointermove — patchStreamTabState's own skipUnchanged: false means every one of those
// calls allocates a fresh columnWidths object (`{...columnWidths, [col]: width}` is a new object
// reference every time regardless of whether the rounded width actually differs, so skipUnchanged
// wouldn't have helped even if it were true here — patchChanged compares by Object.is per key),
// mutates the reactive tab state (re-rendering the header on every pixel of drag), and re-arms the
// 1s debounced save, which serializes *every* tab via JSON.stringify(tabsState.tabs). A resize
// drag now drives this local ref instead — the visual still tracks the pointer via widthFor's own
// check below — and only writes to tab state once, on pointerup, with the final width.
const liveResizeWidth = ref<{ column: string; width: number } | null>(null);

function widthFor(column: string): number {
  if (liveResizeWidth.value?.column === column) return liveResizeWidth.value.width;
  return props.tab.state.columnWidths[column] ?? DEFAULT_COLUMN_WIDTHS[column] ?? 96;
}

// P105 §5.2(a): KuiColumnResizeHandle owns the pointer/keyboard drag mechanics now — this view
// keeps only its own live-preview-then-single-commit split (P21 round 2 finding 10c's own reason,
// still the point: patchStreamTabState's own skipUnchanged: false makes a per-pixel-move commit
// allocate + re-render + re-arm the debounced save on every pixel).
function onResizeLive(column: string, width: number): void {
  liveResizeWidth.value = { column, width };
}
function onResizeCommit(column: string, width: number): void {
  tabsStore.patchStreamTabState(props.tab.id, {
    columnWidths: { ...props.tab.state.columnWidths, [column]: width },
  });
  liveResizeWidth.value = null;
}
// P108 Part 11 F10: a drag ended by pointercancel/lostpointercapture (the OS hands the gesture off
// elsewhere) used to never reach onResizeCommit, so liveResizeWidth stuck at the aborted drag's
// last live value -- shown but never saved, until a later drag on some other column overwrote it
// and this column snapped back. KuiColumnResizeHandle's own `cancel` emit is the fix's other half.
// Guarded by column, same as widthFor's own read: an unrelated drag already started on another
// column by the time this fires must not clear ITS live preview.
function onResizeCancel(column: string): void {
  if (liveResizeWidth.value?.column === column) liveResizeWidth.value = null;
}

let unregisterCommand: (() => void) | null = null;
let unregisterFindCommand: (() => void) | null = null;

onMounted(() => {
  if (!needsReconnect.value && !isBatch.value && !streamViewStore.runtime[props.tab.id]) {
    void streamViewStore.load(props.tab.id);
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
    <!-- P104: SplitterGroup wraps the inlined header+toolbar chrome + CellEditorDock, since the
         resize handle must sit as reka's own direct child alongside the panel it resizes
         (CellEditorDock.vue's own comment) -- mirrors DataView.vue/KeyValuePane.vue. -->
    <SplitterGroup direction="vertical" class="stream-split">
    <SplitterPanel class="stream-split-top" :order="1">
    <!-- P104 §3: ViewChrome/ViewHeader/RunState inlined -- no component wraps this chrome anymore.
         Item (regression pass, task batch P46-5): Vue casts an *absent* Boolean-typed prop to
         `false`, not `undefined` — the old ViewChrome's own `:disabled="canRefresh === false"`
         made an absent can-refresh mean "always disabled" -- Refresh below carries the same
         `:disabled="isBatch"` this view's `can-refresh="!isBatch"` used to compute. -->
    <div class="p-view-head">
      <span
        v-if="railColor !== undefined"
        class="p-conn-dot"
        :class="{ none: !railColor || railColor === 'none' }"
        :style="{ '--kira-rail': connColorVar(railColor) }"
      />
      <span v-if="connRecord?.kind" class="size-4 flex items-center justify-center shrink-0">
        <EngineIcon :kind="connRecord.kind" :size="13" />
      </span>
      <span class="size-4 flex items-center justify-center shrink-0" :style="{ color: iconColor }">
        <CodiconIcon name="broadcast" :size="13" />
      </span>
      <span class="p-view-target"
        ><span v-if="pathPrefix" class="path">{{ pathPrefix }}</span
        ><span data-testid="stream-target">{{ targetTail?.name ?? tab.path }}</span></span
      >
      <span class="ml-auto flex items-center gap-1">
        <Badge
          v-if="page?.visibilityTimeoutSeconds !== null && page?.visibilityTimeoutSeconds !== undefined"
          data-testid="stream-visibility-timeout"
        >
          visibility {{ page.visibilityTimeoutSeconds }}s
        </Badge>
      </span>
    </div>

    <div class="p-toolbar-rail" :style="{ '--kira-rail': connColorVar(railColor) }" />
    <div class="p-toolbar" :class="{ last: !isKafka }">
      <div class="group">
        <Tooltip>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <Button
                variant="toolbar"
                size="kira-icon"
                data-testid="stream-refresh"
                :disabled="isBatch"
                aria-label="Refresh"
                @click="onRefresh"
              >
                <CodiconIcon name="refresh" :size="13" />
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <Button
                variant="toolbar"
                size="kira-icon"
                :class="{ 'text-error': running }"
                data-testid="stream-stop"
                :disabled="!running"
                aria-label="Stop"
                @click="onStop"
              >
                <CodiconIcon name="debug-stop" :size="13" />
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>Stop</TooltipContent>
        </Tooltip>
      </div>
      <!-- Toolbar-consistency pass: a leading separator after the built-in refresh/stop group,
           matching every other view's #toolbar slot (KeyValueView.vue, DocumentView.vue) and
           DataToolbar.vue's own canonical ordering. -->
      <div class="sep" />

      <!-- Item 1: Count/Poll-or-Next and the page-size picker sit together as one group, kept
           in this same main toolbar (there is no separate DataToolbar-equivalent for streams). -->
      <div class="group">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              :class="rt?.countError ? 'text-error' : ''"
              aria-label="Count"
              data-testid="stream-count"
              @click="streamViewStore.runCount(tab.id)"
            >
              <CodiconIcon name="symbol-number" :size="13" />
            </Button>
          </TooltipTrigger>
          <!-- P108 Part 11 F15: mirrors grid/DataToolbar.vue's own count tooltip — a failed count
               is no longer silent (applyStreamFilter now clears countError the same way it already
               clears count/countOpId, so a stale message never outlives the filter it was for). -->
          <TooltipContent data-testid="stream-count-tooltip">{{
            rt?.countError ? `Count failed: ${rt.countError}` : 'Count'
          }}</TooltipContent>
        </Tooltip>
        <span class="text-kira-sm text-muted-foreground" data-testid="stream-status">{{ statusLine }}</span>
        <Tooltip v-if="isBatch">
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira"
              class="bg-field text-fg"
              data-testid="stream-poll"
              @click="onPoll"
            >
              <CodiconIcon name="arrow-swap" :size="13" />
              Poll
            </Button>
          </TooltipTrigger>
          <TooltipContent>Poll for messages</TooltipContent>
        </Tooltip>
        <Tooltip v-else>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <Button
                variant="toolbar"
                size="kira-icon"
                :disabled="!rt?.hasMore"
                aria-label="Next page"
                data-testid="stream-next"
                @click="streamViewStore.goNext(tab.id)"
              >
                <CodiconIcon name="arrow-right" :size="13" />
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>Next page</TooltipContent>
        </Tooltip>
      </div>

      <!-- P48 F3: every sibling's page-size picker sits inside a sep boundary on both sides
           (DataToolbar.vue, DocumentView.vue, KeyValueView.vue) — this one was missing its
           leading sep. -->
      <div class="sep" />

      <ToggleGroup
        type="single"
        :model-value="String(tab.state.pageSize)"
        data-testid="stream-page-size-picker"
        @update:model-value="(v) => v && onPageSize(Number(v) as PageSize)"
      >
        <ToggleGroupItem
          v-for="opt in PAGE_SIZE_OPTIONS"
          :key="opt.value"
          :value="String(opt.value)"
          :data-testid="opt.testid"
        >
          {{ opt.label }}
        </ToggleGroupItem>
      </ToggleGroup>

      <div class="sep" />

      <div class="group">
        <div class="add-message-anchor">
          <Tooltip v-if="canInsert">
            <TooltipTrigger as-child>
              <Button
                ref="addMessageTriggerEl"
                variant="toolbar"
                size="kira-icon"
                aria-label="Add message"
                data-testid="stream-add-message"
                @click="composeOpen = !composeOpen"
              >
                <CodiconIcon name="add" :size="13" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ isKafka ? 'Produce a message' : 'Send a message' }}</TooltipContent>
          </Tooltip>
          <Popover :open="composeOpen && canInsert" @update:open="(v) => (composeOpen = v)">
            <PopoverAnchor :reference="(addMessageTriggerEl?.$el as HTMLElement) ?? undefined" class="hidden" />
            <PopoverContent align="end" class="w-96 p-0" data-testid="stream-add-message-panel">
              <StreamComposeMessage
                :tab-id="tab.id"
                :kind="isKafka ? 'kafka' : 'sqs'"
                @close="composeOpen = false"
              />
            </PopoverContent>
          </Popover>
        </div>
        <Tooltip v-if="canDelete">
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <Button
                variant="toolbar"
                size="kira-icon"
                :disabled="!hasSelectedRow"
                aria-label="Delete message"
                data-testid="stream-delete-message"
                @click="onDeleteMessage"
              >
                <CodiconIcon name="trash" :size="13" />
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>{{
            hasSelectedRow ? 'Delete the selected message' : 'Select a message first'
          }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              :class="{ 'bg-field text-fg': rt?.searchOpen }"
              aria-label="Search this page"
              data-testid="stream-search-toggle"
              @click="onToggleSearch"
            >
              <CodiconIcon name="search" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search this page</TooltipContent>
        </Tooltip>
      </div>
      <span class="ml-auto" />
      <Tooltip :disabled="true">
        <TooltipTrigger as-child>
          <span
            data-testid="run-state"
            class="inline-flex items-center gap-1 font-data text-kira-xs text-subtle"
            :class="{ 'text-info': runState.status === 'running', 'text-error': runState.status === 'error' }"
          >
            <span data-testid="run-state-label" class="label min-w-[7ch] text-right">{{ runStateLabel }}</span
            ><span
              class="h-3 w-3 shrink-0 rounded-full border-2 border-border-strong"
              :class="{
                'animate-kira-spin border-t-primary border-r-transparent border-b-primary border-l-primary':
                  runState.status === 'running',
                'border-error': runState.status === 'error',
              }"
            />
          </span>
        </TooltipTrigger>
      </Tooltip>
      <div class="group"></div>
    </div>

    <div v-if="isKafka" class="p-toolbar last">
        <!-- Item 2: Kafka-only positioning filters — SQS shows none of this (no topic/partition/
             offset concept, per connection.kind above). Applies only to a *fresh* browse
             (state.ts's applyStreamFilter always restarts one); a token-continued page ignores it. -->
        <div class="history-anchor">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="toolbar"
                size="kira-icon"
                aria-label="Filter history"
                data-testid="stream-filter-history-button"
                @click="filterHistoryOpen = !filterHistoryOpen"
              >
                <CodiconIcon name="history" :size="13" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Filter history</TooltipContent>
          </Tooltip>
          <StreamFilterHistoryMenu
            v-if="filterHistoryOpen"
            :tab-id="tab.id"
            @apply="onApplyFromHistory"
            @close="filterHistoryOpen = false"
          />
        </div>
        <div class="filter-field">
          <div
            class="flex items-center gap-1 w-full h-control rounded-kira-sm border border-border-strong bg-field px-2"
          >
            <span
              class="shrink-0 text-kira-xs"
              :class="tab.state.offsetFilter ? 'text-state-on' : 'text-muted-foreground'"
              >offset</span
            >
            <Input
              :model-value="offsetText"
              placeholder="e.g. 1000"
              class="h-full w-full border-0 bg-transparent p-0 font-data focus-visible:ring-0"
              data-testid="stream-filter-offset"
              @update:model-value="(v) => (offsetText = String(v))"
              @keydown.enter="onApplyFilter"
              @blur="onApplyFilter"
            />
          </div>
        </div>
        <div class="partition-anchor">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                ref="partitionTriggerEl"
                variant="toolbar"
                size="kira"
                data-testid="stream-filter-partition"
                :class="selectedPartitions.length ? 'text-state-on' : ''"
                @click="onTogglePartitionMenu"
              >
                <CodiconIcon name="filter" :size="13" />
                {{ partitionButtonLabel }}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Filter by partition</TooltipContent>
          </Tooltip>
          <Popover :open="partitionMenuOpen" @update:open="(v) => (partitionMenuOpen = v)">
            <PopoverAnchor :reference="(partitionTriggerEl?.$el as HTMLElement) ?? undefined" class="hidden" />
            <PopoverContent align="start" class="w-52 p-0" data-testid="stream-partition-menu">
              <div class="partition-menu">
                <div v-if="partitionOptionsLoading" class="text-kira-sm text-muted-foreground partition-menu-empty">
                  Loading…
                </div>
                <div
                  v-else-if="partitionOptions.length === 0"
                  class="text-kira-sm text-muted-foreground partition-menu-empty"
                >
                  No partitions
                </div>
                <Label
                  v-for="p in partitionOptions"
                  :key="p"
                  class="partition-option"
                  :data-testid="`stream-filter-partition-option-${p}`"
                >
                  <Checkbox
                    class="size-3.5"
                    :model-value="isPartitionSelected(p)"
                    @update:model-value="onTogglePartition(p)"
                  >
                    <CodiconIcon name="check" :size="10" />
                  </Checkbox>
                  <span>partition {{ p }}</span>
                </Label>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div class="timestamp-filter-field">
          <div class="ts-input-row">
            <Tooltip :disabled="!timestampError">
              <TooltipTrigger as-child>
                <div
                  class="flex items-center gap-1 w-40 h-control rounded-kira-sm border bg-field px-2"
                  :class="timestampError ? 'border-error' : 'border-border-strong'"
                >
                  <span
                    class="shrink-0 text-kira-xs"
                    :class="tab.state.timestampFilter ? 'text-state-on' : 'text-muted-foreground'"
                    >since</span
                  >
                  <Input
                    :model-value="timestampText"
                    placeholder="ISO timestamp"
                    class="h-full w-full border-0 bg-transparent p-0 font-data focus-visible:ring-0"
                    data-testid="stream-filter-timestamp"
                    @update:model-value="(v) => (timestampText = String(v))"
                    @keydown.enter="onApplyFilter"
                    @blur="onApplyFilter"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>{{ timestampError }}</TooltipContent>
            </Tooltip>
            <span class="ts-calendar-anchor">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    ref="timestampCalendarTriggerEl"
                    variant="toolbar"
                    size="kira-icon"
                    aria-label="Pick a date and time"
                    data-testid="stream-filter-timestamp-calendar"
                    @click="timestampCalendarOpen = !timestampCalendarOpen"
                  >
                    <CodiconIcon name="calendar" :size="13" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Pick a date and time</TooltipContent>
              </Tooltip>
              <Popover :open="timestampCalendarOpen" @update:open="(v) => (timestampCalendarOpen = v)">
                <PopoverAnchor :reference="(timestampCalendarTriggerEl?.$el as HTMLElement) ?? undefined" class="hidden" />
                <PopoverContent
                  align="start"
                  class="w-56 p-0"
                  data-testid="stream-filter-timestamp-calendar-popover"
                >
                  <DateTimePicker :model-value="timestampPickerDate" zone="local" @update:model-value="onPickTimestamp" />
                </PopoverContent>
              </Popover>
            </span>
          </div>
          <span
            v-if="timestampError"
            class="filter-field-error"
            data-testid="stream-filter-timestamp-error"
            >{{ timestampError }}</span
          >
        </div>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="toolbar" size="kira" data-testid="stream-filter-clear" @click="onClearFilter">
              Clear
            </Button>
          </TooltipTrigger>
          <TooltipContent>Empty every field and refetch</TooltipContent>
        </Tooltip>
    </div>

    <!-- The one destructive truth of this view, stated once at the top. -->
    <Alert v-if="isBatch" class="strip-warn" data-testid="stream-poll-warning">
      <CodiconIcon name="warning" :size="13" class="strip-warn-text" />
      <AlertDescription class="strip-warn-text">
        Each poll <b>consumes</b> messages from the queue (subject to the visibility timeout
        above) — it does not browse a stable position.
      </AlertDescription>
    </Alert>

    <Alert v-if="rt?.status === 'error' && rt.error" class="strip-err" data-testid="stream-error">
      <CodiconIcon name="error" :size="13" class="strip-err-text" />
      <AlertDescription class="strip-err-text">{{ rt.error.message }}</AlertDescription>
    </Alert>

    <!-- P43 F6/D7: a failed SQS delete, distinct from a failed load above. -->
    <Alert v-if="rt?.actionError" class="strip-err" data-testid="stream-action-error">
      <CodiconIcon name="error" :size="13" class="strip-err-text" />
      <AlertDescription class="strip-err-text">{{ rt.actionError }}</AlertDescription>
    </Alert>

    <StreamSearchToolbar
      v-if="rt?.searchOpen"
      :tab-id="tab.id"
      @go-to-match="onGoToMatch"
      @close="onCloseSearch"
    />

    <!-- Item 4: the reconnect gate used to replace this whole ViewChrome (header, toolbar and
         all) — every other view but the grid's DataView.vue did the same, the one inconsistency
         this fixes. The chrome above (and so its toolbar rows) now always renders; only the body
         — the part that actually needs a live connection — swaps for the gate. -->
    <div v-if="needsReconnect" class="p-empty" data-testid="stream-reconnect">
      <Button variant="dialog-primary" size="kira-lg" data-testid="stream-reconnect-load" @click="onReconnectAndLoad">
        Reconnect & load
      </Button>
    </div>
    <template v-else>
    <div class="list-body" data-testid="stream-list">
      <Alert
        v-if="isBatch && !rt?.polled"
        class="no-rows flex-col items-center justify-center gap-1.5 border-0 bg-transparent text-center"
      >
        <CodiconIcon name="arrow-swap" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md font-normal text-muted-foreground">Click Poll to fetch messages</AlertTitle>
      </Alert>
      <Alert
        v-else-if="!rt || rt.rowCount === 0"
        class="no-rows flex-col items-center justify-center gap-1.5 border-0 bg-transparent text-center"
      >
        <CodiconIcon name="inbox" :size="24" class="text-subtle" />
        <AlertTitle v-if="rt" class="text-kira-md font-normal text-muted-foreground">No messages</AlertTitle>
      </Alert>
      <!-- P31 D19 (P24 D8's precedent): filtering to zero matches is a distinct empty state
           from "no messages loaded". -->
      <Alert
        v-else-if="displayRows && displayRows.length === 0"
        class="no-rows flex-col items-center justify-center gap-1.5 border-0 bg-transparent text-center"
        data-testid="stream-no-matching-rows"
      >
        <CodiconIcon name="search" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md font-normal text-muted-foreground">No matching rows</AlertTitle>
        <AlertAction class="static mt-1 flex flex-col items-center gap-1.5">
          <Button
            variant="toolbar"
            size="kira"
            data-testid="stream-show-all-rows"
            @click="pageSearchFilterStore.setSearchFiltering(tab.id, false)"
          >
            Show all rows
          </Button>
        </AlertAction>
      </Alert>
      <template v-else>
          <div class="p-thead">
            <div class="p-th gutter w-10" />
            <div class="p-th" :style="{ width: `${widthFor('key')}px` }">
              <span class="name">key</span>
              <KuiColumnResizeHandle
                class="resize-handle"
                draggable="false"
                data-testid="stream-column-resize-key"
                label="Resize key column"
                :value="widthFor('key')"
                :min="40"
                @update:value="(w) => onResizeLive('key', w)"
                @change="(w) => onResizeCommit('key', w)"
                @cancel="() => onResizeCancel('key')"
                @click.stop
              />
            </div>
            <div class="p-th" :style="{ width: `${widthFor('timestamp')}px` }">
              <span class="name">timestamp</span>
              <KuiColumnResizeHandle
                class="resize-handle"
                draggable="false"
                data-testid="stream-column-resize-timestamp"
                label="Resize timestamp column"
                :value="widthFor('timestamp')"
                :min="40"
                @update:value="(w) => onResizeLive('timestamp', w)"
                @change="(w) => onResizeCommit('timestamp', w)"
                @cancel="() => onResizeCancel('timestamp')"
                @click.stop
              />
            </div>
            <div class="p-th" :style="{ width: `${widthFor('headers')}px` }">
              <span class="name">headers</span>
              <KuiColumnResizeHandle
                class="resize-handle"
                draggable="false"
                data-testid="stream-column-resize-headers"
                label="Resize headers column"
                :value="widthFor('headers')"
                :min="40"
                @update:value="(w) => onResizeLive('headers', w)"
                @change="(w) => onResizeCommit('headers', w)"
                @cancel="() => onResizeCancel('headers')"
                @click.stop
              />
            </div>
            <div class="p-th" :style="{ width: `${widthFor('attrs')}px` }">
              <span class="name">attrs</span>
              <KuiColumnResizeHandle
                class="resize-handle"
                draggable="false"
                data-testid="stream-column-resize-attrs"
                label="Resize attrs column"
                :value="widthFor('attrs')"
                :min="40"
                @update:value="(w) => onResizeLive('attrs', w)"
                @change="(w) => onResizeCommit('attrs', w)"
                @cancel="() => onResizeCancel('attrs')"
                @click.stop
              />
            </div>
            <div class="p-th flex-1"><span class="name">body</span></div>
          </div>
          <div
            ref="scrollEl"
            class="tbody-scroll"
            data-testid="virtual-list"
            role="listbox"
            aria-label="Stream rows"
            @scroll="onScroll"
          >
            <div :style="{ height: `${totalSize}px`, position: 'relative' }">
              <div
                v-for="vi in virtualItems"
                :key="String(vi.key)"
                class="stream-row virtual-row"
                data-testid="stream-row"
                :data-row-index="rowIndices[vi.index]"
                :style="{ transform: `translateY(${vi.start}px)`, height: `${vi.size}px` }"
                :class="{
                  selected: rt?.selectedRow === rowIndices[vi.index],
                  'search-match': matchSet.has(rowIndices[vi.index]),
                  'search-match-current': currentMatchRow === rowIndices[vi.index],
                }"
              >
                <div
                  class="p-td gutter w-10"
                  role="option"
                  tabindex="0"
                  :aria-selected="rt?.selectedRow === rowIndices[vi.index]"
                  @click="onRowClickFromEvent"
                  @keydown="onRowKeydownFromEvent"
                >
                  {{ rowIndices[vi.index] + 1 }}
                </div>
                <div
                  class="p-td"
                  :class="cellClass({ isNull: rowAt(rowIndices[vi.index])?.key === null })"
                  :style="{ width: `${widthFor('key')}px` }"
                  data-testid="stream-key"
                  role="option"
                  tabindex="0"
                  :aria-selected="rt?.selectedRow === rowIndices[vi.index]"
                  @click="onKeyCellClickFromEvent"
                  @keydown="onCellKeydownFromEvent($event, 'key')"
                >
                  {{ rowAt(rowIndices[vi.index])?.key ?? '(none)' }}
                </div>
                <div
                  class="p-td"
                  :style="{ width: `${widthFor('timestamp')}px` }"
                  data-testid="stream-timestamp"
                  role="option"
                  tabindex="0"
                  :aria-selected="rt?.selectedRow === rowIndices[vi.index]"
                  @click="onTimestampCellClickFromEvent"
                  @keydown="onCellKeydownFromEvent($event, 'timestamp')"
                >
                  {{ rowAt(rowIndices[vi.index])?.timestamp ?? '' }}
                </div>
                <div
                  class="p-td"
                  :style="{ width: `${widthFor('headers')}px` }"
                  data-testid="stream-headers"
                  role="option"
                  tabindex="0"
                  :aria-selected="rt?.selectedRow === rowIndices[vi.index]"
                  @click="onHeadersCellClickFromEvent"
                  @keydown="onCellKeydownFromEvent($event, 'headers')"
                >
                  {{ rowAt(rowIndices[vi.index])?.headers }}
                </div>
                <div
                  class="p-td"
                  :style="{ width: `${widthFor('attrs')}px` }"
                  data-testid="stream-attrs"
                  role="option"
                  tabindex="0"
                  :aria-selected="rt?.selectedRow === rowIndices[vi.index]"
                  @click="onAttrsCellClickFromEvent"
                  @keydown="onCellKeydownFromEvent($event, 'attrs')"
                >
                  {{ rowAt(rowIndices[vi.index])?.attrs }}
                </div>
                <div
                  class="p-td msg-body flex-1"
                  data-testid="stream-body"
                  role="option"
                  tabindex="0"
                  :aria-selected="rt?.selectedRow === rowIndices[vi.index]"
                  @click="onBodyCellClickFromEvent"
                  @keydown="onCellKeydownFromEvent($event, 'body')"
                >
                  {{ rowAt(rowIndices[vi.index])?.body }}
                  <Tooltip v-if="rowAt(rowIndices[vi.index])?.isTruncated">
                    <TooltipTrigger as-child>
                      <span class="text-kira-xs text-muted-foreground">(truncated)</span>
                    </TooltipTrigger>
                    <TooltipContent>body truncated</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
      </template>
    </SplitterPanel>
    <SplitterResizeHandle v-if="hasCellDock" class="cell-splitter" :hit-area-margins="{ coarse: 8, fine: 4 }" />
    <CellEditorDock :tab-id="tab.id" :read-only="true" />
    </SplitterGroup>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.stream-view {
  @apply h-full flex flex-col min-h-0;
}

/* P104: the SplitterGroup wrapping the inlined header+toolbar chrome + CellEditorDock.vue's own
   dock panel — the vertical split (row-resize) that used to be CellEditorDock's own internal
   PanelSplitter. */
.stream-split {
  @apply flex flex-1 min-h-0 flex-col;
}

.stream-split-top {
  @apply flex flex-col min-h-0;
}

.cell-splitter {
  @apply shrink-0 h-1 cursor-row-resize bg-transparent hover:bg-focus data-[state='drag']:bg-focus;
  box-shadow: inset 0 calc(var(--kira-border-width) * -1) 0 0 var(--kira-border);
}
.cell-splitter:hover,
.cell-splitter[data-state='drag'] {
  box-shadow: none;
}

/* view header: 28px, connection colour appears only as the dot (LAW — see template comment) */
.path {
  @apply text-subtle;
}

/* Wraps the "Add message" trigger button and its Popover — P104 §3: reka's PopoverAnchor takes
   the trigger's real DOM node via an explicit `:reference`, so this wrapper no longer does the
   positioning work Task #64's PopoverPanel needed; kept only as the trigger's layout box. */
.add-message-anchor {
  @apply relative;
}

/* tabular body shared shape (P16's .thead/.th/.td law) — .p-thead/.p-th/.p-td come from
   primitives.css; the flex row container and the scrolling wrapper around it are local glue,
   same as the source design's own (unshared) .tbody/.tr rules. */
.tbody-scroll {
  @apply flex-1 min-h-0 overflow-auto;
}

.virtual-row {
  @apply absolute top-0 left-0 w-full;
}

/* GenerateDataDialog.vue's own local warn-strip pattern, reused here since Alert's `destructive`
   variant assumes an `<svg>` icon child (`has-[>svg]:grid-cols-[auto_1fr]`) — CodiconIcon isn't
   one. .strip-err is the same shape on the error tone (that dialog has no error-tone strip of its
   own to mirror). */
.strip-warn {
  @apply bg-warn/10 border-warn/20;
}
.strip-warn-text {
  @apply text-warn-text;
}

.strip-err {
  @apply bg-error/10 border-error/20;
}
.strip-err-text {
  @apply text-error;
}

.stream-row {
  /* P49 F7/D5: previously unset (sized off whatever text a cell happened to hold) — now fixed,
     matching the density-driven rowHeight computed VirtualList's offset math needs. */
  @apply flex border-b border-border cursor-pointer h-row;
}

.stream-row:hover {
  @apply bg-hover;
}

.stream-row.selected {
  @apply bg-hover;
}

/* P31 D21: adopts the same color-mix tint / solid-current pair as KeyValueView.vue (and the
   deleted DataGrid.vue), replacing the inset bar so all four search-capable views agree. */
.stream-row.search-match {
  background: var(--kira-search-match);
}

.stream-row.search-match-current {
  @apply text-bg;
  background: var(--kira-search-match-current);
}

/* body column: monospace and slightly muted, matching the mockup's `.msg-body` */
.msg-body {
  @apply text-muted-foreground text-kira-sm font-data;
}

.list-body {
  /* Positioning context for the EmptyState siblings below (`.no-rows` class, slickTheme.css's
     unscoped `position: absolute; inset: 0` rule) — without it inset:0 has no positioned ancestor
     anywhere up to <body>, so the placeholder expands to cover the whole app window instead of
     just this row list, intercepting pointer events app-wide (the tree sidebar included) whenever
     a stream view shows an empty state. Same fix SlickGridHost.vue already applies to its own
     `.slick-grid-host` for the identical shared class. */
  @apply relative flex-1 min-h-0 flex flex-col overflow-hidden;
}

.list-body .no-rows {
  @apply h-full;
}

.history-anchor,
.partition-anchor {
  @apply relative;
}

.filter-field {
  @apply w-40 shrink-0;
}

/* P31 D12/D13: the "since" field's own wrapper — not `.filter-field` (that class's fixed 160px
   width and 100%-wide input are sized for a single bare TextField; this one also carries a
   calendar trigger beside the input and an error line below it). */
.timestamp-filter-field {
  @apply flex flex-col gap-0.5 shrink-0;
}

.ts-input-row {
  @apply flex items-center gap-0.5;
}

.ts-calendar-anchor {
  @apply relative shrink-0;
}

.filter-field-error {
  @apply whitespace-nowrap text-error text-kira-xs;
}

/* Item 1's partition checkbox list — mirrors ColumnsMenu.vue's own list-inside-a-PopoverPanel shape. */
.partition-menu {
  @apply flex flex-col max-h-60 overflow-y-auto gap-0.5 p-1;
}

.partition-menu-empty {
  @apply p-1;
}

.partition-option {
  @apply flex items-center gap-1 rounded-kira cursor-pointer py-0.5 px-1;
}

.partition-option:hover {
  @apply bg-hover;
}

/* Item 4: a resize handle on the right edge of the four fixed-width header cells (mirrors the
   deleted DataGrid.vue's own `.header-cell`/`.resize-handle` pair — SlickGrid resizes its own
   columns natively now, so this hand-rolled pattern survives only here) — `.p-th` needs
   `position: relative` as its positioning context, scoped here rather than in primitives.css
   since it's a stream-only affordance (grid/keyvalue/console reuse `.p-th` too but never resize it
   this way). Unlike the deleted DataGrid.vue's `.header-cell` (no overflow rule of its own),
   primitives.css's shared `.p-th` sets `overflow: hidden` — `right: 0` (rather than DataGrid's
   `right: -2px`) keeps the whole 4px handle inside `.p-th`'s own box instead of half-clipped by
   that overflow. */
.p-th {
  @apply relative;
}

.resize-handle {
  @apply absolute top-0 right-0 w-1 h-full cursor-col-resize z-1;
}
</style>
