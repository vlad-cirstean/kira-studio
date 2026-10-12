<script setup lang="ts">
import { FieldDescription } from '@theme/components/ui/field';
import { t } from '@theme/i18n';
import { computed } from 'vue';
import AdeRepoTag from '../AdeRepoTag.vue';
import { taskTitle } from '../board/labels';
import { taskColor } from '../palette';
import type { ReviewWindowTarget } from '../wire';
import AdeReviewSync from './AdeReviewSync.vue';
import { useReviewContext } from './useReviewContext';

const props = defineProps<{ target: ReviewWindowTarget }>();

const { task, branch, repoLabel } = useReviewContext(() => props.target);
const title = computed(() =>
  task.value ? taskTitle(task.value, branch.value, '') : props.target.branch,
);
const dirtyCount = computed(() => branch.value?.dirty.length ?? 0);
</script>

<template>
  <header
    class="flex flex-none flex-col border-b border-border bg-chrome"
    data-testid="ade-review-header"
  >
    <div class="flex items-center gap-2 px-3 py-1.5">
      <span
        class="inline-block size-2.5 shrink-0 rounded-kira-xs"
        :style="{ background: taskColor(task?.color ?? 0) }"
        data-testid="ade-review-task-colour"
      />
      <span class="line-clamp-2 min-w-0 text-kira-lg font-medium" data-testid="ade-review-title">{{
        title
      }}</span>
      <AdeRepoTag :code-repo-id="target.codeRepoId" :label="repoLabel" />
      <span class="truncate font-data text-kira-sm" data-testid="ade-review-branch">{{
        target.branch
      }}</span>
      <span class="shrink-0 text-kira-sm text-muted-foreground" data-testid="ade-review-base">{{
        t('space.ade.review.header.base.label', { base: target.base })
      }}</span>
      <div class="ml-auto flex items-center gap-2">
        <AdeReviewSync :target="target" />
      </div>
    </div>
    <FieldDescription
      v-if="dirtyCount > 0"
      class="border-t border-border px-3 py-1"
      data-testid="ade-review-uncommitted"
    >
      {{ t('space.ade.review.header.uncommitted.hint', { count: dirtyCount }) }}
    </FieldDescription>
  </header>
</template>
