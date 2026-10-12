<script setup lang="ts">
import Spinner from '@theme/components/Spinner.vue';
import { Card } from '@theme/components/ui/card';
import { t } from '@theme/i18n';
import { useIntervalFn } from '@vueuse/core';
import { computed, ref, watch } from 'vue';

// One status block for a worktree prepare script, shared by Kira Space's ADE and the git UI so a
// running, ready or failed script reads the same wherever it was started. The output (log lines)
// goes in the default slot; an action such as Retry goes in `actions`.
const props = defineProps<{
  state: 'running' | 'ready' | 'failed';
  title: string;
  /** Epoch ms the script started. */
  startedAt: number;
  /** Epoch ms it ended; absent while running. */
  finishedAt?: number | null;
  /** The configured timeout as text ("5m"), shown next to the elapsed time while running. */
  timeout?: string;
  /** Why it failed. */
  note?: string;
}>();

const now = ref(Date.now());
const { pause, resume } = useIntervalFn(() => (now.value = Date.now()), 1000, {
  immediate: props.state === 'running',
  immediateCallback: true,
});
watch(
  () => props.state,
  (s) => (s === 'running' ? resume() : pause()),
);

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return t('format.duration.secondsCompact', { seconds: total });
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0
    ? t('format.relative.unitMinute', { count: m })
    : t('format.duration.minutesSeconds', { minutes: m, seconds: s });
}

const elapsed = computed(() => {
  if (props.state === 'running') return format(now.value - props.startedAt);
  return props.finishedAt == null ? '' : format(props.finishedAt - props.startedAt);
});
</script>

<template>
  <Card
    :class="state === 'failed' && 'border-error'"
    :data-state="state"
    data-testid="script-progress"
  >
    <div class="flex min-w-0 items-center gap-2 text-kira-md">
      <Spinner
        v-if="state === 'running'"
        :size="12"
        class="text-info"
        :label="t('common.state.running.status')"
      />
      <i
        v-else-if="state === 'ready'"
        class="codicon codicon-check shrink-0 text-ok"
        aria-hidden="true"
      />
      <i v-else class="codicon codicon-error shrink-0 text-error" aria-hidden="true" />
      <span class="min-w-0 truncate font-medium" data-testid="script-progress-title">{{
        title
      }}</span>
      <span
        v-if="elapsed"
        class="shrink-0 font-data text-kira-sm text-muted-foreground"
        data-testid="script-progress-elapsed"
      >
        {{
          state === 'running' && timeout ? t('theme.scriptProgress.elapsedOf.label', { elapsed, timeout }) : elapsed
        }}
      </span>
      <span class="flex-1" />
      <slot name="actions" />
    </div>
    <p
      v-if="state === 'failed' && note"
      class="m-0 break-words text-kira-sm text-error"
      data-testid="script-progress-reason"
    >
      {{ note }}
    </p>
    <slot />
  </Card>
</template>
