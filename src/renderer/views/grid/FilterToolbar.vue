<script setup lang="ts">
import type { SortSpec } from '@shared/domain/queries';
import { computed, ref, watch } from 'vue';
import { control } from '../../bridge/control';
import { activeTab } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import FilterHistoryMenu from './FilterHistoryMenu.vue';
import { setFilter, setSort } from './state';

const tab = computed(() => activeTab.value);

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
  <div v-if="tab" class="filter-toolbar" data-testid="filter-toolbar">
    <div class="history-anchor">
      <button
        type="button"
        title="History"
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
    <input
      v-model="whereText"
      type="text"
      class="filter-input mono"
      placeholder="WHERE …"
      data-testid="filter-where-input"
      @keydown="onWhereKeydown"
      @blur="applyWhere"
    />
    <div class="spacer" />
    <span v-if="isStructuredSort" class="sort-marker" title="Set from a header click">⇅</span>
    <input
      v-model="orderByText"
      type="text"
      class="filter-input orderby mono"
      placeholder="ORDER BY …"
      data-testid="filter-orderby-input"
      @keydown="onOrderByKeydown"
      @blur="applyOrderBy"
    />
  </div>
</template>

<style scoped>
.filter-toolbar {
  height: 26px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-top: var(--kira-border-width) solid var(--kira-border);
  font-size: 11px;
}

.history-anchor {
  position: relative;
}

.history-anchor > button {
  display: flex;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--kira-radius);
}

.history-anchor > button:hover {
  background: var(--kira-hover);
}

.filter-input {
  background: transparent;
  border: none;
  color: var(--kira-fg);
  font-size: 11px;
  outline: none;
  padding: 2px 4px;
  min-width: 0;
}

.filter-input:focus {
  background: var(--kira-bg-input);
  border-radius: var(--kira-radius);
}

.filter-input:not(.orderby) {
  flex: 1;
}

.orderby {
  width: 200px;
  text-align: right;
}

.spacer {
  flex: 0 0 auto;
}

.sort-marker {
  color: var(--kira-accent);
  flex-shrink: 0;
}

.mono {
  font-family: var(--kira-font-family);
}
</style>
