<script setup lang="ts">
// P104 §6.2: v-tooltip deleted; real Tooltip/TooltipTrigger/TooltipContent trio. The trigger has
// its own visible text (the elapsed-time label), so no extra aria-label is needed here.
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
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
  <Tooltip :disabled="!title">
    <TooltipTrigger as-child>
      <span
        class="p-run-state inline-flex items-center gap-1 font-data text-kira-xs text-subtle"
        :class="{ 'text-info': status === 'running', 'text-error': status === 'error' }"
      >
        <span class="label min-w-[7ch] text-right">{{ label }}</span
        ><span
          class="ring h-[11px] w-[11px] shrink-0 rounded-full border-[1.5px] border-border-strong"
          :class="{ 'animate-[spin_0.7s_linear_infinite] border-t-accent border-r-transparent border-b-accent border-l-accent': status === 'running', 'border-error': status === 'error' }"
        />
      </span>
    </TooltipTrigger>
    <TooltipContent v-if="title">{{ title }}</TooltipContent>
  </Tooltip>
</template>
