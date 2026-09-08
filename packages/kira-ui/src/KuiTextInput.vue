<script setup lang="ts">
/**
 * G19 D3a: a thin wrapper around one styled `<input>`, scoped to simple filter-style inputs only
 * (D5/D6's stacked-header/revealed-filter, `BaseSelector.vue`'s own filter). `SearchBox.vue`'s
 * own input is deliberately not migrated — it already carries heavy, input-specific logic (a
 * listbox dropdown, `aria-activedescendant` wiring, regex-error `aria-describedby`) directly on
 * its own ref, and wrapping it would add indirection for no visual gain this phase needs.
 */
const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  ariaLabel?: string;
}>();
const emit = defineEmits<(e: 'update:modelValue', value: string) => void>();

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <input
    class="kui-text-input"
    type="text"
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :aria-label="props.ariaLabel"
    @input="onInput"
  />
</template>
