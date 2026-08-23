<script setup lang="ts">
import type { FilterHistoryEntry, SavedFilterQuery, SortSpec } from '@shared/domain/queries';
import { computed, nextTick, onMounted, ref } from 'vue';
import { control } from '../../bridge/control';
import Codicon from '../../theme/Codicon.vue';
import Button from '../../theme/primitives/Button.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import SavedListMenu from './SavedListMenu.vue';

// Generic across every filter-bearing view (SQL's FilterToolbar.vue, Document's own filter row) —
// `queriesList`/`queriesHistoryList`/`queriesSave` are keyed purely on {connectionId, path} in
// storage, with no SQL-specific shape, so "where"/"orderBy" here just names the two textual halves
// of whatever a view's filter row holds (a WHERE clause + ORDER BY for SQL, a Mongo filter
// document + sort document for Document) rather than anything SQL-specific. Living in
// views/shared/ (not views/grid/) is what makes this legal for Document to import — §11 forbids
// sideways view imports.
const props = defineProps<{
  connectionId: string | null;
  path: string;
  currentFilter: string | null;
  currentSort: SortSpec | null;
}>();
const emit = defineEmits<{ apply: [where: string | null, orderBy: SortSpec | null]; close: [] }>();

const saved = ref<SavedFilterQuery[]>([]);
const history = ref<FilterHistoryEntry[]>([]);

// SavedListMenu's generic Entry parameter is inferred from these two props together — giving
// both the exact same literal union type here (rather than leaving them as the distinct
// SavedFilterQuery[]/FilterHistoryEntry[] the refs above carry) avoids Vue's generic-component
// inference picking one prop's type and rejecting the other's.
type Entry = SavedFilterQuery | FilterHistoryEntry;
const savedEntries = computed<Entry[]>(() => saved.value);
const historyEntries = computed<Entry[]>(() => history.value);

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
  if (!props.connectionId) return;
  const [savedList, historyList] = await Promise.all([
    control.queriesList(props.connectionId, props.path),
    control.queriesHistoryList(props.connectionId, props.path, 20),
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

// SavedListMenu's `apply` fires for both saved and recent rows (its Entry type parameter, here
// inferred as `SavedFilterQuery | FilterHistoryEntry`, doesn't distinguish them) — branch on the
// one field that does: only saved entries carry a `body`.
function isSaved(entry: SavedFilterQuery | FilterHistoryEntry): entry is SavedFilterQuery {
  return 'body' in entry;
}

async function applyEntry(entry: SavedFilterQuery | FilterHistoryEntry): Promise<void> {
  if (isSaved(entry)) {
    emit('apply', entry.body.where, entry.body.orderBy);
    await control.queriesTouch(entry.id);
  } else {
    emit('apply', entry.where, entry.orderBy);
  }
  emit('close');
}

// togglePin/remove are only wired to the saved section's own controls (SavedListMenu never
// renders them for a `recent` row) — the Entry-typed parameter is still checked defensively so
// a `history`-only entry, which has no `id` valid for these calls, can never reach the IPC.
async function togglePin(entry: SavedFilterQuery | FilterHistoryEntry): Promise<void> {
  if (!isSaved(entry)) return;
  await control.queriesUpdate(entry.id, { pinned: !entry.pinned });
  await reload();
}
async function rename(entry: SavedFilterQuery): Promise<void> {
  const name = await promptText('Rename saved filter', entry.name);
  if (!name || name.trim() === '') return;
  await control.queriesUpdate(entry.id, { name: name.trim() });
  await reload();
}
async function remove(entry: SavedFilterQuery | FilterHistoryEntry): Promise<void> {
  if (!isSaved(entry)) return;
  await control.queriesDelete(entry.id);
  await reload();
}

async function saveCurrent(): Promise<void> {
  if (!props.connectionId) return;
  const name = await promptText('Name this filter', '');
  if (!name || name.trim() === '') return;
  await control.queriesSave({
    connectionId: props.connectionId,
    path: props.path,
    name: name.trim(),
    body: { where: props.currentFilter, orderBy: props.currentSort },
    pinned: false,
  });
  await reload();
}
</script>

<template>
  <SavedListMenu
    title="Saved"
    :saved="savedEntries"
    :recent="historyEntries"
    panel-test-id="filter-history"
    backdrop-test-id="filter-history-backdrop"
    saved-entry-test-id="saved-entry"
    recent-entry-test-id="history-entry"
    empty-saved-text="No saved filters"
    empty-recent-text="No history yet"
    @apply="applyEntry"
    @toggle-pin="togglePin"
    @delete="remove"
    @close="emit('close')"
  >
    <template #entry="{ entry }">
      <span v-if="isSaved(entry)" class="entry-name">{{ entry.name }}</span>
      <span v-else class="entry-name mono">{{ summarize(entry.where, entry.orderBy) }}</span>
    </template>
    <template #entry-actions="{ entry }">
      <IconButton
        v-if="isSaved(entry)"
        icon="edit"
        :size="12"
        title="Rename"
        @click.stop="rename(entry)"
      />
    </template>
    <template #footer>
      <div class="p-sep" />
      <button type="button" class="save-current p-row" data-testid="save-current-filter" @click="saveCurrent">
        <span class="icon-box"><Codicon name="add" :size="12" /></span>
        Save current filter…
      </button>
    </template>
  </SavedListMenu>

  <div v-if="textPrompt" class="prompt-scrim" data-testid="text-prompt" @click.stop>
    <div class="prompt-box p-float">
      <div class="prompt-title p-sm muted">{{ textPrompt.title }}</div>
      <!-- Left as a raw .p-input-styled <input> rather than <TextField>: promptInput is a
           template ref used imperatively (`promptInput.value?.focus()` above) to autofocus this
           field when the prompt opens. TextField has no defineExpose, so a ref on it resolves to
           the component instance, not the inner <input> — that focus() call would break
           (rule 3: correctness over consistency). -->
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
        <Button kind="dialog" data-testid="text-prompt-cancel" @click="cancelPrompt"> Cancel </Button>
        <Button kind="dialog" variant="primary" data-testid="text-prompt-ok" @click="submitPrompt">
          OK
        </Button>
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
