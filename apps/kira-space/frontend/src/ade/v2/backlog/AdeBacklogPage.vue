<script setup lang="ts">
import { Input } from '@theme/components/ui/input';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { computed, ref } from 'vue';
import { backlogPatch } from '../board/panelFacts';
import {
  useAddBacklogItem,
  useBacklog,
  useDeleteBacklogItem,
  useMoveBacklogItem,
  usePromoteBacklogItem,
  useUpdateBacklogItem,
} from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import AdeBacklogPanel from './AdeBacklogPanel.vue';
import AdeBacklogRow from './AdeBacklogRow.vue';

// The backlog: a prioritised list (top is most important) with a detail panel beside it.
const ui = useAdeBoardUiStore();
const confirmDialogStore = useConfirmDialogStore();
const backlog = useBacklog();
const add = useAddBacklogItem();
const move = useMoveBacklogItem();
const update = useUpdateBacklogItem();
const remove = useDeleteBacklogItem();
const promote = usePromoteBacklogItem();

const items = computed(() => backlog.data.value?.items ?? []);
const pickedId = ref<string | null>(null);
const selected = computed(() => items.value.find((i) => i.id === pickedId.value) ?? items.value[0] ?? null);
const text = ref('');
const error = ref('');

async function run(task: () => Promise<unknown>): Promise<boolean> {
  error.value = '';
  try {
    await task();
    return true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    return false;
  }
}

async function capture(): Promise<void> {
  const value = text.value.trim();
  if (!value || add.isPending.value) return;
  if (await run(() => add.mutateAsync({ text: value }))) text.value = '';
}

function onMove(index: number, delta: -1 | 1): void {
  const item = items.value[index];
  const to = index + delta;
  if (item && to >= 0 && to < items.value.length) void run(() => move.mutateAsync({ id: item.id, toIndex: to }));
}

async function onPromote(id: string): Promise<void> {
  let taskId = '';
  if (
    await run(async () => {
      taskId = (await promote.mutateAsync({ id })).id;
    })
  )
    ui.openTask(taskId);
}

async function onRemove(id: string): Promise<void> {
  const item = items.value.find((i) => i.id === id);
  if (!item) return;
  if (!(await confirmDialogStore.confirmDialog(`Delete this backlog item?\n\n${item.text}`))) return;
  await run(() => remove.mutateAsync({ id }));
}

function onEdit(id: string, value: string): void {
  void run(() => update.mutateAsync({ id, patch: backlogPatch({ text: value }) }));
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 gap-0.5" data-testid="ade-backlog">
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden rounded-kira border border-border bg-bg">
      <PanelHeader>Backlog</PanelHeader>
      <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto p-3">
      <span class="text-kira-md text-muted-foreground">Get it out of your head. Order it later: top is most important. Not on the plan yet.</span>
      <label for="ade-backlog-add" class="sr-only">Add to backlog</label>
      <Input
        id="ade-backlog-add"
        v-model="text"
        placeholder="Type a thought and press Enter"
        class="h-[34px] rounded-kira-lg bg-field px-3 text-kira-lg"
        data-testid="ade-backlog-add"
        @keydown.enter="capture"
      />
      <span v-if="error" class="text-kira-sm text-error" data-testid="ade-backlog-page-error">{{ error }}</span>
      <AdeBacklogRow
        v-for="(item, i) in items"
        :key="item.id"
        :item="item"
        :selected="selected?.id === item.id"
        @pick="pickedId = item.id"
        @move="(d) => onMove(i, d)"
        @promote="onPromote(item.id)"
        @remove="onRemove(item.id)"
        @edit="(v) => onEdit(item.id, v)"
      />
      <div v-if="!items.length" class="px-3 py-6 text-kira-lg text-subtle">Backlog is empty.</div>
      </div>
    </div>
    <aside class="flex min-h-0 w-130 shrink-0 flex-col overflow-hidden rounded-kira border border-border bg-bg">
      <AdeBacklogPanel
        v-if="selected"
        :key="selected.id"
        :item="selected"
        @promote="onPromote(selected.id)"
        @remove="onRemove(selected.id)"
      />
      <div v-else class="p-5 text-kira-md text-subtle">Select an item to add links and notes.</div>
    </aside>
  </div>
</template>
