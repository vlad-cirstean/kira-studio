<script setup lang="ts">
import { Badge } from '@theme/components/ui/badge';
import type { Tone } from './board/actions';
import { TONE_TAG_CLASS } from './tones';

// Status chip: tone-tinted pill. `wide` pads it to a fixed width so rows of chips align.
defineProps<{ label: string; tone: Tone; wide?: boolean }>();
</script>

<template>
  <Badge
    variant="chip"
    :class="[TONE_TAG_CLASS[tone], wide ? 'min-w-21 justify-center' : '']"
    data-testid="ade-chip"
    >{{
      label
    }}</Badge
  >
</template>
