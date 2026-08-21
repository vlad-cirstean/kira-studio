<script setup lang="ts">
import { type ConnectionColor, connectionColorSchema } from '@shared/connection';

// D18: colors are palette names resolved to var(--kira-conn-<name>) in CSS (tokens.css).

const COLORS = connectionColorSchema.options as readonly ConnectionColor[];

defineProps<{ modelValue: ConnectionColor }>();
const emit = defineEmits<{ 'update:modelValue': [ConnectionColor] }>();
</script>

<template>
  <div class="color-picker" role="radiogroup" aria-label="Connection color">
    <button
      v-for="color in COLORS"
      :key="color"
      type="button"
      role="radio"
      :aria-checked="color === modelValue"
      :aria-label="color"
      :data-testid="`color-${color}`"
      class="swatch"
      :class="{ selected: color === modelValue }"
      :style="{ background: `var(--kira-conn-${color})` }"
      @click="emit('update:modelValue', color)"
    />
  </div>
</template>

<style scoped>
.color-picker {
  display: flex;
  align-items: center;
  gap: 4px;
}

.swatch {
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
}

.swatch.selected {
  outline: 2px solid var(--kira-focus);
  outline-offset: 1px;
}
</style>
