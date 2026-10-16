<script setup lang="ts">
import { parseGithub } from '@ade/board/panelFacts';
import { useBacklog } from '@ade/readQueries';
import type { BacklogItem } from '@ade/wire';
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/components/EmptyState.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { t } from '@theme/i18n';
import { useSortableReorder } from '@workbench/behaviour/sortableReorder';
import { errorText } from '@workbench/bridge/codedError';
import QueryState from '@workbench/components/QueryState.vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import RelativeTime from '@/components/RelativeTime.vue';
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
  return [
    item.jira?.key ?? '',
    gh
      ? t(gh.kind === 'PR' ? 'space.common.githubPr.label' : 'space.common.githubIssue.label', {
          ref: gh.ref,
        })
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
const message = (err: unknown) => errorText(err);

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
    <PermissionHint v-if="!canWrite" :what="t('mobile.backlog.writeOff.hint')" />
    <form v-else class="flex gap-2 border-b border-border p-3" @submit.prevent="add">
      <Input
        :model-value="text"
        size="touch"
        class="flex-1"
        :placeholder="t('mobile.backlog.add.placeholder')"
        enterkeyhint="done"
        @update:model-value="(v) => (text = String(v))"
        data-testid="backlog-add"
      />
      <Button
        size="touch"
        type="submit"
        variant="dialog-primary"
        :pending="writes.addBacklogItem.isPending.value"
        :disabled="!text.trim()"
        data-testid="backlog-add-submit"
      >
        {{ t('common.action.add.label') }}
      </Button>
    </form>
    <Alert v-if="error" variant="error" strip data-testid="backlog-write-error">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>
    <QueryState :query="backlog" :is-empty="(d) => d.items.length === 0">
      <template #error>
        <Alert variant="error" strip data-testid="backlog-error">{{
          t('mobile.backlog.loadError.error')
        }}</Alert>
      </template>
      <template #empty>
        <EmptyState
          fill
          data-testid="backlog-empty"
          :title="t('space.common.backlogEmpty.empty')"
          :description="t('mobile.backlog.list.emptyHint')"
        />
      </template>
      <template #default="{ data }">
        <ol ref="list" class="m-0 flex list-none flex-col p-0">
          <li
            v-for="(item, index) in data.items"
            :key="item.id"
            class="border-b border-border bg-bg"
            data-backlog-row
            data-testid="backlog-item"
          >
            <div class="flex items-stretch">
              <button
                type="button"
                class="flex min-w-0 flex-1 items-start gap-3 bg-transparent px-3 py-3 text-left text-fg"
                :aria-expanded="open === item.id"
                @click="open = open === item.id ? null : item.id"
              >
                <span class="w-5 shrink-0 text-kira-sm text-subtle">{{ index + 1 }}</span>
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="text-kira-md">{{ item.text }}</span>
                  <span class="text-kira-sm text-subtle">
                    <template v-if="facts(item)">{{ facts(item) }} · </template>
                    <RelativeTime :at="item.addedAt" />
                  </span>
                </span>
              </button>
              <span
                v-if="canWrite"
                class="flex size-touch shrink-0 touch-none items-center justify-center text-subtle"
                role="img"
                :aria-label="t('mobile.backlog.handle.aria')"
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
              {{ item.notes || t('mobile.backlog.notes.empty') }}
            </p>
          </li>
        </ol>
      </template>
    </QueryState>
  </section>
</template>
