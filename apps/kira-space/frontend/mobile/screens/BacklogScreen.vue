<script setup lang="ts">
import { adeAgoOptions } from '@ade/ago';
import { parseGithub } from '@ade/board/panelFacts';
import { useBacklog } from '@ade/readQueries';
import type { BacklogItem } from '@ade/wire';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@theme/components/ui/empty';
import { Input } from '@theme/components/ui/input';
import { useTimeAgo } from '@vueuse/core';
import { useSortableReorder } from '@workbench/util/useSortableReorder';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import PermissionHint from '../components/PermissionHint.vue';
import { useAuthStore } from '../state/auth';
import { newIntentKey, useAdeWrites } from '../state/useAdeWrites';

// Backlog in priority order: add an item, drag a row by its handle to reorder, tap a row for its
// notes.
const backlog = useBacklog();
const { permissions } = storeToRefs(useAuthStore());
const writes = useAdeWrites();
const open = ref<string | null>(null);
const text = ref('');
const error = ref('');
const list = ref<HTMLElement | null>(null);
const canWrite = computed(() => permissions.value.write);
const ids = computed(() => backlog.data.value?.items.map((i) => i.id) ?? []);

function facts(item: BacklogItem): string {
  const gh = parseGithub(item.githubUrl);
  return [item.jira?.key ?? '', gh ? `${gh.kind === 'PR' ? 'PR' : 'issue'} ${gh.ref}` : '']
    .filter(Boolean)
    .join(' · ');
}
const ago = (at: number) => useTimeAgo(at, adeAgoOptions);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function add(): Promise<void> {
  const value = text.value.trim();
  if (!value || writes.addBacklogItem.isPending.value) return;
  error.value = '';
  try {
    await writes.addBacklogItem.mutateAsync({ text: value, key: newIntentKey() });
    text.value = '';
  } catch (err) {
    error.value = message(err);
  }
}

// Same rule as the backend's Move: the item lands at the index the target row had.
useSortableReorder(
  list,
  () => ids.value,
  (fromId, toId) => {
    error.value = '';
    writes.moveBacklogItem
      .mutateAsync({ id: fromId, toIndex: ids.value.indexOf(toId), key: newIntentKey() })
      .catch((err) => {
        error.value = message(err);
      });
  },
  {
    draggable: '[data-backlog-row]',
    handle: '[data-drag-handle]',
    direction: 'vertical',
    disabled: () => !canWrite.value,
  },
);
</script>

<template>
  <section class="flex flex-col" data-testid="backlog-screen">
    <PermissionHint v-if="!canWrite" what="Adding and reordering are off for this phone." />
    <form v-else class="flex gap-2 border-b border-border p-3" @submit.prevent="add">
      <Input
        :model-value="text"
        class="h-11 flex-1"
        placeholder="Add to the backlog"
        enterkeyhint="done"
        @update:model-value="(v) => (text = String(v))"
        data-testid="backlog-add"
      />
      <Button size="kira"
        type="submit"
        variant="dialog-primary"
        class="h-11 px-4"
        :disabled="!text.trim() || writes.addBacklogItem.isPending.value"
        data-testid="backlog-add-submit"
      >
        Add
      </Button>
    </form>
    <Alert v-if="error" variant="destructive" class="m-3 w-auto" data-testid="backlog-write-error">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>
    <p v-if="backlog.isPending.value" class="m-0 p-4 text-muted-foreground">Loading</p>
    <Alert v-else-if="backlog.isError.value" variant="destructive" class="m-3 w-auto" data-testid="backlog-error">
      Could not load the backlog.
    </Alert>
    <Empty v-else-if="!backlog.data.value?.items.length" class="py-10" data-testid="backlog-empty">
      <EmptyHeader>
        <EmptyTitle>The backlog is empty</EmptyTitle>
        <EmptyDescription>Items added here or in Kira Space appear here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
    <ol v-else ref="list" class="m-0 flex list-none flex-col p-0">
      <li
        v-for="(item, index) in backlog.data.value.items"
        :key="item.id"
        class="border-b border-border bg-bg"
        data-backlog-row
        data-testid="backlog-item"
      >
        <div class="flex items-stretch">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-start gap-3 bg-transparent px-3 py-2.5 text-left text-fg"
            :aria-expanded="open === item.id"
            @click="open = open === item.id ? null : item.id"
          >
            <span class="w-5 shrink-0 text-kira-sm text-subtle">{{ index + 1 }}</span>
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="text-kira-md">{{ item.text }}</span>
              <span class="text-kira-sm text-subtle">
                <template v-if="facts(item)">{{ facts(item) }} · </template>{{ ago(item.addedAt).value }}
              </span>
            </span>
          </button>
          <span
            v-if="canWrite"
            class="flex size-11 shrink-0 touch-none items-center justify-center text-subtle"
            role="img"
            aria-label="Drag to reorder"
            data-drag-handle
            data-testid="backlog-handle"
          >
            <CodiconIcon name="gripper" :size="16" />
          </span>
        </div>
        <p
          v-if="open === item.id"
          class="m-0 whitespace-pre-wrap px-3 pb-3 pl-11 text-kira-md text-muted-foreground"
          data-testid="backlog-notes"
        >
          {{ item.notes || 'No notes.' }}
        </p>
      </li>
    </ol>
  </section>
</template>
