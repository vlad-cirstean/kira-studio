<script setup lang="ts">
import type { DataTabRecord, PageSize } from '@shared/domain/tabs';
import { computed, ref, watch } from 'vue';
import { connectionRecord, connectionsState } from '../../state/connections';
import IconButton from '../../theme/primitives/IconButton.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import TextField from '../../theme/primitives/TextField.vue';
import { pageSizeOptions } from '../shared/page/sizes';
import ColumnsMenu from './ColumnsMenu.vue';
import { getPage } from './page';
import { addInsertRow, discardInsertRow, pendingFor, toggleDelete } from './pendingChanges';
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

// The 4 mutation buttons (add/delete) are gated on writability alone — never on whether the table
// has a primary key. A no-PK table still rejects at the per-cell edit level (readOnlyReasonFor)
// and at the server (assertKeyIsPrimaryKey); gating the toolbar too would just be a second,
// redundant guard.
const isWritable = computed(
  () => !!caps.value?.writable && !connectionRecord(props.tab.connectionId)?.readOnly,
);

// P36 D26: the − row button's own gate — ClickHouse is writable (canInsert: true) but has no
// addressable row to DELETE (a MergeTree PRIMARY KEY is a sparse index, not a unique key), so
// isWritable alone is no longer enough to offer this button.
const canDeleteRows = computed(() => isWritable.value && !!caps.value?.canDelete);
const deleteRowTooltip = computed(() => {
  if (canDeleteRows.value) return 'Delete selected row(s)';
  if (!isWritable.value) return 'Connection is read-only';
  return 'This connection does not support deleting rows';
});

const pageDisplay = computed(() => props.tab.state.pageIndex + 1);

// A plain `:value="pageDisplay"` fights the user's typing: any unrelated reactive read this
// component makes (rt.value's status/count/etc.) forces a re-render, and Vue reasserts the bound
// value on the DOM input regardless of whether pageDisplay itself changed — wiping out whatever
// the user has typed but not yet committed. Mirroring it through its own ref, kept in sync with
// pageDisplay only when the page actually advances, avoids the fight.
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
function onCount(): void {
  void runCount(props.tab.id);
}
function onPageSize(size: PageSize): void {
  void setPageSize(props.tab.id, size);
}
function onJump(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value);
  if (Number.isFinite(value) && value >= 1) {
    void goToPage(props.tab.id, value - 1);
  }
}
function onToggleSearch(): void {
  toggleSearchOpen(props.tab.id);
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

// A selected row/cell/range at or beyond the page's real row count addresses an appended
// pending-insert row (DataGrid.vue's synthetic row indices) — deleting one of those discards it
// outright rather than staging a delete op that could never resolve to a real primary key.
function onDeleteRow(): void {
  const r = runtime[props.tab.id];
  const sel = r?.selection;
  if (!sel) return;
  const p = getPage(props.tab.id);
  const rowCount = p?.rowCount ?? 0;

  let rows: number[];
  if (sel.kind === 'row') rows = sel.rows;
  else if (sel.kind === 'cell') rows = [sel.row];
  else if (sel.kind === 'range') {
    const [r0, r1] = [sel.anchorRow, sel.row].sort((a, b) => a - b);
    rows = Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i);
  } else return;

  const realRows = rows.filter((row) => row < rowCount);
  if (realRows.length) toggleDelete(props.tab.id, realRows);

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

  <!-- FIX-1: absolute-position pager, kept as a jump-to-page input (D7's cursor/offset paging
       has no notion of "row 1–200" to display without the count query having already run). -->
  <div class="group pager" data-testid="pager" :data-pagination="rt?.lastStrategy">
    <IconButton
      icon="chevron-left"
      v-tooltip="'First page'"
      data-testid="pager-first"
      :disabled="tab.state.pageIndex === 0"
      @click="onFirst"
    />
    <IconButton
      icon="chevron-left"
      v-tooltip="'Previous page'"
      data-testid="pager-prev"
      :disabled="tab.state.pageIndex === 0"
      @click="onPrev"
    />
    <span class="page-label p-sm muted">
      page
      <div class="page-input">
        <TextField
          v-model="pageInputValue"
          type="number"
          min="1"
          hide-stepper
          data-testid="pager-page-input"
          @change="onJump"
        />
      </div>
      <template v-if="pageCount"> of {{ pageCount }}</template>
    </span>
    <IconButton
      icon="chevron-right"
      v-tooltip="'Next page'"
      data-testid="pager-next"
      :disabled="!rt?.hasMore"
      @click="onNext"
    />
    <IconButton
      icon="chevron-right"
      v-tooltip="pageCount ? 'Last page' : 'Count rows first'"
      data-testid="pager-last"
      :disabled="!pageCount"
      @click="onLast"
    />
  </div>

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
   p-seg, p-input, p-chip, p-count) — only the bits those primitives don't cover (the pager's own
   layout, the page-jump input's width, live/stale colour states) live here. */

.pager {
  gap: var(--kira-s-1);
}

.page-label {
  display: inline-flex;
  align-items: center;
  gap: var(--kira-s-1);
  white-space: nowrap;
}

/* TextField's root <span class="p-input"> only receives fallthrough attrs on its inner <input>
   (see TextField.vue's inheritAttrs:false), so the fixed width and centred text live on this
   wrapper/its :deep() descendants instead of a class/style on the <TextField> tag itself
   (DocumentView.vue's same `.filter-field` precedent). */
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

.columns-anchor {
  position: relative;
}
</style>
