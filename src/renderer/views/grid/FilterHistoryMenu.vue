<script setup lang="ts">
import type { FilterHistoryEntry, SavedFilterQuery, SortSpec } from '@shared/domain/queries';
import { nextTick, onMounted, ref } from 'vue';
import { control } from '../../bridge/control';
import { findDataTab } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';

const props = defineProps<{ tabId: string }>();
const emit = defineEmits<{ apply: [where: string | null, orderBy: SortSpec | null]; close: [] }>();

function tab() {
  return findDataTab(props.tabId);
}

const saved = ref<SavedFilterQuery[]>([]);
const history = ref<FilterHistoryEntry[]>([]);

// Electron's renderer does not implement window.prompt() (only alert/confirm are backed by a
// native dialog) — calling it throws rather than showing anything. This is the in-app substitute,
// shared by saveCurrent() and rename() below.
const textPrompt = ref<{
  title: string;
  value: string;
  resolve: (v: string | null) => void;
} | null>(null);
const promptInput = ref<HTMLInputElement | null>(null);
function promptText(title: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    textPrompt.value = { title, value: initial, resolve };
    void nextTick(() => promptInput.value?.focus());
  });
}
function submitPrompt(): void {
  if (!textPrompt.value) return;
  const { value, resolve } = textPrompt.value;
  textPrompt.value = null;
  resolve(value);
}
function cancelPrompt(): void {
  if (!textPrompt.value) return;
  const { resolve } = textPrompt.value;
  textPrompt.value = null;
  resolve(null);
}

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

async function applySaved(entry: SavedFilterQuery): Promise<void> {
  emit('apply', entry.body.where, entry.body.orderBy);
  await control.queriesTouch(entry.id);
  emit('close');
}
function applyHistoryEntry(entry: FilterHistoryEntry): void {
  emit('apply', entry.where, entry.orderBy);
  emit('close');
}

async function togglePin(entry: SavedFilterQuery): Promise<void> {
  await control.queriesUpdate(entry.id, { pinned: !entry.pinned });
  await reload();
}
async function rename(entry: SavedFilterQuery): Promise<void> {
  const name = await promptText('Rename saved filter', entry.name);
  if (!name || name.trim() === '') return;
  await control.queriesUpdate(entry.id, { name: name.trim() });
  await reload();
}
async function remove(entry: SavedFilterQuery): Promise<void> {
  await control.queriesDelete(entry.id);
  await reload();
}

async function saveCurrent(): Promise<void> {
  const t = tab();
  if (!t?.connectionId) return;
  const name = await promptText('Name this filter', '');
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
    <div class="filter-history p-float" data-testid="filter-history" @click.stop>
      <div class="p-menu-label">Saved</div>
      <div v-if="saved.length === 0" class="empty-row p-sm dim">No saved filters</div>
      <div
        v-for="entry in saved"
        :key="entry.id"
        class="entry-row p-row"
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
          <Codicon :name="entry.pinned ? 'star-full' : 'star-empty'" :size="12" />
        </button>
        <span class="entry-name">{{ entry.name }}</span>
        <span class="entry-actions">
          <button type="button" class="p-iconbtn" title="Rename" @click.stop="rename(entry)">
            <Codicon name="edit" :size="12" />
          </button>
          <button type="button" class="p-iconbtn" title="Delete" @click.stop="remove(entry)">
            <Codicon name="trash" :size="12" />
          </button>
        </span>
      </div>

      <div class="p-sep" />
      <div class="p-menu-label">Recent</div>
      <div v-if="history.length === 0" class="empty-row p-sm dim">No history yet</div>
      <div
        v-for="entry in history"
        :key="entry.id"
        class="entry-row p-row"
        data-testid="history-entry"
        @click="applyHistoryEntry(entry)"
      >
        <span class="entry-name mono">{{ summarize(entry.where, entry.orderBy) }}</span>
      </div>

      <div class="p-sep" />
      <button type="button" class="save-current p-row" data-testid="save-current-filter" @click="saveCurrent">
        <span class="icon-box"><Codicon name="add" :size="12" /></span>
        Save current filter…
      </button>
    </div>

    <div v-if="textPrompt" class="prompt-scrim" data-testid="text-prompt" @click.stop>
      <div class="prompt-box p-float">
        <div class="prompt-title p-sm muted">{{ textPrompt.title }}</div>
        <span class="p-input md">
          <input
            ref="promptInput"
            v-model="textPrompt.value"
            type="text"
            data-testid="text-prompt-input"
            @keydown.enter="submitPrompt"
            @keydown.escape="cancelPrompt"
          />
        </span>
        <div class="prompt-actions">
          <button type="button" class="p-dlgbtn" data-testid="text-prompt-cancel" @click="cancelPrompt">
            Cancel
          </button>
          <button type="button" class="p-dlgbtn primary" data-testid="text-prompt-ok" @click="submitPrompt">
            OK
          </button>
        </div>
      </div>
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
}

.empty-row {
  padding: var(--kira-s-2) var(--kira-s-3);
}

.entry-row {
  cursor: pointer;
}

.entry-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pin-button {
  display: flex;
  background: transparent;
  border: none;
  color: var(--kira-fg-disabled);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.pin-button.pinned {
  color: var(--kira-warn);
}

.entry-actions {
  display: flex;
  gap: var(--kira-s-1);
  flex-shrink: 0;
}

.save-current {
  width: 100%;
  color: var(--kira-accent);
  cursor: pointer;
}

.prompt-scrim {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
}

.prompt-box {
  width: 280px;
  padding: var(--kira-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-3);
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--kira-s-3);
}
</style>
