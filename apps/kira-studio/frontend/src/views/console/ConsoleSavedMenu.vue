<script setup lang="ts">
import type { SavedConsoleQuery } from '@shared/domain/queries';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Separator } from '@theme/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import TextPromptDialog from '@workbench/prompt/TextPromptDialog.vue';
import { useTextPrompt } from '@workbench/prompt/useTextPrompt';
import { onMounted, ref } from 'vue';
import { control } from '../../bridge/control';
import { useTabsStore } from '../../state/tabs';
import SavedListMenu from '../shared/SavedListMenu.vue';
import { setText } from './state';

// A lean sibling of views/shared/FilterHistoryMenu.vue: saved-only (§8.14 gives the console no run
// history, only saved_queries), scoped to one tab's own connectionId/path. Both share the same
// popover shell/list layout via views/shared/SavedListMenu.vue.
const props = defineProps<{ tabId: string }>();
const emit = defineEmits<{ close: [] }>();

function tab() {
  return useTabsStore().findConsoleTab(props.tabId);
}

const saved = ref<SavedConsoleQuery[]>([]);

// P107 T2-19: shared in-app substitute for window.prompt() — see
// packages/workbench/src/prompt/useTextPrompt.ts (same one FilterHistoryMenu.vue uses).
const { prompt: textPrompt, open: promptText, submit: submitPrompt, cancel: cancelPrompt } = useTextPrompt();

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
    saved-entry-test-id="console-saved-entry"
    empty-saved-text="No saved queries"
    @apply="apply"
    @toggle-pin="togglePin"
    @delete="remove"
  >
    <template #entry="{ entry }">
      <!-- P31 D27/F27: full, untruncated text — same reasoning as views/shared/FilterHistoryMenu.vue's
           own note (the 320px popover is structurally too narrow for a saved query's full text). -->
      <Tooltip>
        <TooltipTrigger as-child>
          <span class="entry-name flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{
            entry.name
          }}</span>
        </TooltipTrigger>
        <TooltipContent class="whitespace-pre-wrap">{{ `${entry.name}\n${entry.body.text}` }}</TooltipContent>
      </Tooltip>
    </template>
    <template #entry-actions="{ entry }">
      <Tooltip>
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
      <button type="button" class="save-current p-row" data-testid="console-save-current" @click="saveCurrent">
        <span class="size-4 flex items-center justify-center shrink-0"><CodiconIcon name="add" :size="13" /></span>
        Save current query…
      </button>
      <!-- P107 T2-19 (was P104): TextPromptDialog.vue must stay a descendant of PopoverContent
           (the #footer slot renders inside it), not a sibling of <SavedListMenu> — its own
           imperative .focus() on mount would otherwise move focus outside reka's Popover content
           boundary, which its own dismiss layer reads as an outside interaction and closes the
           whole menu before the prompt is ever seen (console.spec.ts's saved-queries scenario
           caught it; see that file's own header comment for why it isn't shadcn's Dialog). -->
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

<style scoped>
@reference "@theme/base.css";

/* text-[var(--kira-accent)] not text-accent: shadcn-bridge.css maps --color-accent to --kira-hover
   (grey), same workaround as api/CollectionRow.vue's rename-input (Part 3). */
.save-current {
  @apply w-full text-[var(--kira-accent)] cursor-pointer;
}
</style>
