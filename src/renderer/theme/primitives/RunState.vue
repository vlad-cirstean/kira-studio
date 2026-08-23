<script setup lang="ts">
import { computed } from 'vue';

// P16 design system LAW 12: work-in-progress is a ring and an elapsed time in the toolbar that
// started it, never a bar across the top of the view. See src/renderer/state/runState.ts for
// the one shared ticker this reads its `elapsedMs` from.
const props = defineProps<{
  status: 'idle' | 'running' | 'error';
  elapsedMs: number | null;
  title?: string;
}>();

const label = computed(() => {
  if (props.status === 'error') return 'failed';
  if (props.elapsedMs === null) return '—';
  return props.elapsedMs < 1000
    ? `${Math.round(props.elapsedMs)} ms`
    : `${(props.elapsedMs / 1000).toFixed(1)} s`;
});
</script>

<template>
  <span
    class="p-run-state"
    :class="{ 'is-running': status === 'running', 'is-error': status === 'error' }"
    :title="title"
  >
    <span class="ring" />{{ label }}
  </span>
</template>
