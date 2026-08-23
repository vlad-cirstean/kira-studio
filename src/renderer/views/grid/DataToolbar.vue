<script setup lang="ts">
import type { DataTabState } from '@shared/domain/tabs';
import { computed, ref, watch } from 'vue';
import { connectionsState } from '../../state/connections';
import { activeDataTab } from '../../state/tabs';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';
import ColumnsMenu from './ColumnsMenu.vue';
import PreviewCommandPanel from './PreviewCommandPanel.vue';
import { getPage } from './page';
import {
  addInsertRow,
  commitPending,
  discardInsertRow,
  discardPending,
  hasPending,
  pendingFor,
  toggleDelete,
} from './pendingChanges';
import {
  goFirst,
  goLast,
  goNext,
  goPrev,
  goToPage,
  reload,
  reloadAfterMutation,
  runCount,
  runtime,
  setPageSize,
  stop,
} from './state';

const PAGE_SIZES: DataTabState['pageSize'][] = [10, 100, 1000, 10000];
const PAGE_SIZE_LABEL: Record<DataTabState['pageSize'], string> = {
  10: '10',
  100: '100',
  1000: '1k',
  10000: '10k',
};

const tab = computed(() => activeDataTab.value);
const rt = computed(() => (tab.value ? runtime[tab.value.id] : undefined));

const caps = computed(() => {
  const connectionId = tab.value?.connectionId;
  return connectionId ? (connectionsState.states[connectionId]?.caps ?? null) : null;
});

// The 5 mutation buttons (add/delete/preview/commit/discard) are gated on writability alone —
// never on whether the table has a primary key. A no-PK table still rejects at the per-cell
// edit level (readOnlyReasonFor) and at the server (assertKeyIsPrimaryKey); gating the toolbar
// too would just be a second, redundant guard.
const isWritable = computed(() => {
  const connectionId = tab.value?.connectionId;
  const record = connectionId ? connectionsState.records.find((r) => r.id === connectionId) : null;
  return !!caps.value?.writable && !record?.readOnly;
});

const tabHasPending = computed(() => (tab.value ? hasPending(tab.value.id) : false));

const previewOpen = ref(false);

const pageDisplay = computed(() => (tab.value ? tab.value.state.pageIndex + 1 : 1));

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
  const size = tab.value?.state.pageSize;
  if (!count || !size) return null;
  return Math.max(1, Math.ceil(count.value / size));
});

function onRefresh(): void {
  if (tab.value) void reload(tab.value.id);
}
function onFirst(): void {
  if (tab.value) void goFirst(tab.value.id);
}
function onPrev(): void {
  if (tab.value) void goPrev(tab.value.id);
}
function onNext(): void {
  if (tab.value) void goNext(tab.value.id);
}
function onLast(): void {
  if (tab.value) void goLast(tab.value.id);
}
function onCount(): void {
  if (tab.value) void runCount(tab.value.id);
}
function onStop(): void {
  if (tab.value) stop(tab.value.id);
}
function onPageSize(size: DataTabState['pageSize']): void {
  if (tab.value) void setPageSize(tab.value.id, size);
}
function onJump(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value);
  if (tab.value && Number.isFinite(value) && value >= 1) {
    void goToPage(tab.value.id, value - 1);
  }
}
function onToggleSearch(): void {
  const r = tab.value ? runtime[tab.value.id] : undefined;
  if (r) r.searchOpen = !r.searchOpen;
}

const columnsOpen = ref(false);

// P16 design system's p-badge on the Columns button: "selected / total" — both counts already
// live on data this component reads anyway (the projection list and the describe-derived meta),
// so this is a display-only derivation, not a new data source.
const columnCountLabel = computed(() => {
  const total = rt.value?.meta?.columns.length;
  if (!total) return null;
  const projection = tab.value?.state.projection;
  return `${projection ? projection.length : total} / ${total}`;
});

// P16 design system's warn chip: "N rows edited" — the count is already tracked per-tab by
// pendingChanges.ts (edits + deletes + inserts), just not summed anywhere for display yet.
const pendingCount = computed(() => {
  const t = tab.value;
  const p = t ? pendingFor(t.id) : undefined;
  if (!p) return 0;
  return p.edits.size + p.deletes.size + p.inserts.length;
});

function onAddRow(): void {
  const t = tab.value;
  if (!t) return;
  const p = getPage(t.id);
  if (!p) return;
  addInsertRow(
    t.id,
    p.columns.map((c) => c.name),
  );
}

// A selected row/cell/range at or beyond the page's real row count addresses an appended
// pending-insert row (DataGrid.vue's synthetic row indices) — deleting one of those discards it
// outright rather than staging a delete op that could never resolve to a real primary key.
function onDeleteRow(): void {
  const t = tab.value;
  const r = t ? runtime[t.id] : undefined;
  const sel = r?.selection;
  if (!t || !sel) return;
  const p = getPage(t.id);
  const rowCount = p?.rowCount ?? 0;

  let rows: number[];
  if (sel.kind === 'row') rows = sel.rows;
  else if (sel.kind === 'cell') rows = [sel.row];
  else if (sel.kind === 'range') {
    const [r0, r1] = [sel.anchorRow, sel.row].sort((a, b) => a - b);
    rows = Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i);
  } else return;

  const realRows = rows.filter((row) => row < rowCount);
  if (realRows.length) toggleDelete(t.id, realRows);

  const inserts = pendingFor(t.id)?.inserts ?? [];
  for (const row of rows.filter((row) => row >= rowCount)) {
    const insert = inserts[row - rowCount];
    if (insert) discardInsertRow(t.id, insert.id);
  }
}

async function onCommit(): Promise<void> {
  const t = tab.value;
  if (!t?.connectionId) return;
  await commitPending(t.connectionId, t.path, t.id);
  await reloadAfterMutation(t.id);
}

function onDiscard(): void {
  const t = tab.value;
  if (t) discardPending(t.id);
}
</script>

<template>
  <div v-if="tab" class="data-toolbar p-toolbar" data-testid="data-toolbar">
    <!-- LAW 01/10: Refresh, then Stop (always present, greyed when idle), then the run-state
         ring beside them — never a bar across the top of the view (DataView.vue). -->
    <div class="group">
      <IconButton
        icon="refresh"
        title="Refresh"
        data-testid="toolbar-refresh"
        :disabled="!!rt?.opId"
        @click="onRefresh"
      />
      <IconButton
        icon="debug-stop"
        :class="{ 'is-live': !!rt?.opId }"
        title="Stop"
        data-testid="toolbar-stop"
        :disabled="!rt?.opId"
        @click="onStop"
      />
      <span
        class="p-run-state"
        :class="{ 'is-running': rt?.status === 'loading', 'is-error': rt?.status === 'error' }"
        :title="rt?.status === 'error' ? rt?.error?.message : undefined"
      >
        <span class="ring" />
        <template v-if="rt?.status === 'loading'">fetching…</template>
        <template v-else-if="rt?.status === 'error'">query failed</template>
      </span>
    </div>

    <div class="sep" />

    <!-- FIX-1: absolute-position pager, kept as a jump-to-page input (D7's cursor/offset paging
         has no notion of "row 1–200" to display without the count query having already run). -->
    <div class="group pager" data-testid="pager" :data-pagination="rt?.lastStrategy">
      <IconButton
        icon="chevron-left"
        :size="12"
        title="First page"
        data-testid="pager-first"
        :disabled="tab.state.pageIndex === 0"
        @click="onFirst"
      />
      <IconButton
        icon="chevron-left"
        :size="12"
        title="Previous page"
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
            data-testid="pager-page-input"
            @change="onJump"
          />
        </div>
        <template v-if="pageCount"> of {{ pageCount }}</template>
      </span>
      <IconButton
        icon="chevron-right"
        :size="12"
        title="Next page"
        data-testid="pager-next"
        :disabled="!rt?.hasMore"
        @click="onNext"
      />
      <IconButton
        icon="chevron-right"
        :size="12"
        :title="pageCount ? 'Last page' : 'Count rows first'"
        data-testid="pager-last"
        :disabled="!pageCount"
        @click="onLast"
      />
    </div>

    <!-- Left as the hand-rolled .p-seg group rather than <Segmented>: tabs.spec.ts/leaks.spec.ts
         assert `toHaveClass(/active/)` on these buttons, and Segmented.vue (off-limits to edit)
         only ever applies `.on` — swapping components here would silently break those tests
         (rule 3: correctness over consistency). -->
    <div class="p-seg" data-testid="page-size-picker">
      <button
        v-for="size in PAGE_SIZES"
        :key="size"
        type="button"
        :class="{ active: tab.state.pageSize === size }"
        :data-testid="`page-size-${size}`"
        @click="onPageSize(size)"
      >
        {{ PAGE_SIZE_LABEL[size] }}
      </button>
    </div>

    <div class="sep" />

    <div class="group">
      <IconButton
        icon="symbol-number"
        data-testid="toolbar-count"
        :count="rt?.count ? `${rt.count.exact ? '' : '~'}${rt.count.value.toLocaleString()}` : undefined"
        :style="rt?.count?.stale ? { color: 'var(--kira-warn)' } : undefined"
        :title="
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
          :count="columnCountLabel ?? undefined"
          title="Columns"
          @click="columnsOpen = !columnsOpen"
        />
        <ColumnsMenu
          v-if="columnsOpen"
          :tab-id="tab.id"
          :caps="caps"
          @close="columnsOpen = false"
        />
      </div>

      <div class="preview-anchor">
        <IconButton
          icon="eye"
          data-testid="toolbar-preview-command"
          :disabled="!isWritable"
          :title="isWritable ? 'Preview the SQL for pending changes' : 'Connection is read-only'"
          @click="previewOpen = !previewOpen"
        />
        <PreviewCommandPanel v-if="previewOpen && tab" :tab-id="tab.id" @close="previewOpen = false" />
      </div>
    </div>

    <div class="sep" />

    <div class="group">
      <IconButton
        icon="add"
        data-testid="toolbar-add-row"
        :disabled="!isWritable"
        :title="isWritable ? 'Add a row' : 'Connection is read-only'"
        @click="onAddRow"
      />
      <IconButton
        icon="trash"
        data-testid="toolbar-delete-row"
        :disabled="!isWritable"
        :title="isWritable ? 'Delete selected row(s)' : 'Connection is read-only'"
        @click="onDeleteRow"
      />
      <IconButton
        icon="search"
        title="Search this page"
        data-testid="toolbar-search"
        @click="onToggleSearch"
      />
    </div>

    <!-- FIX-3: pending edits as a count with both actions beside it — Commit is the only
         accent-filled control on the whole screen. -->
    <div v-if="tabHasPending" class="group p-push">
      <span class="p-chip warn">{{ pendingCount }} row{{ pendingCount === 1 ? '' : 's' }} pending</span>
      <IconButton
        icon="discard"
        data-testid="toolbar-discard-changes"
        :disabled="!isWritable"
        title="Discard pending changes"
        @click="onDiscard"
      />
      <IconButton
        icon="save"
        tone="primary"
        data-testid="toolbar-commit-changes"
        :disabled="!isWritable"
        title="Commit pending changes"
        @click="onCommit"
      />
    </div>
  </div>
</template>

<style scoped>
/* Sizing/spacing/colour all come from .p-toolbar and the primitives it hosts (p-iconbtn, p-btn,
   p-seg, p-input, p-chip, p-count, p-run-state) — only the bits those primitives don't cover
   (the pager's own layout, the page-jump input's width, live/stale colour states) live here. */

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

/* .p-seg's own primitive only paints `.on` (see primitives.css) — the page-size control keeps
   the `active` class name because tests/ui assert on it directly. */
.p-seg > button.active {
  background: var(--kira-bg-input);
  color: var(--kira-fg);
}

.p-iconbtn.is-live {
  color: var(--kira-error);
}

.columns-anchor,
.preview-anchor {
  position: relative;
}
</style>
