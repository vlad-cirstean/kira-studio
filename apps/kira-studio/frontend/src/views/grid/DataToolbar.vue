<script setup lang="ts">
import type { DataTabRecord, PageSize } from '@shared/domain/tabs';
import { computed, ref } from 'vue';
import { connectionRecord, connectionsState } from '../../state/connections';
import { openGenerateDataDialog } from '../../state/fakeData';
import IconButton from '../../theme/primitives/IconButton.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import PagerControls from '../shared/page/PagerControls.vue';
import { pageSizeOptions } from '../shared/page/sizes';
import ColumnsMenu from './ColumnsMenu.vue';
import { canGenerateDataFor } from './fakeData/generate';
import { getPage, pageVersion } from './page';
import { addInsertRow, discardInsertRow, pendingFor, stageDelete } from './pendingChanges';
import { matchedRows } from './search';
import { rowsForSelection } from './slick/rowValues';
import {
  goFirst,
  goLast,
  goNext,
  goPrev,
  goToPage,
  runCount,
  runtime,
  setPageSize,
  toggleSearchOpen,
} from './state';

// P48 D10: takes `tab` as a prop like every other view's toolbar, rather than reading the
// nullable, globally-computed activeDataTab — this component only ever renders while its tab is
// the active one (DataView.vue's own v-else-if chain), so the two agreed in practice, but the
// nullable-tab plumbing this used to need (fourteen `if (!tab.value) return` guards) existed only
// because of the divergence, not a real case.
const props = defineProps<{ tab: DataTabRecord }>();

// P24 D30: SegmentedControl's generic now covers a numeric union too, so this hand-rolled .p-seg
// (kept only because two leaks.spec.ts assertions read .active, since fixed) can be the primitive.
const PAGE_SIZE_OPTIONS = pageSizeOptions('');

const rt = computed(() => runtime[props.tab.id]);

const caps = computed(() => {
  const connectionId = props.tab.connectionId;
  return connectionId ? (connectionsState.states[connectionId]?.caps ?? null) : null;
});

// Add is gated on writability alone — never on whether the table has a primary key. A no-PK table
// still rejects at the per-cell edit level (readOnlyReasonFor) and at the server
// (assertKeyIsPrimaryKey); gating that button too would just be a second, redundant guard.
// Delete is different, and P28 D8 separates the two: it has no per-cell rejection path to fall
// through to — it stages straight into pendingChanges — so an unactionable click there is silent.
const isWritable = computed(
  () => !!caps.value?.writable && !connectionRecord(props.tab.connectionId)?.readOnly,
);

// P36 D26: the − row button's own gate — ClickHouse is writable (canInsert: true) but has no
// addressable row to DELETE (a MergeTree PRIMARY KEY is a sparse index, not a unique key), so
// isWritable alone is no longer enough to offer this button.
// P28 D8: also gated on a selection and a primary key. onDeleteRow below opens with
// `if (!sel) return`, and stageDelete stages an op that can never resolve without a primary key
// — so before this the button was enabled and silently inert in both cases, which is the reported
// "deleting selected rows doesn't work at all". SlickGridHost's own canDeleteRows() has always
// required hasPrimaryKey; this is the same predicate, plus the selection the toolbar needs and the
// grid's own context menu does not (it acts on the row that was right-clicked).
// `runtime` is a real reactive() map (views/shared/viewOp.ts), so this needs no version read —
// unlike hasPrimaryKey below, whose getPage() reads a plain Map and depends on pageVersion.n.
const hasSelection = computed(() => !!runtime[props.tab.id]?.selection);
const hasPrimaryKey = computed(() => {
  void pageVersion.n;
  return getPage(props.tab.id)?.columns.some((c) => c.isPrimaryKey) ?? false;
});
const canDeleteRows = computed(
  () => isWritable.value && !!caps.value?.canDelete && hasPrimaryKey.value && hasSelection.value,
);
// P28 D8: a disabled control names the actual condition rather than just going grey —
// KeyValueView.vue's own standing rule ("the actual number or the actual condition, never a
// silently-disabled control with no explanation"). Ordered most-fundamental first: a read-only
// connection or an engine that cannot delete is a property of the connection, a missing primary
// key a property of the table, and an empty selection the one the user can act on right now.
const deleteRowTooltip = computed(() => {
  if (canDeleteRows.value) return 'Delete selected row(s)';
  if (!isWritable.value) return 'Connection is read-only';
  if (!caps.value?.canDelete) return 'This connection does not support deleting rows';
  if (!hasPrimaryKey.value) return 'This table has no primary key, so a row cannot be addressed';
  return 'Select one or more rows first';
});

const canGenerateData = computed(() =>
  canGenerateDataFor(caps.value, connectionRecord(props.tab.connectionId)?.readOnly),
);
const generateDataTooltip = computed(() => {
  if (canGenerateData.value) return 'Generate data…';
  if (connectionRecord(props.tab.connectionId)?.readOnly) return 'Connection is read-only';
  return 'This connection does not support generating rows';
});

function onFirst(): void {
  void goFirst(props.tab.id);
}
function onPrev(): void {
  void goPrev(props.tab.id);
}
function onNext(): void {
  void goNext(props.tab.id);
}
function onLast(): void {
  void goLast(props.tab.id);
}
function onJump(pageIndex: number): void {
  void goToPage(props.tab.id, pageIndex);
}
function onCount(): void {
  void runCount(props.tab.id);
}
function onPageSize(size: PageSize): void {
  void setPageSize(props.tab.id, size);
}
function onToggleSearch(): void {
  toggleSearchOpen(props.tab.id);
}
function onGenerateData(): void {
  if (!canGenerateData.value) return;
  openGenerateDataDialog(props.tab.id);
}

const columnsOpen = ref(false);

// P16 design system's p-badge on the Columns button: "selected / total" — both counts already
// live on data this component reads anyway (the projection list and the describe-derived meta),
// so this is a display-only derivation, not a new data source.
const columnCountLabel = computed(() => {
  const total = rt.value?.meta?.columns.length;
  if (!total) return null;
  const projection = props.tab.state.projection;
  return `${projection ? projection.length : total} / ${total}`;
});

// P31 D38/F35: the Columns button's own corner mark — shown only when the tab's column set
// deviates from default (some columns hidden, or the order was dragged), so the icon stays clean
// until there's actually something to flag. A plain dot, not a count: "5 / 5" (every column still
// shown, only the order changed) reads as a count that says nothing, and a four-character label
// in a 22px button's corner was never going to fit regardless of which deviation triggered it —
// the exact numbers already live in the tooltip below (columnCountLabel), which is where every
// other detail in this icon-only toolbar lives.
const columnsIndicator = computed(() => {
  const state = props.tab.state;
  return state.projection !== null || state.columnOrder !== null;
});

function onAddRow(): void {
  const p = getPage(props.tab.id);
  if (!p) return;
  // P36 D28: a generated column is never seeded — the server computes it, and an explicit NULL
  // for it would make the insert fail outright on an engine that enforces this (F18).
  addInsertRow(
    props.tab.id,
    p.columns.filter((c) => !c.generated).map((c) => c.name),
  );
}

// A selected row/cell/range/column at or beyond the page's real row count addresses an appended
// pending-insert row (DataGrid.vue's synthetic row indices) — deleting one of those discards it
// outright rather than staging a delete op that could never resolve to a real primary key.
//
// Real-interaction fix (§4b/§4d): this used to hand-roll its own row/cell/range switch — a third
// copy of the same conversion SlickGridHost.vue's onKeydown and onGridContextMenu each used to
// hand-roll too — and, like both of those, never grew a `column` branch, so this button did
// nothing for a column selection. Routed through `rowsForSelection` (slick/rowValues.ts) now, the
// same one every other "act on the current selection" call site uses, so a selection kind newly
// needs coverage exactly once, not here as well.
function onDeleteRow(): void {
  const r = runtime[props.tab.id];
  const sel = r?.selection;
  if (!sel) return;
  const p = getPage(props.tab.id);
  const rowCount = p?.rowCount ?? 0;
  const rows = rowsForSelection(sel, matchedRows(props.tab.id), rowCount);

  const realRows = rows.filter((row) => row < rowCount);
  if (realRows.length) stageDelete(props.tab.id, realRows);

  const inserts = pendingFor(props.tab.id)?.inserts ?? [];
  for (const row of rows.filter((row) => row >= rowCount)) {
    const insert = inserts[row - rowCount];
    if (insert) discardInsertRow(props.tab.id, insert.id);
  }
}
</script>

<template>
  <!-- LAW 01/10: ViewChrome's own Refresh/Stop group renders ahead of this slot's content, so
       the leading sep below matches every other view's #toolbar (KeyValueView.vue,
       DocumentView.vue) rather than assuming its own hand-rolled equivalent (F1/F3). -->
  <div class="sep" />

  <!-- P28 D7 reverts P16 D1 (commit d2892f49, which moved this to DataView.vue's #toolbar-end)
       by user report: navigation belongs beside the page-size picker it pages through, at the
       toolbar's reading edge, not alone at the far right. The pager is a jump-to-page input rather
       than a "row 1-200 of N" readout — D7's cursor/offset paging has no notion of that until the
       count query has run. Deliberately not applied to DocumentView.vue, whose pager d2892f49
       never touched and whose placement was not reported. -->
  <PagerControls
    :page-index="tab.state.pageIndex"
    :page-size="tab.state.pageSize"
    :count="rt?.count?.value ?? null"
    :has-more="!!rt?.hasMore"
    testid-prefix=""
    last-tooltip="Count rows first"
    :strategy="rt?.lastStrategy"
    @first="onFirst"
    @prev="onPrev"
    @next="onNext"
    @last="onLast"
    @jump="onJump"
  />

  <SegmentedControl
    :model-value="tab.state.pageSize"
    :options="PAGE_SIZE_OPTIONS"
    data-testid="page-size-picker"
    @update:model-value="onPageSize"
  />

  <div class="sep" />

  <div class="group">
    <IconButton
      icon="symbol-number"
      data-testid="toolbar-count"
      :style="rt?.count?.stale ? { color: 'var(--kira-warn)' } : undefined"
      v-tooltip="
        rt?.count
          ? `Count all rows — Σ ${rt.count.exact ? '' : '~'}${rt.count.value.toLocaleString()}${rt.count.stale ? ' (stale, click to refresh)' : ''}`
          : 'Count all rows'
      "
      @click="onCount"
    />

    <div class="columns-anchor">
      <IconButton
        icon="list-selection"
        data-testid="toolbar-columns"
        :indicator="columnsIndicator"
        :active="columnsOpen"
        v-tooltip="columnCountLabel ? `Columns — ${columnCountLabel} shown` : 'Columns'"
        @click="columnsOpen = !columnsOpen"
      />
      <ColumnsMenu v-if="columnsOpen" :tab-id="tab.id" :caps="caps" @close="columnsOpen = false" />
    </div>
  </div>

  <div class="sep" />

  <div class="group">
    <IconButton
      icon="add"
      data-testid="toolbar-add-row"
      :disabled="!isWritable"
      v-tooltip="isWritable ? 'Add a row' : 'Connection is read-only'"
      @click="onAddRow"
    />
    <IconButton
      icon="wand"
      data-testid="toolbar-generate-data"
      :disabled="!canGenerateData"
      v-tooltip="generateDataTooltip"
      @click="onGenerateData"
    />
    <IconButton
      icon="trash"
      data-testid="toolbar-delete-row"
      :disabled="!canDeleteRows"
      v-tooltip="deleteRowTooltip"
      @click="onDeleteRow"
    />
    <IconButton
      icon="search"
      :active="!!rt?.searchOpen"
      v-tooltip="'Search this page'"
      data-testid="toolbar-search"
      @click="onToggleSearch"
    />
  </div>
</template>

<style scoped>
/* Sizing/spacing/colour all come from .p-toolbar and the primitives it hosts (p-iconbtn, p-btn,
   p-seg, p-input, p-chip, p-count) — the pager's own layout/page-jump-input styling lives in
   PagerControls.vue now; only the columns anchor's positioning is left here. */

.columns-anchor {
  position: relative;
}
</style>
