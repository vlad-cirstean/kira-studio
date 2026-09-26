<script setup lang="ts">
import { computed } from 'vue';

// P110 I2-4: the toolbar run-state ring + elapsed-time label, pasted into 11 Studio views (§2.2
// audit §1g). LAW 12: a ring + elapsed time in the toolbar that started the work, never a bar
// across the view. Lives in the theme package, not Studio's own views/shared/, because two
// consumers (api/EnvironmentsView.vue, api/VariableSetView.vue) sit behind a lint boundary that
// forbids api/ importing views/ at all (biome.json's api/ noRestrictedImports) -- the state shape
// is declared locally so this file takes no dependency back on app code.
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

const RING: Record<RunState['status'], string> = {
  idle: 'border-border-strong',
  running: 'border-primary border-r-transparent animate-spin',
  error: 'border-error',
};

const label = computed(() => {
  if (props.state.status === 'error') return 'failed';
  if (props.state.elapsedMs === null) return '—';
  return props.state.elapsedMs < 1000
    ? `${Math.round(props.state.elapsedMs)} ms`
    : `${(props.state.elapsedMs / 1000).toFixed(1)} s`;
});
</script>

<template>
  <span
    data-testid="run-state"
    :class="['inline-flex items-center gap-1 font-data text-kira-sm', TONE[state.status]]"
  >
    <span data-testid="run-state-label" class="min-w-[7ch] text-right">{{ label }}</span>
    <span :class="['h-3 w-3 shrink-0 rounded-full border-2', RING[state.status]]" />
  </span>
</template>
