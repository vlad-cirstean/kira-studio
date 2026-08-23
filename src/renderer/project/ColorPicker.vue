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
      :class="{ selected: modelValue === color }"
      :style="{ background: `var(--kira-conn-${color})` }"
      :aria-label="color"
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
</style>
