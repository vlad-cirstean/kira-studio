<script setup lang="ts">
import type { SortSpec } from '@shared/domain/queries';
import { computed, ref, watch } from 'vue';
import { control } from '../../bridge/control';
import { activeDataTab } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import Button from '../../theme/primitives/Button.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';
import FilterHistoryMenu from '../shared/FilterHistoryMenu.vue';
import { runtime, setFilter, setSort } from './state';

const tab = computed(() => activeDataTab.value);
const rt = computed(() => (tab.value ? runtime[tab.value.id] : undefined));

// A query that failed is shown by the WHERE field turning error-red — the failure itself is
// already reported by DataView.vue's error strip, this just points at the field that caused it.
const hasError = computed(() => rt.value?.status === 'error');

function sortToText(sort: SortSpec | null): string {
  if (!sort) return '';
  if (sort.kind === 'text') return sort.text;
  return sort.terms.map((t) => `${t.column} ${t.direction.toUpperCase()}`).join(', ');
}

const whereText = ref('');
const orderByText = ref('');

// Watched as two separate primitive-returning getters, not `watch(tab, ...)` on the whole
// object: DataView.vue keys this component's ancestor by tab.id (remounted on tab switch, so
// `immediate: true` alone covers "just opened"/"tab changed"), but within one tab's lifetime
// `patchDataTabState` mutates `tab.state` in place rather than replacing the tab object — a
// non-deep watch on `tab` itself never sees that mutation. That silently broke this box after a
// column-header click (DataGrid.vue's onHeaderClick calls setSort, which does exactly this
// in-place patch): the ORDER BY field kept showing whatever was there before the click, so
// blurring it (or pressing Enter) re-applied the stale text and clobbered the header's sort.
watch(
  () => tab.value?.state.filter ?? null,
  (filter) => {
    whereText.value = filter ?? '';
  },
  { immediate: true },
);
watch(
  () => tab.value?.state.sort ?? null,
  (sort) => {
    orderByText.value = sortToText(sort);
  },
  { immediate: true },
);

const isStructuredSort = computed(() => tab.value?.state.sort?.kind === 'structured');

function recordHistory(where: string | null, orderBy: SortSpec | null): void {
  const t = tab.value;
  if (!t?.connectionId) return;
  // A no-op filter (both null) is dropped server-side (D19) — nothing to special-case here.
  void control.queriesHistoryRecord(t.connectionId, t.path, where, orderBy);
}

async function applyWhere(): Promise<void> {
  const t = tab.value;
  if (!t) return;
  const value = whereText.value.trim() === '' ? null : whereText.value.trim();
  await setFilter(t.id, value);
  recordHistory(value, t.state.sort);
}

async function applyOrderBy(): Promise<void> {
  const t = tab.value;
  if (!t) return;
  const text = orderByText.value.trim();
  const sort: SortSpec | null = text === '' ? null : { kind: 'text', text };
  await setSort(t.id, sort);
  recordHistory(t.state.filter, sort);
}

// README's "the filter row is permanent — Clear, never close": empties both fields and refetches,
// using the same setFilter/setSort the blur handlers already call — there is no separate "hide
// the row" affordance to build, since the row never goes away.
async function onClear(): Promise<void> {
  const t = tab.value;
  if (!t) return;
  whereText.value = '';
  orderByText.value = '';
  await setFilter(t.id, null);
  await setSort(t.id, null);
  recordHistory(null, null);
}

function onWhereEscape(e: KeyboardEvent): void {
  whereText.value = tab.value?.state.filter ?? '';
  (e.target as HTMLInputElement).blur();
}
function onOrderByEscape(e: KeyboardEvent): void {
  orderByText.value = sortToText(tab.value?.state.sort ?? null);
  (e.target as HTMLInputElement).blur();
}

const historyOpen = ref(false);

function applyFromHistory(where: string | null, orderBy: SortSpec | null): void {
  const t = tab.value;
  if (!t) return;
  whereText.value = where ?? '';
  orderByText.value = sortToText(orderBy);
  void setFilter(t.id, where).then(() => setSort(t.id, orderBy));
}
</script>

<template>
  <!-- LAW 02 / README: one row, two prefixed inputs, one verb — permanent, so Clear rather than
       a close button that would make the grid change height under you. -->
  <div v-if="tab" class="filter-toolbar p-toolbar" data-testid="filter-toolbar">
    <div class="history-anchor">
      <IconButton
        icon="history"
        title="Saved &amp; recent filters"
        data-testid="filter-history-button"
        @click="historyOpen = !historyOpen"
      />
      <FilterHistoryMenu
        v-if="historyOpen"
        :connection-id="tab.connectionId"
        :path="tab.path"
        :current-filter="tab.state.filter"
        :current-sort="tab.state.sort"
        @apply="applyFromHistory"
        @close="historyOpen = false"
      />
    </div>
    <div class="where-input">
      <TextField
        v-model="whereText"
        prefix="WHERE"
        placeholder="status = 'paid'"
        data-testid="filter-where-input"
        :invalid="hasError"
        @enter="applyWhere"
        @keydown.esc="onWhereEscape"
        @blur="applyWhere"
      />
    </div>
    <div class="orderby-input">
      <TextField
        v-model="orderByText"
        prefix="ORDER BY"
        placeholder="placed_at DESC"
        data-testid="filter-orderby-input"
        @enter="applyOrderBy"
        @keydown.esc="onOrderByEscape"
        @blur="applyOrderBy"
      />
    </div>
    <span v-if="isStructuredSort" class="p-chip info" title="Sort came from clicking a column header">
      <Codicon name="sort-precedence" :size="11" />from header
    </span>
    <Button title="Empty both fields and refetch" @click="onClear"> Clear </Button>
  </div>
</template>

<style scoped>
/* Height, padding and colour come from .p-toolbar/.p-input — only the two fields' own widths
   live here. TextField's root <span class="p-input"> only receives fallthrough attrs on its
   inner <input> (see TextField.vue's inheritAttrs:false), so each field's width lives on this
   wrapper instead of a class/style on the <TextField> tag itself (DocumentView.vue's same
   `.filter-field` precedent). */
.history-anchor {
  position: relative;
}

.where-input {
  flex: 1;
  min-width: 0;
}

.where-input :deep(.p-input) {
  width: 100%;
}

.orderby-input {
  width: 230px;
  flex-shrink: 0;
}

.orderby-input :deep(.p-input) {
  width: 100%;
}
</style>
