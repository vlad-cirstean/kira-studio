<script setup lang="ts">
import type { SavedConsoleQuery } from '@shared/domain/queries';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { nextTick, onMounted, ref } from 'vue';
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

// Electron's renderer has no window.prompt() — same in-app substitute as FilterHistoryMenu.vue.
const textPrompt = ref<{
  title: string;
  value: string;
  resolve: (v: string | null) => void;
} | null>(null);
// Typed as the bare $el shape (rather than InstanceType<typeof Input>) so this ref doesn't read as
// a type-only use of the Input import above — it's a real component, bound as a value by the
// template below.
const promptInput = ref<{ $el: HTMLInputElement } | null>(null);
function promptText(title: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    textPrompt.value = { title, value: initial, resolve };
    // ui/input's root IS the <input> element itself (unlike the old TextField, which wrapped it in
    // a <span>), so $el is already the focus target — no querySelector needed.
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
      <Input
        ref="promptInput"
        :model-value="textPrompt.value"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-ui"
        data-testid="text-prompt-input"
        @update:model-value="(v) => { if (textPrompt) textPrompt.value = String(v); }"
        @keydown.enter="submitPrompt"
        @keydown.escape="cancelPrompt"
      />
      <div class="prompt-actions">
        <Button variant="dialog" size="kira-lg" data-testid="text-prompt-cancel" @click="cancelPrompt"
          >Cancel</Button
        >
        <Button
          variant="dialog-primary"
          size="kira-lg"
          data-testid="text-prompt-ok"
          @click="submitPrompt"
          >OK</Button
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

/* text-[var(--kira-accent)] not text-accent: shadcn-bridge.css maps --color-accent to --kira-hover
   (grey), same workaround as api/CollectionRow.vue's rename-input (Part 3). */
.save-current {
  @apply w-full text-[var(--kira-accent)] cursor-pointer;
}

.prompt-scrim {
  /* P28 D17(c): the dialog rung, not a bare 30 tuned against PopoverPanel's own old 20. This
     prompt is raised from *inside* a popover and must paint above that popover's full-viewport
     backdrop, or the backdrop swallows every click aimed at these buttons — which is exactly what
     the ladder change caused until this line joined it (console.spec.ts caught it). */
  @apply fixed inset-0 flex items-center justify-center bg-black/50;
  z-index: var(--kira-z-dialog);
}

.prompt-box {
  @apply w-[280px] flex flex-col gap-1.5 p-2;
}

.prompt-actions {
  @apply flex justify-end gap-1.5;
}
</style>
