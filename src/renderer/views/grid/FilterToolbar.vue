<script setup lang="ts">
import type { SortSpec } from '@shared/domain/queries';
import { computed, ref, watch } from 'vue';
import { control } from '../../bridge/control';
import { activeDataTab } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import FilterHistoryMenu from './FilterHistoryMenu.vue';
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

// The tab switch (MainView keys the whole view by tab.id) already remounts this component, so
// `immediate: true` alone covers both "just opened" and "tab changed".
watch(
  tab,
  (t) => {
    whereText.value = t?.state.filter ?? '';
    orderByText.value = sortToText(t?.state.sort ?? null);
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

function onWhereKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  else if (e.key === 'Escape') {
    whereText.value = tab.value?.state.filter ?? '';
    (e.target as HTMLInputElement).blur();
  }
}
function onOrderByKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  else if (e.key === 'Escape') {
    orderByText.value = sortToText(tab.value?.state.sort ?? null);
    (e.target as HTMLInputElement).blur();
  }
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
      <button
        type="button"
        class="p-iconbtn"
        title="Saved &amp; recent filters"
        data-testid="filter-history-button"
        @click="historyOpen = !historyOpen"
      >
        <Codicon name="history" :size="14" />
      </button>
      <FilterHistoryMenu
        v-if="historyOpen"
        :tab-id="tab.id"
        @apply="applyFromHistory"
        @close="historyOpen = false"
      />
    </div>
    <span class="p-input where-input" :class="{ 'is-error': hasError }">
      <span class="dim prefix">WHERE</span>
      <input
        v-model="whereText"
        type="text"
        class="mono"
        placeholder="status = 'paid'"
        data-testid="filter-where-input"
        @keydown="onWhereKeydown"
        @blur="applyWhere"
      />
    </span>
    <span class="p-input orderby-input">
      <span class="dim prefix">ORDER BY</span>
      <input
        v-model="orderByText"
        type="text"
        class="mono"
        placeholder="placed_at DESC"
        data-testid="filter-orderby-input"
        @keydown="onOrderByKeydown"
        @blur="applyOrderBy"
      />
    </span>
    <span v-if="isStructuredSort" class="p-chip info" title="Sort came from clicking a column header">
      <Codicon name="sort-precedence" :size="11" />from header
    </span>
    <button type="button" class="p-btn" title="Empty both fields and refetch" @click="onClear">
      Clear
    </button>
  </div>
</template>

<style scoped>
/* Height, padding and colour come from .p-toolbar/.p-input — only the two fields' own widths and
   the WHERE/ORDER BY prefixes live here. */
.history-anchor {
  position: relative;
}

.where-input {
  flex: 1;
  min-width: 0;
}

.where-input.is-error {
  border-color: var(--kira-error);
}

.orderby-input {
  width: 230px;
  flex-shrink: 0;
}

.prefix {
  flex-shrink: 0;
  font-family: -apple-system, 'SF Pro Text', system-ui, 'Segoe UI', sans-serif;
}
</style>
