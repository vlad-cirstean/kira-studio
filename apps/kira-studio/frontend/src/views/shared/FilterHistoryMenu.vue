<script setup lang="ts">
import type { FilterHistoryEntry, SavedFilterQuery, SortSpec } from '@shared/domain/queries';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { wrapSelectionOnType } from '@theme/wrapSelection';
import { computed, nextTick, onMounted, ref } from 'vue';
import { control } from '../../bridge/control';
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
const promptInput = ref<{ $el: HTMLElement } | null>(null);
function promptText(title: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    textPrompt.value = { title, value: initial, resolve };
    void nextTick(() => promptInput.value?.$el.focus());
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
      <!-- P31 D27/F27: full, untruncated text — the popover is 320px and a WHERE/ORDER BY clause
           routinely isn't, so truncation here is structural, not a sizing accident. AppTooltip is
           already max-width: 320px; white-space: pre-wrap, so a long clause wraps instead. -->
      <Tooltip v-if="isSaved(entry)">
        <TooltipTrigger as-child>
          <span class="entry-name flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{
            entry.name
          }}</span>
        </TooltipTrigger>
        <TooltipContent class="whitespace-pre-wrap"
          >{{ entry.name }}&#10;{{ summarize(entry.body.where, entry.body.orderBy) }}</TooltipContent
        >
      </Tooltip>
      <Tooltip v-else>
        <TooltipTrigger as-child>
          <span class="entry-name mono flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{
            summarize(entry.where, entry.orderBy)
          }}</span>
        </TooltipTrigger>
        <TooltipContent>{{ summarize(entry.where, entry.orderBy) }}</TooltipContent>
      </Tooltip>
    </template>
    <template #entry-actions="{ entry }">
      <Tooltip v-if="isSaved(entry)">
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            aria-label="Rename"
            @click.stop="rename(entry)"
          >
            <CodiconIcon name="edit" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Rename</TooltipContent>
      </Tooltip>
    </template>
    <template #footer>
      <div class="p-sep" />
      <button type="button" class="save-current p-row" data-testid="save-current-filter" @click="saveCurrent">
        <span class="icon-box"><CodiconIcon name="add" :size="13" /></span>
        Save current filter…
      </button>
    </template>
  </SavedListMenu>

  <div v-if="textPrompt" class="prompt-scrim" data-testid="text-prompt" @click.stop>
    <div class="prompt-box p-float">
      <div class="prompt-title p-sm muted">{{ textPrompt.title }}</div>
      <!-- Input's own root *is* the <input> itself, so promptInput's $el (used imperatively above
           to autofocus this field when the prompt opens) reaches it directly. -->
      <Input
        ref="promptInput"
        v-model="textPrompt.value"
        type="text"
        class="w-full"
        data-testid="text-prompt-input"
        @keydown="wrapSelectionOnType"
        @keydown.enter="submitPrompt"
        @keydown.escape="cancelPrompt"
      />
      <div class="prompt-actions">
        <Button variant="dialog" size="kira-lg" data-testid="text-prompt-cancel" @click="cancelPrompt">Cancel</Button>
        <Button variant="dialog-primary" size="kira-lg" data-testid="text-prompt-ok" @click="submitPrompt">
          OK
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

/* text-primary, never text-accent — shadcn-bridge.css maps --color-accent to --kira-hover
   (grey), same precedent api/CollectionRow.vue's rename-input already documents. */
.save-current {
  @apply w-full cursor-pointer text-primary;
}

.prompt-scrim {
  @apply fixed inset-0 flex items-center justify-center bg-black/50;
  /* P28 D17(c): the dialog rung, not a bare 30 tuned against PopoverPanel's own old 20. This
     prompt is raised from *inside* a popover and must paint above that popover's full-viewport
     backdrop, or the backdrop swallows every click aimed at these buttons — which is exactly what
     the ladder change caused until this line joined it (console.spec.ts caught it). */
  z-index: var(--kira-z-dialog);
}

.prompt-box {
  @apply w-[280px] flex flex-col gap-1.5 p-2;
}

.prompt-actions {
  @apply flex justify-end gap-1.5;
}
</style>
