<script setup lang="ts">
import Spinner from '@theme/components/Spinner.vue';
import StatusDot from '@theme/components/StatusDot.vue';
import { displayValue, formatDuration } from '@theme/format';
import { t } from '@theme/i18n';
import { computed } from 'vue';

// The toolbar run-state mark and elapsed-time label: a mark and a time in the toolbar that started
// the work, never a bar across the view. Lives in the theme package because api/ views sit behind a
// lint boundary that forbids importing views/; the state shape is declared locally.
interface RunState {
  status: 'idle' | 'running' | 'error';
  elapsedMs: number | null;
}

const props = defineProps<{ state: RunState }>();

const TONE: Record<RunState['status'], string> = {
  idle: 'text-subtle',
  running: 'text-info',
  error: 'text-error',
};

const label = computed(() => {
  if (props.state.status === 'error') return t('common.state.failed.status');
  const ms = props.state.elapsedMs;
  return displayValue(ms === null ? null : formatDuration(ms));
});
</script>

<template>
  <span
    data-testid="run-state"
    :class="[
      'inline-flex items-center gap-1 font-data text-kira-sm tabular-nums',
      TONE[state.status],
    ]"
  >
    <span data-testid="run-state-label">{{ label }}</span>
    <Spinner v-if="state.status === 'running'" :size="12" label="" />
    <StatusDot v-else-if="state.status === 'error'" tone="error" />
  </span>
</template>
