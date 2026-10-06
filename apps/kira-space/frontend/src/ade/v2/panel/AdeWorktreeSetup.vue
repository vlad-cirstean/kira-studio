<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { useIntervalFn } from '@vueuse/core';
import { queryClient } from '@workbench/state/queryClient';
import { computed, nextTick, ref, watch } from 'vue';
import AdeChip from '../AdeChip.vue';
import type { Tone } from '../board/actions';
import { formatElapsed } from '../board/actions';
import type { CardModel } from '../plan/usePlanModel';
import { logKey, useRetrySetup } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { solidStyle } from '../tones';
import type { WorktreeSetup } from '../wire';
import AdeRunLog from './AdeRunLog.vue';

// Details tab Worktree setup block (SPEC2 section 6.1): status, Retry setup, duration and the
// prepare-worktree log; the log is hidden once the worktree is ready.
const props = defineProps<{ row: CardModel['rows'][number] }>();
const ui = useAdeBoardUiStore();
const retry = useRetrySetup();
const setup = computed((): WorktreeSetup | null => props.row.branch.setup);
const running = computed(() => setup.value?.state === 'running');
const now = ref(Date.now());
const ticker = useIntervalFn(
  () => {
    now.value = Date.now();
  },
  1000,
  { immediate: false },
);
watch(
  running,
  (r) => {
    if (r) {
      now.value = Date.now();
      ticker.resume();
    } else ticker.pause();
  },
  { immediate: true },
);
// A retry restarts the log's sequence numbers at 1, so the cached log (and its pushes) is stale.
watch(
  () => setup.value?.startedAt,
  (next, prev) => {
    if (prev !== undefined && next !== prev) {
      void queryClient.resetQueries({ queryKey: logKey('setup', props.row.id), exact: true });
    }
  },
);
const root = ref<HTMLElement | null>(null);
const error = ref('');

const TONE_OF: Record<string, Tone> = { running: 'blue', ready: 'green', failed: 'red' };
const LABEL: Record<string, string> = { running: 'preparing', ready: 'ready', failed: 'failed' };
const took = computed(() => {
  const s = setup.value;
  if (!s) return '';
  const end = s.finishedAt ?? now.value;
  return formatElapsed(end - s.startedAt);
});

async function onRetry(): Promise<void> {
  error.value = '';
  try {
    await retry.mutateAsync({ branchId: props.row.id });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

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
  <div v-if="setup" ref="root" class="flex flex-col gap-0.5" data-testid="ade-worktree-setup">
    <div class="pb-0.5 text-kira-sm text-muted-foreground">Worktree setup</div>
    <div class="flex h-[30px] items-center gap-2 rounded-kira bg-elevated px-1.5">
      <AdeChip :label="LABEL[setup.state] ?? setup.state" :tone="TONE_OF[setup.state] ?? 'grey'" wide />
      <Button
        v-if="setup.state === 'failed'"
        size="xs"
        class="h-5 shrink-0 rounded-kira-xs px-2 text-kira-sm font-semibold"
        :style="solidStyle('amber')"
        data-testid="ade-setup-retry"
        @click="onRetry"
      >
        Retry setup
      </Button>
      <span class="min-w-0 truncate text-kira-sm text-muted-foreground" data-testid="ade-setup-detail"
        >{{ took }} · prepare-worktree script of {{ row.repo }}</span
      >
    </div>
    <p v-if="error" class="m-0 text-kira-sm text-error" data-testid="ade-setup-error">{{ error }}</p>
    <AdeRunLog v-if="running || setup.state === 'failed'" kind="setup" :id="row.id" max-height="160px" />
  </div>
</template>
