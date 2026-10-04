<script setup lang="ts">
import AdeTip from '../AdeTip.vue';
import { solidStyle, TONE } from '../tones';

// The `!` circle: something here needs you. A tooltip only; click targets land with the panel.
defineProps<{ tip: string }>();
</script>

<template>
  <AdeTip :text="tip">
    <span
      role="img"
      aria-label="Needs you"
      class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-kira-sm font-extrabold"
      :style="{ ...solidStyle('amber'), boxShadow: `0 0 0 3px ${TONE.amber[0]}` }"
      data-testid="ade-attention"
      >!</span
    >
  </AdeTip>
</template>
