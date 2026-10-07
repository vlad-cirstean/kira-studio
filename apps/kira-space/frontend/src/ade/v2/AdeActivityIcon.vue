<script setup lang="ts">
import { computed } from 'vue';
import { ACTIVITY_LABEL, type ActivityKind } from './activity';
import { TONE, TONE_INK } from './tones';

// Activity glyph of a session: `!` needs input, a green dot working, `z` waiting on a monitor, an
// open dot idle, a square stopped (mockup `act`).
const props = defineProps<{ kind: ActivityKind; size?: 12 | 14 }>();

const big = computed(() => props.size === 14);
const badge = computed(() => (big.value ? 'size-3.5' : 'size-3'));
const dot = computed(() => (big.value ? 'size-2.5' : 'size-2'));
</script>

<template>
  <span :data-activity="kind" :title="ACTIVITY_LABEL[kind]" class="inline-flex shrink-0 items-center justify-center">
    <span
      v-if="kind === 'input'"
      :class="badge"
      class="flex items-center justify-center rounded-full text-kira-sm font-extrabold leading-none"
      :style="{ background: TONE.amber[2], color: TONE_INK.amber }"
      >!</span
    >
    <span
      v-else-if="kind === 'working'"
      :class="dot"
      class="m-0.5 inline-block rounded-full"
      :style="{
        background: TONE.green[2],
        boxShadow: `0 0 0 2px color-mix(in srgb, ${TONE.green[2]} 28%, transparent)`,
      }"
    />
    <span
      v-else-if="kind === 'waiting'"
      :class="badge"
      class="flex items-center justify-center rounded-full border-2 text-kira-sm font-bold leading-none"
      :style="{ borderColor: TONE.blue[2], color: TONE.blue[1] }"
      >z</span
    >
    <span v-else-if="kind === 'idle'" :class="dot" class="m-0.5 inline-block rounded-full border-2 border-subtle" />
    <span v-else class="m-0.75 inline-block size-1.5 rounded-kira-xs bg-disabled" />
  </span>
</template>
