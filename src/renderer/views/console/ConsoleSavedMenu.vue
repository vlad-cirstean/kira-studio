<script setup lang="ts">
import type { SavedConsoleQuery } from '@shared/domain/queries';
import { nextTick, onMounted, ref } from 'vue';
import { control } from '../../bridge/control';
import { findConsoleTab } from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import AppButton from '../../theme/primitives/AppButton.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';
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
// Typed as the bare $el shape (rather than InstanceType<typeof TextField>) so this ref doesn't
// read as a type-only use of the TextField import above — it's a real component, bound as a value
// by the template below.
const promptInput = ref<{ $el: HTMLElement } | null>(null);
function promptText(title: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    textPrompt.value = { title, value: initial, resolve };
    // TextField wraps the real <input> inside its own root <span> (P4) and isn't defineExpose'd,
    // so the focus target is reached the same way any plain DOM query would find it — via the
    // component's $el, which Vue always exposes on a template ref regardless of defineExpose.
    void nextTick(() => promptInput.value?.$el.querySelector('input')?.focus());
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
      <IconButton icon="edit" v-tooltip="'Rename'" @click.stop="rename(entry)" />
    </template>
    <template #footer>
      <div class="p-sep" />
      <button type="button" class="save-current p-row" data-testid="console-save-current" @click="saveCurrent">
        <span class="icon-box"><CodiconIcon name="add" :size="13" /></span>
        Save current query…
      </button>
    </template>
  </SavedListMenu>

  <div v-if="textPrompt" class="prompt-scrim" data-testid="text-prompt" @click.stop>
    <div class="prompt-box p-float">
      <div class="prompt-title p-sm muted">{{ textPrompt.title }}</div>
      <TextField
        ref="promptInput"
        v-model="textPrompt.value"
        size="md"
        data-testid="text-prompt-input"
        @enter="submitPrompt"
        @keydown.escape="cancelPrompt"
      />
      <div class="prompt-actions">
        <AppButton kind="dialog" data-testid="text-prompt-cancel" @click="cancelPrompt"> Cancel </AppButton>
        <AppButton kind="dialog" variant="primary" data-testid="text-prompt-ok" @click="submitPrompt">
          OK
        </AppButton>
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
