<script setup lang="ts">
import { computed } from 'vue';

// P16 design system LAW 12: work-in-progress is a ring and an elapsed time in the toolbar that
// started it, never a bar across the top of the view. See apps/kira-studio/frontend/src/state/runState.ts for
// the one shared ticker this reads its `elapsedMs` from.
//
// `.p-run-state` stays a marker (§1.7's protected class list); its own CSS rule is emptied in
// primitives.css, styling moved to Tailwind here.
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
    class="p-run-state inline-flex items-center gap-[var(--kira-s-2)] font-[family-name:var(--kira-font-data)] text-[length:var(--kira-t-xs)] text-subtle"
    :class="{ 'text-info': status === 'running', 'text-error': status === 'error' }"
    v-tooltip="title"
  >
    <span class="label min-w-[7ch] text-right">{{ label }}</span
    ><span
      class="ring h-[11px] w-[11px] shrink-0 rounded-full border-[1.5px] border-border-strong"
      :class="{ 'animate-[spin_0.7s_linear_infinite] border-t-accent border-r-transparent border-b-accent border-l-accent': status === 'running', 'border-error': status === 'error' }"
    />
  </span>
</template>
