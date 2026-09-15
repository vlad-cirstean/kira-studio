<script setup lang="ts" generic="T extends string | number">
// P6. Generic so each caller keeps its own literal union for `modelValue` (e.g. 'all' | 'running'
// | 'error', or a numeric page-size union) instead of widening to string. See
// theme/primitives/VirtualList.vue for this codebase's other precedent for a generic SFC.
withDefaults(
  defineProps<{
    modelValue: T;
    options: readonly { value: T; label: string; title?: string; testid?: string }[];
    size?: 'sm' | 'md';
    // M2 §7.2: the MCP tab's three permission rows disable (not hide) while mcpEnabled is false —
    // real disabled buttons, unlike a passed-through `disabled` attr (which would land on this
    // component's root div and do nothing, since a plain <div> has no such semantics).
    disabled?: boolean;
  }>(),
  { size: 'sm', disabled: false },
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
      :disabled="disabled"
      v-tooltip="opt.title"
      :data-testid="opt.testid"
      @click="$emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
