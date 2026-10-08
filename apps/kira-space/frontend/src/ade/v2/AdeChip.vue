<script setup lang="ts">
import type { Tone } from './board/actions';
import { TONE_TAG_CLASS } from './tones';

// Status chip: tone-tinted pill. `wide` pads it to a fixed width so rows of chips align.
defineProps<{ label: string; tone: Tone; wide?: boolean }>();
</script>

<template>
  <span
    class="box-border shrink-0 whitespace-nowrap rounded-kira-sm px-1.5 py-px text-kira-sm font-semibold"
    :class="[TONE_TAG_CLASS[tone], wide ? 'min-w-21 text-center' : '']"
    data-testid="ade-chip"
    >{{ label }}</span
  >
</template>
