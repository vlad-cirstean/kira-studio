<script setup lang="ts">
import type { SavedConsoleQuery } from '@shared/domain/queries';
import { nextTick, onMounted, ref } from 'vue';
import { control } from '../../bridge/control';
import { findConsoleTab } from '../../state/tabs';
import { setText } from './state';

// A lean sibling of grid/FilterHistoryMenu.vue: saved-only (§8.14 gives the console no run
// history, only saved_queries), scoped to one tab's own connectionId/path.
const props = defineProps<{ tabId: string }>();
const emit = defineEmits<{ close: [] }>();

function tab() {
  return findConsoleTab(props.tabId);
}

const saved = ref<SavedConsoleQuery[]>([]);

// Electron's renderer has no window.prompt() — same in-app substitute as FilterHistoryMenu.vue.
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
  saved.value = await control.queriesListConsole(t.connectionId, t.path);
}
onMounted(reload);

function apply(entry: SavedConsoleQuery): void {
  setText(props.tabId, entry.body.text);
  void control.queriesTouch(entry.id);
  emit('close');
}

async function togglePin(entry: SavedConsoleQuery): Promise<void> {
  await control.queriesUpdate(entry.id, { pinned: !entry.pinned });
  await reload();
}
async function rename(entry: SavedConsoleQuery): Promise<void> {
  const name = await promptText('Rename saved query', entry.name);
  if (!name || name.trim() === '') return;
  await control.queriesUpdate(entry.id, { name: name.trim() });
  await reload();
}
async function remove(entry: SavedConsoleQuery): Promise<void> {
  await control.queriesDelete(entry.id);
  await reload();
}

async function saveCurrent(): Promise<void> {
  const t = tab();
  if (!t?.connectionId) return;
  const name = await promptText('Name this query', '');
  if (!name || name.trim() === '') return;
  await control.queriesSaveConsole({
    connectionId: t.connectionId,
    path: t.path,
    name: name.trim(),
    body: { text: t.state.text },
    pinned: false,
  });
  await reload();
}
</script>

<template>
  <div class="menu-backdrop" data-testid="console-saved-backdrop" @click="emit('close')">
    <div class="saved-menu" data-testid="console-saved-menu" @click.stop>
      <div class="section-label">Saved queries</div>
      <div v-if="saved.length === 0" class="empty-row">No saved queries</div>
      <div
        v-for="entry in saved"
        :key="entry.id"
        class="entry-row"
        data-testid="console-saved-entry"
        @click="apply(entry)"
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

      <button type="button" class="save-current" data-testid="console-save-current" @click="saveCurrent">
        Save current query…
      </button>
    </div>

    <div v-if="textPrompt" class="prompt-scrim" data-testid="text-prompt" @click.stop>
      <div class="prompt-box">
        <div class="prompt-title">{{ textPrompt.title }}</div>
        <input
          ref="promptInput"
          v-model="textPrompt.value"
          type="text"
          data-testid="text-prompt-input"
          @keydown.enter="submitPrompt"
          @keydown.escape="cancelPrompt"
        />
        <div class="prompt-actions">
          <button type="button" data-testid="text-prompt-cancel" @click="cancelPrompt">
            Cancel
          </button>
          <button type="button" data-testid="text-prompt-ok" @click="submitPrompt">OK</button>
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

.saved-menu {
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
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-title {
  font-size: 12px;
  color: var(--kira-fg-muted);
}

.prompt-box input {
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  color: var(--kira-fg);
  padding: 4px 6px;
  font-size: 12px;
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.prompt-actions button {
  padding: 3px 10px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
  font-size: 12px;
}

.prompt-actions button:last-child {
  background: var(--kira-accent);
  border-color: var(--kira-accent);
  color: var(--kira-accent-fg);
}
</style>
