<script setup lang="ts">
import type { QueueSpan } from './useQueue';

// P129 Part 5 §0.23: a continuation row (mockup 1245-1259) — day `idx+1` of a multi-day segment's
// own span, rendered on every day after its first. Click selects the lead and scrolls to its start
// day; the scroll itself is `AdeTimeline`'s (§0.9, landing Part 5 commit 7 with the scroll refs) —
// this component only emits the intent.
defineProps<{ span: QueueSpan }>();

const emit = defineEmits<{ pick: [lead: string, startDay: number] }>();
</script>

<template>
  <button
    type="button"
    :title="span.tip"
    class="ml-[218px] flex h-7 max-w-140 items-center gap-2 rounded-kira-sm border border-dashed border-[#34373f] border-l-3 bg-transparent px-2.5 text-left text-kira-sm text-muted-foreground"
    :style="{ borderLeftColor: span.color }"
    data-testid="ade-continuation-row"
    @click="emit('pick', span.lead, span.startDay)"
  >
    <span class="text-[#7c7f88]">↳</span>
    <span
      class="whitespace-nowrap"
      :class="span.isEnd ? 'text-[#f0b85c]' : 'text-[#7c7f88]'"
      >{{ span.note }}</span
    >
    <span class="min-w-0 flex-1 truncate font-semibold text-[#c9c7c2]">{{ span.title }}</span>
  </button>
</template>
