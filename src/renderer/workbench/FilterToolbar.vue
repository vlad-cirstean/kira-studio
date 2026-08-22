<script setup lang="ts">
import { computed, ref } from 'vue';
import Codicon from '../theme/Codicon.vue';
import { loadTabData } from './state/data';
import {
  deleteFilter,
  listSavedFilters,
  saveFilter,
  touchFilter,
} from './state/filters';
import { updateTabState, tabsState, type Tab } from './state/tabs';
import type { SavedQuery } from '@shared/saved-query';

// §8.5 filter toolbar (P2 D13/D14). One row below the data-view toolbar, hidden by default. WHERE
// and ORDER BY are free text spliced into the SQL verbatim; a server error renders under the
// offending input, verbatim, and the grid keeps the last good page. History and saved entries are
// the same rows distinguished by name (D14).

const props = defineProps<{ tab: Tab }>();

const where = ref(props.tab.state.where);
const orderBy = ref(props.tab.state.orderBy);
const historyOpen = ref(false);
const entries = ref<SavedQuery[]>([]);
const error = ref<{ field: 'where' | 'orderBy'; message: string } | null>(null);
const saving = ref(false);

async function refreshHistory(): Promise<void> {
  entries.value = await listSavedFilters(props.tab.connectionId, props.tab.path);
}

async function applyFilter(): Promise<void> {
  error.value = null;
  updateTabState(props.tab.id, {
    where: where.value,
    orderBy: orderBy.value,
    cursor: { kind: 'offset', offset: 0 },
    pageIndex: 1,
    totalRows: null,
    totalExact: false,
  });
  await loadTabData(props.tab.id);
  // loadTabData catches adapter errors internally and keeps the last good page (D13). The toolbar
  // reads the resulting runtime.error so the server's verbatim message renders under the input.
  const tab = tabsState.tabs.find((t) => t.id === props.tab.id);
  if (tab?.runtime.error) {
    error.value = { field: 'where', message: tab.runtime.error };
    return;
  }
  // D14: record an unnamed history entry and prune to HISTORY_LIMIT.
  await saveFilter(props.tab.connectionId, props.tab.path, '', {
    where: where.value,
    orderBy: orderBy.value,
  });
  const { control } = await import('../bridge/control');
  await control.savedQueriesPrune({ connectionId: props.tab.connectionId, path: props.tab.path });
}

function clearFilter(): void {
  where.value = '';
  orderBy.value = '';
  updateTabState(props.tab.id, {
    where: '',
    orderBy: '',
    cursor: { kind: 'offset', offset: 0 },
    pageIndex: 1,
    totalRows: null,
    totalExact: false,
  });
  void loadTabData(props.tab.id);
}

async function onSaveNamed(): Promise<void> {
  const name = window.prompt('Name this filter', '');
  if (name === null || name.trim() === '') return;
  saving.value = true;
  try {
    await saveFilter(props.tab.connectionId, props.tab.path, name.trim(), {
      where: where.value,
      orderBy: orderBy.value,
    });
  } finally {
    saving.value = false;
  }
}

async function onPick(entry: SavedQuery): Promise<void> {
  where.value = entry.body.where;
  orderBy.value = entry.body.orderBy;
  void touchFilter(entry.id);
  historyOpen.value = false;
  await applyFilter();
}

async function onRename(entry: SavedQuery): Promise<void> {
  const name = window.prompt('Rename filter', entry.name);
  if (name === null || name.trim() === '') return;
  await saveFilter(props.tab.connectionId, props.tab.path, name.trim(), entry.body);
  await refreshHistory();
}

async function onDelete(entry: SavedQuery): Promise<void> {
  await deleteFilter(entry.id);
  await refreshHistory();
}

const savedEntries = computed(() => entries.value.filter((e) => e.name !== ''));
const historyEntries = computed(() => entries.value.filter((e) => e.name === ''));
</script>

<template>
  <div class="filter-toolbar" data-testid="filter-toolbar">
    <button
      type="button"
      class="history-button"
      data-testid="filter-history"
      @click="historyOpen = !historyOpen; if (historyOpen) refreshHistory()"
    >
      <Codicon name="history" :size="13" />
    </button>

    <label class="input-wrap">
      <span class="prefix">WHERE</span>
      <input
        v-model="where"
        type="text"
        class="mono"
        placeholder="field1 = 'a' and field2 is null"
        data-testid="filter-where"
        @keydown.enter="applyFilter"
      />
      <span v-if="error?.field === 'where'" class="inline-error" data-testid="filter-where-error">
        {{ error.message }}
      </span>
    </label>

    <span class="divider" />

    <label class="input-wrap">
      <span class="prefix">ORDER BY</span>
      <input
        v-model="orderBy"
        type="text"
        class="mono"
        placeholder="field1 ASC, field2 DESC"
        data-testid="filter-orderby"
        @keydown.enter="applyFilter"
      />
      <span v-if="error?.field === 'orderBy'" class="inline-error">{{ error.message }}</span>
    </label>

    <button type="button" class="action" data-testid="filter-apply" @click="applyFilter">Apply</button>
    <button type="button" class="action" data-testid="filter-clear" @click="clearFilter">Clear</button>
    <button type="button" class="action" data-testid="filter-save" :disabled="saving" @click="onSaveNamed">Save…</button>

    <div v-if="historyOpen" class="history-menu" data-testid="filter-history-menu">
      <div class="history-group-label">Saved</div>
      <template v-if="savedEntries.length === 0">
        <div class="history-empty">No saved filters</div>
      </template>
      <div
        v-for="entry in savedEntries"
        :key="entry.id"
        class="history-item"
        data-testid="filter-history-entry"
        @click="onPick(entry)"
      >
        <Codicon name="pin" :size="12" />
        <span class="history-name">{{ entry.name }}</span>
        <span class="history-preview">{{ entry.body.where || entry.body.orderBy }}</span>
        <span class="history-actions" @click.stop>
          <button type="button" title="Rename" @click="onRename(entry)">Rename</button>
          <button type="button" title="Delete" @click="onDelete(entry)">Delete</button>
        </span>
      </div>
      <div class="history-group-label">History</div>
      <template v-if="historyEntries.length === 0">
        <div class="history-empty">No recent filters</div>
      </template>
      <div
        v-for="entry in historyEntries"
        :key="entry.id"
        class="history-item"
        data-testid="filter-history-entry"
        @click="onPick(entry)"
      >
        <span class="history-preview">{{ entry.body.where || entry.body.orderBy }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.filter-toolbar {
  position: relative;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  background: var(--kira-bg-chrome);
  border-top: 1px solid var(--kira-border);
  font-size: 12px;
}

.history-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--kira-radius);
  background: transparent;
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.history-button:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 120px;
  max-width: 420px;
}

.prefix {
  color: var(--kira-fg-disabled);
  font-size: 11px;
  flex-shrink: 0;
}

.mono {
  flex: 1;
  height: 22px;
  padding: 0 6px;
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  color: var(--kira-fg);
  font-family: var(--kira-font-family);
  font-size: 12px;
  outline: none;
}

.mono:focus {
  border-color: var(--kira-focus);
}

.divider {
  width: 1px;
  height: 16px;
  background: var(--kira-border-strong);
  flex-shrink: 0;
}

.inline-error {
  position: absolute;
  top: 26px;
  left: 0;
  z-index: 30;
  color: var(--kira-error);
  font-size: 11px;
  background: var(--kira-bg-elevated);
  padding: 2px 6px;
  border-radius: var(--kira-radius);
  white-space: nowrap;
}

.action {
  height: 22px;
  padding: 0 10px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  font-size: 12px;
  cursor: pointer;
}

.action:hover:not(:disabled) {
  background: var(--kira-hover);
}

.action:disabled {
  color: var(--kira-fg-disabled);
}

.history-menu {
  position: absolute;
  top: 28px;
  left: 8px;
  z-index: 60;
  min-width: 260px;
  max-height: 320px;
  overflow: auto;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  box-shadow: var(--kira-shadow);
  padding: 4px;
}

.history-group-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--kira-fg-disabled);
  padding: 4px 6px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--kira-radius);
  color: var(--kira-fg);
  font-size: 12px;
  cursor: pointer;
}

.history-item:hover {
  background: var(--kira-hover);
}

.history-name {
  font-weight: 600;
  flex-shrink: 0;
}

.history-preview {
  color: var(--kira-fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.history-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
}

.history-item:hover .history-actions {
  opacity: 1;
}

.history-actions button {
  border: none;
  background: transparent;
  color: var(--kira-fg-muted);
  font-size: 11px;
  cursor: pointer;
}

.history-actions button:hover {
  color: var(--kira-fg);
}

.history-empty {
  color: var(--kira-fg-disabled);
  font-size: 11px;
  padding: 2px 6px;
}
</style>
