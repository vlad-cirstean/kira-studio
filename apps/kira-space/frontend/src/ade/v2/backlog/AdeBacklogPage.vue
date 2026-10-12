<script setup lang="ts">
import EmptyState from '@theme/components/EmptyState.vue';
import { paneFrame } from '@theme/components/frames';
import InlineState from '@theme/components/InlineState.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { FieldDescription } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { errorText } from '@workbench/bridge/codedError';
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
const selected = computed(
  () => items.value.find((i) => i.id === pickedId.value) ?? items.value[0] ?? null,
);
const text = ref('');
const error = ref('');

async function run(task: () => Promise<unknown>): Promise<boolean> {
  error.value = '';
  try {
    await task();
    return true;
  } catch (err) {
    error.value = errorText(err);
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
  if (item && to >= 0 && to < items.value.length)
    void run(() => move.mutateAsync({ id: item.id, toIndex: to }));
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
  if (
    !(await confirmDialogStore.confirm({
      title: t('space.ade.backlog.deleteConfirm.title'),
      message: t('space.ade.backlog.deleteConfirm.body', { text: item.text }),
      confirmLabel: t('common.action.delete.label'),
      tone: 'danger',
    }))
  )
    return;
  await run(() => remove.mutateAsync({ id }));
}

function onEdit(id: string, value: string): void {
  void run(() => update.mutateAsync({ id, patch: backlogPatch({ text: value }) }));
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 gap-0.5" data-testid="ade-backlog">
    <div :class="cn(paneFrame, 'flex flex-1 flex-col')">
      <PanelHeader>{{ t('space.common.backlog.label') }}</PanelHeader>
      <div class="flex shrink-0 flex-col gap-2 border-b border-border p-3">
        <FieldDescription>{{ t('space.ade.backlog.intro.hint') }}</FieldDescription>
        <Label for="ade-backlog-add" class="sr-only">{{ t('space.ade.backlog.add.label') }}</Label>
        <Input
          id="ade-backlog-add"
          v-model="text"
          :placeholder="t('space.ade.backlog.add.placeholder')"
          size="kira-lg"
          data-testid="ade-backlog-add"
          @keydown.enter="capture"
        />
        <Alert v-if="error" variant="error" data-testid="ade-backlog-page-error"
          ><AlertDescription>{{ error }}</AlertDescription></Alert
        >
      </div>
      <div class="flex min-h-0 flex-1 flex-col overflow-auto">
        <AdeBacklogRow
          v-for="(item, i) in items"
          :key="item.id"
          :item="item"
          :selected="selected?.id === item.id"
          @select="pickedId = item.id"
          @move="(d) => onMove(i, d)"
          @promote="onPromote(item.id)"
          @remove="onRemove(item.id)"
          @edit="(v) => onEdit(item.id, v)"
        />
        <InlineState v-if="!items.length" kind="empty">{{
          t('space.common.backlogEmpty.empty')
        }}</InlineState>
      </div>
    </div>
    <aside :class="cn(paneFrame, 'flex w-130 shrink-0 flex-col')">
      <AdeBacklogPanel
        v-if="selected"
        :key="selected.id"
        :item="selected"
        @promote="onPromote(selected.id)"
        @remove="onRemove(selected.id)"
      />
      <EmptyState v-else fill :title="t('space.ade.backlog.selectHint.hint')" />
    </aside>
  </div>
</template>
