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
.color-picker {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.swatch {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}

.swatch.selected {
  border-color: var(--kira-focus);
  box-shadow: 0 0 0 1px var(--kira-bg-elevated);
}
</style>
