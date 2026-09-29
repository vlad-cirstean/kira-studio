<script setup lang="ts">
import { computed } from 'vue';
import { historySpanText } from './ago';

// P129 Part 5 §0.7/§0.9: the closed timeline's own dashed pull row (mockup 1783-1786) — purple fill
// grows with `pct`, text stages through pull/release/default. `useHistoryPull` (§0.7) owns the
// gesture state; this component is presentation only.
const props = defineProps<{
  pull: number;
  pct: number;
  historyCount: number;
  historyDays: number;
}>();

const emit = defineEmits<{ open: [] }>();

const text = computed(() => {
  if (props.pull > 0) return props.pct >= 100 ? 'Release to open history' : 'Keep scrolling up to open history';
  return `History · ${props.historyCount} archived in the last ${historySpanText(props.historyDays)}`;
});
</script>

<template>
  <button
    type="button"
    class="relative my-0.5 ml-15 flex h-7 w-[calc(100%-60px)] items-center justify-center gap-2 overflow-hidden rounded-kira-sm border border-dashed border-border-strong bg-transparent text-kira-sm text-muted-foreground"
    data-testid="ade-history-pull"
    @click="emit('open')"
  >
    <span
      class="absolute inset-y-0 left-0 transition-[width] duration-100"
      :style="{ width: `${pct}%`, background: 'rgba(163,113,247,0.18)' }"
    />
    <span class="relative">↑</span>
    <span class="relative">{{ text }}</span>
  </button>
</template>
