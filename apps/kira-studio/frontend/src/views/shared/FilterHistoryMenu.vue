<script setup lang="ts">
import type { FilterHistoryEntry, SavedFilterQuery, SortSpec } from '@shared/domain/queries';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Separator } from '@theme/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import TextPromptDialog from '@workbench/prompt/TextPromptDialog.vue';
import { useTextPrompt } from '@workbench/prompt/useTextPrompt';
import { computed, onMounted, ref } from 'vue';
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

// P107 T2-19: shared in-app substitute for window.prompt() (Electron's renderer doesn't implement
// it) — see packages/workbench/src/prompt/useTextPrompt.ts.
const { prompt: textPrompt, open: promptText, submit: submitPrompt, cancel: cancelPrompt } = useTextPrompt();

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
    saved-entry-test-id="saved-entry"
    recent-entry-test-id="history-entry"
    empty-saved-text="No saved filters"
    empty-recent-text="No history yet"
    @apply="applyEntry"
    @toggle-pin="togglePin"
    @delete="remove"
  >
    <template #entry="{ entry }">
      <!-- P31 D27/F27: full, untruncated text — the popover is 320px and a WHERE/ORDER BY clause
           routinely isn't, so truncation here is structural, not a sizing accident. TooltipContent
           already wraps (P104 §6.2), so a long clause wraps instead. -->
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
          <span class="entry-name font-data flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{
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
      <Separator class="my-1" />
      <!-- text-primary, never text-hover — hover reads --kira-hover (grey), same precedent
           api/CollectionRow.vue's rename-input already documents. P110 I2-37 retired the shadcn
           accent alias this comment used to warn against; hover is its I2-37 replacement name. -->
      <button type="button" class="h-control flex items-center gap-1 px-1.5 rounded-kira-sm text-kira-md cursor-pointer hover:bg-hover w-full text-primary" data-testid="save-current-filter" @click="saveCurrent">
        <span class="size-4 flex items-center justify-center shrink-0"><CodiconIcon name="add" :size="13" /></span>
        Save current filter…
      </button>
      <!-- P107 T2-19 (was P104): TextPromptDialog.vue must stay a descendant of PopoverContent
           (the #footer slot renders inside it), not a sibling of <SavedListMenu> — its own
           imperative .focus() on mount would otherwise move focus outside reka's Popover content
           boundary, which its own dismiss layer reads as an outside interaction and closes the
           whole menu before the prompt is ever seen (data-view.spec.ts's save-current-filter
           scenario caught it; see that file's own header comment for why it isn't shadcn's Dialog). -->
      <TextPromptDialog
        v-if="textPrompt"
        :title="textPrompt.title"
        :model-value="textPrompt.value"
        @update:model-value="(v) => textPrompt && (textPrompt.value = v)"
        @submit="submitPrompt"
        @cancel="cancelPrompt"
      />
    </template>
  </SavedListMenu>
</template>
