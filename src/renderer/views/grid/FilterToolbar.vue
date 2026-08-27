<script setup lang="ts">
import type { SortSpec } from '@shared/domain/queries';
import { computed, ref, watch } from 'vue';
import { control } from '../../bridge/control';
import { connectionRecord } from '../../state/connections';
import { activeDataTab } from '../../state/tabs';
import AppButton from '../../theme/primitives/AppButton.vue';
import AutocompleteField from '../../theme/primitives/AutocompleteField.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import FilterHistoryMenu from '../shared/FilterHistoryMenu.vue';
import { sqlDialectFor } from '../shared/sqlIdent';
import {
  orderByCandidates as buildOrderByCandidates,
  whereCandidates as buildWhereCandidates,
} from './filterCompletion';
import { runtime, setFilter, setSort } from './state';

const tab = computed(() => activeDataTab.value);
const rt = computed(() => (tab.value ? runtime[tab.value.id] : undefined));

// A query that failed is shown by the WHERE field turning error-red — the failure itself is
// already reported by DataView.vue's error strip, this just points at the field that caused it.
const hasError = computed(() => rt.value?.status === 'error');

// Mirrors PreviewCommandPanel.vue's/ConsoleView.vue's own three-line dialect computed exactly —
// undefined for every non-SQL connection kind, which filterCompletion.ts's dialect-conditional
// vocabularies (ILIKE, NULLS FIRST/LAST) already treat as "the non-Postgres list".
const dialect = computed(() => sqlDialectFor(connectionRecord(tab.value?.connectionId)?.kind));
const whereCandidates = computed(() =>
  tab.value ? buildWhereCandidates(tab.value.id, dialect.value) : [],
);
const orderByCandidates = computed(() =>
  tab.value ? buildOrderByCandidates(tab.value.id, dialect.value) : [],
);

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
  // A blur fires on every focus loss, not just an edit — re-applying an unchanged WHERE would
  // reset paging/count for no reason (and, worse, race an in-flight runCount for this same filter).
  if (value === (t.state.filter ?? null)) return;
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

// AutocompleteField's own @escape only ever fires once its suggestion dropdown is already closed
// (an open one consumes Escape itself, to dismiss just the dropdown) — so by the time this runs,
// focus is still genuinely on the field itself, and blurring the active element is exactly
// blurring it.
function onWhereEscape(): void {
  whereText.value = tab.value?.state.filter ?? '';
  (document.activeElement as HTMLElement | null)?.blur();
}
function onOrderByEscape(): void {
  orderByText.value = sortToText(tab.value?.state.sort ?? null);
  (document.activeElement as HTMLElement | null)?.blur();
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
        v-tooltip="'Saved & recent filters'"
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
      <AutocompleteField
        v-model="whereText"
        prefix="WHERE"
        placeholder="status = 'paid'"
        data-testid="filter-where-input"
        :invalid="hasError"
        :candidates="whereCandidates"
        @enter="applyWhere"
        @escape="onWhereEscape"
        @blur="applyWhere"
      />
    </div>
    <div class="orderby-input">
      <AutocompleteField
        v-model="orderByText"
        prefix="ORDER BY"
        placeholder="placed_at DESC"
        data-testid="filter-orderby-input"
        :candidates="orderByCandidates"
        @enter="applyOrderBy"
        @escape="onOrderByEscape"
        @blur="applyOrderBy"
      />
    </div>
    <AppButton v-tooltip="'Empty both fields and refetch'" @click="onClear"> Clear </AppButton>
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
