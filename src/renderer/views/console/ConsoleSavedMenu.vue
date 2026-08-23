<script setup lang="ts">
import type { SavedConsoleQuery } from '@shared/domain/queries';
import { nextTick, onMounted, ref } from 'vue';
import { control } from '../../bridge/control';
import { findConsoleTab } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import SavedListMenu from '../shared/SavedListMenu.vue';
import { setText } from './state';

// A lean sibling of grid/FilterHistoryMenu.vue: saved-only (§8.14 gives the console no run
// history, only saved_queries), scoped to one tab's own connectionId/path. Both share the same
// popover shell/list layout via views/shared/SavedListMenu.vue.
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
  <SavedListMenu
    title="Saved queries"
    :saved="saved"
    panel-test-id="console-saved-menu"
    backdrop-test-id="console-saved-backdrop"
    saved-entry-test-id="console-saved-entry"
    empty-saved-text="No saved queries"
    @apply="apply"
    @toggle-pin="togglePin"
    @delete="remove"
    @close="emit('close')"
  >
    <template #entry="{ entry }">
      <span class="entry-name">{{ entry.name }}</span>
    </template>
    <template #entry-actions="{ entry }">
      <button type="button" class="p-iconbtn" title="Rename" @click.stop="rename(entry)">
        <Codicon name="edit" :size="12" />
      </button>
    </template>
    <template #footer>
      <div class="p-sep" />
      <button type="button" class="save-current p-row" data-testid="console-save-current" @click="saveCurrent">
        <span class="icon-box"><Codicon name="add" :size="12" /></span>
        Save current query…
      </button>
    </template>
  </SavedListMenu>

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
</template>

<style scoped>
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
