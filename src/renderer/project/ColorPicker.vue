<script setup lang="ts">
import { type ConnectionColor, connectionColorSchema } from '@shared/connection';

// D18: colors are palette names resolved to var(--kira-conn-<name>) in CSS (tokens.css).

const COLORS = connectionColorSchema.options as readonly ConnectionColor[];

defineProps<{ modelValue: ConnectionColor }>();
const emit = defineEmits<{ 'update:modelValue': [ConnectionColor] }>();
</script>

<template>
  <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Connection color">
    <button
      v-for="color in COLORS"
      :key="color"
      type="button"
      role="radio"
      :aria-checked="color === modelValue"
      :aria-label="color"
      :data-testid="`color-${color}`"
      class="h-5 w-5 rounded-full ring-offset-2 ring-offset-elevated"
      :class="{ 'ring-2 ring-white': color === modelValue }"
      :style="{ background: `var(--kira-conn-${color})` }"
      @click="emit('update:modelValue', color)"
    />
  </div>
</template>
