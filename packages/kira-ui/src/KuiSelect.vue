<script setup lang="ts">
/**
 * G21 D2: a **styled native `<select>`** — `--kui-*` chrome plus a `codicon-chevron-down`
 * affordance, deliberately not a custom listbox. The browser/host owns a `<select>`'s popup
 * positioning and its accessibility for free, the same call G20's own F5 made for the sibling
 * app's equivalent control.
 */
import type { KuiSelectOption } from './optionTypes.ts';

const props = defineProps<{
  modelValue: string;
  options: readonly KuiSelectOption[];
  ariaLabel?: string;
}>();
const emit = defineEmits<(e: 'update:modelValue', value: string) => void>();

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <span class="kui-select">
    <select
      class="kui-select-field"
      :value="props.modelValue"
      :aria-label="props.ariaLabel"
      @change="onChange"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <span class="codicon codicon-chevron-down kui-select-chevron" aria-hidden="true"></span>
  </span>
</template>
