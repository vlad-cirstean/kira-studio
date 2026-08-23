<script setup lang="ts">
import Codicon from '../Codicon.vue';

// P4. inheritAttrs is off because the one attribute every call site actually needs to land
// correctly — data-testid — belongs on the real <input> a test drives, not on this wrapping
// <span class="p-input"> (the element .p-input's CSS actually styles as a bordered box).
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    modelValue: string;
    type?: 'text' | 'password' | 'number';
    icon?: string;
    prefix?: string;
    placeholder?: string;
    size?: 'sm' | 'md';
    ui?: boolean;
    invalid?: boolean;
  }>(),
  { size: 'sm', type: 'text' },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  enter: [];
  blur: [event: FocusEvent];
}>();
</script>

<template>
  <span
    class="p-input"
    :class="{ md: size === 'md', ui, 'is-invalid': invalid }"
    :style="invalid ? { borderColor: 'var(--kira-error)' } : undefined"
  >
    <span v-if="icon" class="icon-box"><Codicon :name="icon" :size="13" /></span>
    <span v-if="prefix" class="ph">{{ prefix }}</span>
    <input
      v-bind="$attrs"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keydown.enter="emit('enter')"
      @blur="emit('blur', $event)"
    />
  </span>
</template>
