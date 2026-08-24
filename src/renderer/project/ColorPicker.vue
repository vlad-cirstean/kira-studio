<script setup lang="ts">
import type { ConnectionColor } from '@shared/domain/connection';
import { connectionColorSchema } from '@shared/domain/connection';

defineProps<{ modelValue: ConnectionColor }>();
const emit = defineEmits<{ 'update:modelValue': [ConnectionColor] }>();

const colors = connectionColorSchema.options;
</script>

<template>
  <div class="color-picker" role="radiogroup" aria-label="Connection color">
    <button
      v-for="color in colors"
      :key="color"
      type="button"
      class="swatch"
      :class="{ selected: modelValue === color, none: color === 'none' }"
      :style="color === 'none' ? undefined : { background: `var(--kira-conn-${color})` }"
      v-tooltip="color === 'none' ? 'No colour' : color"
      :aria-label="color === 'none' ? 'No colour' : color"
      role="radio"
      :aria-checked="modelValue === color"
      :data-testid="`color-${color}`"
      @click="emit('update:modelValue', color)"
    />
  </div>
</template>

<style scoped>
/* P16 design system: the "swatches" object — a row of 16px hue circles, one
   lightness and chroma for all twelve (tokens.css's --kira-conn-*), selection
   shown as an outline rather than a tint so the colour itself never changes. */
.color-picker {
  display: flex;
  gap: var(--kira-s-2);
  align-items: center;
  flex-wrap: wrap;
  height: var(--kira-h-md);
}

.swatch {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.swatch.selected {
  outline: 2px solid var(--kira-fg);
  outline-offset: 2px;
}

/* P31 D26/F26: an outlined swatch with a diagonal slash — never a 13th hue standing in for
   "nothing chosen". A plain hollow ring (the previous look) read, beside twelve saturated
   circles on a dark surface, as "a very dark thirteenth colour" rather than "no colour"; the
   slash is the universal "none" mark and unmistakable even at 16px. Ring brightened from
   --kira-fg-disabled to --kira-fg-muted to read as deliberate rather than merely dim.
   .p-conn-dot.none (the 5px rail dot elsewhere) is a status dot, not a choice, and is untouched. */
.swatch.none {
  border: 1.5px solid var(--kira-fg-muted);
  background: linear-gradient(
    to top right,
    transparent calc(50% - 0.75px),
    var(--kira-fg-muted) calc(50% - 0.75px),
    var(--kira-fg-muted) calc(50% + 0.75px),
    transparent calc(50% + 0.75px)
  );
}
</style>
