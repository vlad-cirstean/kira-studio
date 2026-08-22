<script setup lang="ts">
import type { FilterHistoryEntry, SavedQuery, SortSpec } from '@shared/domain/queries';
import { onMounted, ref } from 'vue';
import { control } from '../../bridge/control';
import { findDataTab } from '../../state/tabs';

const props = defineProps<{ tabId: string }>();
const emit = defineEmits<{ apply: [where: string | null, orderBy: SortSpec | null]; close: [] }>();

function tab() {
  return findDataTab(props.tabId);
}

const saved = ref<SavedQuery[]>([]);
const history = ref<FilterHistoryEntry[]>([]);

async function reload(): Promise<void> {
  const t = tab();
  if (!t?.connectionId) return;
  const [savedList, historyList] = await Promise.all([
    control.queriesList(t.connectionId, t.path),
    control.queriesHistoryList(t.connectionId, t.path, 20),
  ]);
  saved.value = savedList;
  history.value = historyList;
}
onMounted(reload);

function sortLabel(orderBy: SortSpec | null): string | null {
  if (!orderBy) return null;
  if (orderBy.kind === 'text') return orderBy.text;
  return orderBy.terms.map((t) => `${t.column} ${t.direction.toUpperCase()}`).join(', ');
}

function summarize(where: string | null, orderBy: SortSpec | null): string {
  const parts: string[] = [];
  if (where) parts.push(`WHERE ${where}`);
  const orderText = sortLabel(orderBy);
  if (orderText) parts.push(`ORDER BY ${orderText}`);
  return parts.length > 0 ? parts.join(' / ') : '(no filter)';
}

async function applySaved(entry: SavedQuery): Promise<void> {
  emit('apply', entry.body.where, entry.body.orderBy);
  await control.queriesTouch(entry.id);
  emit('close');
}
function applyHistoryEntry(entry: FilterHistoryEntry): void {
  emit('apply', entry.where, entry.orderBy);
  emit('close');
}

async function togglePin(entry: SavedQuery): Promise<void> {
  await control.queriesUpdate(entry.id, { pinned: !entry.pinned });
  await reload();
}
async function rename(entry: SavedQuery): Promise<void> {
  const name = window.prompt('Rename saved filter', entry.name);
  if (!name || name.trim() === '') return;
  await control.queriesUpdate(entry.id, { name: name.trim() });
  await reload();
}
async function remove(entry: SavedQuery): Promise<void> {
  await control.queriesDelete(entry.id);
  await reload();
}

async function saveCurrent(): Promise<void> {
  const t = tab();
  if (!t?.connectionId) return;
  const name = window.prompt('Name this filter');
  if (!name || name.trim() === '') return;
  await control.queriesSave({
    connectionId: t.connectionId,
    path: t.path,
    name: name.trim(),
    body: { where: t.state.filter, orderBy: t.state.sort },
    pinned: false,
  });
  await reload();
}
</script>

<template>
  <div class="menu-backdrop" data-testid="filter-history-backdrop" @click="emit('close')">
    <div class="filter-history" data-testid="filter-history" @click.stop>
      <div class="section-label">Saved</div>
      <div v-if="saved.length === 0" class="empty-row">No saved filters</div>
      <div
        v-for="entry in saved"
        :key="entry.id"
        class="entry-row"
        data-testid="saved-entry"
        @click="applySaved(entry)"
      >
        <button
          type="button"
          class="pin-button"
          :class="{ pinned: entry.pinned }"
          title="Pin"
          @click.stop="togglePin(entry)"
        >
          ★
        </button>
        <span class="entry-name">{{ entry.name }}</span>
        <span class="entry-actions">
          <button type="button" title="Rename" @click.stop="rename(entry)">✎</button>
          <button type="button" title="Delete" @click.stop="remove(entry)">✕</button>
        </span>
      </div>

      <div class="section-label">Recent</div>
      <div v-if="history.length === 0" class="empty-row">No history yet</div>
      <div
        v-for="entry in history"
        :key="entry.id"
        class="entry-row"
        data-testid="history-entry"
        @click="applyHistoryEntry(entry)"
      >
        <span class="entry-name mono">{{ summarize(entry.where, entry.orderBy) }}</span>
      </div>

      <button type="button" class="save-current" data-testid="save-current-filter" @click="saveCurrent">
        Save current filter…
      </button>
    </div>
  </div>
</template>

<style scoped>
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.filter-history {
  position: absolute;
  top: 32px;
  left: 8px;
  width: 320px;
  max-height: 400px;
  overflow-y: auto;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  font-size: 12px;
}

.section-label {
  padding: 4px 8px;
  font-size: 10px;
  text-transform: uppercase;
  color: var(--kira-fg-muted);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.empty-row {
  padding: 6px 8px;
  color: var(--kira-fg-muted);
}

.entry-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  cursor: pointer;
}

.entry-row:hover {
  background: var(--kira-hover);
}

.entry-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pin-button {
  background: transparent;
  border: none;
  color: var(--kira-fg-disabled);
  cursor: pointer;
  padding: 0;
}

.pin-button.pinned {
  color: var(--kira-warn);
}

.entry-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.entry-actions button {
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 0 2px;
}

.save-current {
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  background: transparent;
  border: none;
  border-top: var(--kira-border-width) solid var(--kira-border);
  color: var(--kira-accent);
  cursor: pointer;
  font-size: 12px;
}

.save-current:hover {
  background: var(--kira-hover);
}
</style>
