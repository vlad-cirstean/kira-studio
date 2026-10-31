<script setup lang="ts">
import { Badge } from '@theme/components/ui/badge';
import type { Tone } from './board/actions';
import { STATUS_CHIP_CLASS } from './statusColors';
import { TONE_TAG_CLASS } from './tones';
import type { StatusColor } from './wire';

// Chip: a tinted pill, tone for derived state or `color` for a task status (it wins over `tone`).
// `wide` pads it to a fixed width so rows of chips align.
defineProps<{ label: string; tone?: Tone; color?: StatusColor; wide?: boolean }>();
</script>

<template>
  <Badge
    variant="chip"
    :class="[
      color ? STATUS_CHIP_CLASS[color] : TONE_TAG_CLASS[tone ?? 'grey'],
      wide ? 'min-w-21 justify-center' : '',
    ]"
    :data-tone="color ? undefined : (tone ?? 'grey')"
    :data-color="color"
    data-testid="ade-chip"
    >{{
      label
    }}</Badge
  >
</template>
