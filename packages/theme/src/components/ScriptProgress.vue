<script setup lang="ts">
import { useNow } from '@vueuse/core';
import { computed, watch } from 'vue';

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

const { now, pause, resume } = useNow({ interval: 1000, controls: true, immediate: props.state === 'running' });
watch(
  () => props.state,
  (s) => (s === 'running' ? resume() : pause()),
);

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

const elapsed = computed(() => {
  if (props.state === 'running') return format(now.value.getTime() - props.startedAt);
  return props.finishedAt == null ? '' : format(props.finishedAt - props.startedAt);
});
</script>

<template>
  <div
    class="flex min-w-0 flex-col gap-1.5 rounded-kira-sm border bg-field px-2.5 py-2"
    :class="state === 'failed' ? 'border-error' : 'border-border-strong'"
    :data-state="state"
    data-testid="script-progress"
  >
    <div class="flex min-w-0 items-center gap-2 text-kira-md">
      <span
        v-if="state === 'running'"
        class="size-3 shrink-0 animate-spin rounded-full border-2 border-info border-r-transparent"
        role="status"
        aria-label="Running"
      />
      <i v-else-if="state === 'ready'" class="codicon codicon-check shrink-0 text-ok" aria-hidden="true" />
      <i v-else class="codicon codicon-error shrink-0 text-error" aria-hidden="true" />
      <span class="min-w-0 truncate font-semibold" data-testid="script-progress-title">{{ title }}</span>
      <span v-if="elapsed" class="shrink-0 font-data text-kira-sm text-muted-foreground" data-testid="script-progress-elapsed">
        {{ elapsed }}<template v-if="state === 'running' && timeout"> of {{ timeout }}</template>
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
  </div>
</template>
