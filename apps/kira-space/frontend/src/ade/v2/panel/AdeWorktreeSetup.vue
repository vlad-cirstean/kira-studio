<script setup lang="ts">
import { queryClient } from '@workbench/state/queryClient';
import { nextTick, ref, watch } from 'vue';
import type { CardModel } from '../plan/usePlanModel';
import { logKey } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import AdeSetupProgress from './AdeSetupProgress.vue';

// Details tab Worktree setup block (SPEC2 section 6.1): the branch's setup status with its log.
const props = defineProps<{ row: CardModel['rows'][number] }>();
const ui = useAdeBoardUiStore();
const root = ref<HTMLElement | null>(null);

// A retry restarts the log's sequence numbers at 1, so the cached log (and its pushes) is stale.
watch(
  () => props.row.branch.setup?.startedAt,
  (next, prev) => {
    if (prev !== undefined && next !== prev) {
      void queryClient.resetQueries({ queryKey: logKey('setup', props.row.id), exact: true });
    }
  },
);

watch(
  () => [ui.focusSetup, root.value] as const,
  async ([focus, el]) => {
    if (!focus || !el) return;
    await nextTick();
    el.scrollIntoView({ block: 'nearest' });
    ui.focusSetup = false;
  },
  { immediate: true },
);
</script>

<template>
  <div v-if="row.branch.setup" ref="root" class="flex flex-col gap-0.5" data-testid="ade-worktree-setup">
    <div class="pb-0.5 text-kira-sm text-muted-foreground">Worktree setup</div>
    <AdeSetupProgress :branch="row.branch" :repo="row.repo" />
  </div>
</template>
