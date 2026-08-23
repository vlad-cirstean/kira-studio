<script setup lang="ts">
import type { SavedConsoleQuery } from '@shared/domain/queries';
import { nextTick, onMounted, ref } from 'vue';
import { control } from '../../bridge/control';
import { findConsoleTab } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
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
    <!-- Same P11/P8 shape as grid/FilterHistoryMenu.vue's own saved list (its own comment calls
         this component a lean sibling of that one) — one p-float, a p-menu-label, p-row entries,
         a p-sep, then the "save current" row. -->
    <div class="saved-menu p-float" data-testid="console-saved-menu" @click.stop>
      <div class="p-menu-label">Saved queries</div>
      <div v-if="saved.length === 0" class="empty-row p-sm dim">No saved queries</div>
      <div
        v-for="entry in saved"
        :key="entry.id"
        class="entry-row p-row"
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

      <div class="p-sep"></div>
      <button type="button" class="save-current p-row" data-testid="console-save-current" @click="saveCurrent">
        <span class="icon-box"><Codicon name="add" :size="12" /></span>
        Save current query…
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

/* P11 floating surface (the same shape grid/FilterHistoryMenu.vue uses for its own saved list):
   bg-elevated, border-strong, radius and the one dialog shadow all come from .p-float — this
   just positions it as a popover under the toolbar's "Saved queries" button. */
.saved-menu {
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

/* Entry rows are the shared .p-row (P8) — the same 22px row the tree and the command palette
   use, so a saved-query row highlights identically. Only the pin/action icons are local. */
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
