<script setup lang="ts" generic="T extends string | number">
// P6. Generic so each caller keeps its own literal union for `modelValue` (e.g. 'all' | 'running'
// | 'error', or a numeric page-size union) instead of widening to string. See
// theme/primitives/VirtualList.vue for this codebase's other precedent for a generic SFC.
withDefaults(
  defineProps<{
    modelValue: T;
    options: readonly { value: T; label: string; title?: string; testid?: string }[];
    size?: 'sm' | 'md';
  }>(),
  { size: 'sm' },
);

defineEmits<{ 'update:modelValue': [value: T] }>();
</script>

<template>
  <div class="p-seg" :class="{ md: size === 'md' }">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      :class="{ on: opt.value === modelValue }"
      v-tooltip="opt.title"
      :data-testid="opt.testid"
      @click="$emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
