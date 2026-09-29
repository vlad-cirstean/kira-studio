<script setup lang="ts">
import { computed } from 'vue';
import type { ActivityKind } from './activity';

// P129 Part 5 §0.18: the five glyphs `AdeActivityIcon.vue` already renders (mockup `act(a, size)`,
// line 663), extracted so `AdeAgentsPill` can reuse them at its own 13px size — `AdeActivityIcon`
// keeps its own tooltip wrapper around this. Only `input`/`working`/`waiting`/`idle` vary by size
// (mockup's own `z`/`z-4`/`z-5` arithmetic); `stopped` is this app's own addition (§2.6 stage 1's
// doc comment) with no mockup size variant, so it stays fixed. P129 Part 6 §0.18 adds 14px for the
// Agents tab's own status strip (mockup `act(a, 14)`, line 1459).
const props = defineProps<{ kind: ActivityKind; size?: 12 | 13 | 14 }>();

const size = computed(() => props.size ?? 12);
// Tailwind's fixed scale covers 12px (size-3) and 14px (size-3.5); 13px has no scale step, so it's
// the one arbitrary value here — a one-off data-driven size (P110 rung 4), not a new token.
const badge = computed(() => {
  if (size.value === 14) return 'size-3.5';
  if (size.value === 13) return 'size-[13px]';
  return 'size-3';
});
const dot = computed(() => {
  if (size.value === 14) return 'size-2.5';
  if (size.value === 13) return 'size-[9px]';
  return 'size-2';
});
</script>

<template>
  <span :data-activity="kind" class="inline-flex shrink-0 items-center justify-center">
    <span
      v-if="kind === 'input'"
      :class="badge"
      class="flex items-center justify-center rounded-full bg-[#e8a33d] text-kira-sm font-extrabold leading-none text-[#15161a]"
      >!</span
    >
    <span
      v-else-if="kind === 'working'"
      :class="dot"
      class="m-0.5 inline-block rounded-full bg-[#6cc58a] shadow-[0_0_0_2px_rgba(108,197,138,0.28)]"
    />
    <span
      v-else-if="kind === 'waiting'"
      :class="badge"
      class="flex items-center justify-center rounded-full border-[1.5px] border-[#7aa7ff] text-kira-sm font-bold leading-none text-[#93b6ff]"
      >z</span
    >
    <span
      v-else-if="kind === 'idle'"
      :class="dot"
      class="m-0.5 inline-block rounded-full border-[1.5px] border-subtle"
    />
    <span v-else class="m-[3px] inline-block size-1.5 rounded-[2px] bg-disabled" />
  </span>
</template>
