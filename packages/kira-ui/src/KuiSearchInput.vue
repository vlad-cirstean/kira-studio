<script setup lang="ts">
/**
 * G21 D2: `KuiTextInput` plus a leading search glyph and a trailing clear button — the shape
 * every genuine *filter* input in `packages/git-ui` shares (`FileTree.vue`'s own filter,
 * `BranchPicker.vue` ×2, `review/BaseSelector.vue`, `SearchResults.vue`). `SearchBox.vue`'s main
 * query input stays raw (G19's own reasoning, restated at that call site): it is a full ARIA
 * combobox with `aria-activedescendant` and regex-error `aria-describedby` wiring bound directly
 * to its own ref, not a simple filter.
 */
const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  ariaLabel: string;
}>();
const emit = defineEmits<(e: 'update:modelValue', value: string) => void>();

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}

function clear(): void {
  emit('update:modelValue', '');
}
</script>

<template>
  <div class="kui-search-input">
    <span class="codicon codicon-search kui-search-input-icon" aria-hidden="true"></span>
    <input
      class="kui-search-input-field"
      type="text"
      :value="props.modelValue"
      :placeholder="props.placeholder"
      :aria-label="props.ariaLabel"
      @input="onInput"
    />
    <button
      v-if="props.modelValue !== ''"
      type="button"
      class="kui-search-input-clear"
      aria-label="Clear filter"
      v-kui-tooltip="'Clear filter'"
      @click="clear"
    >
      <span class="codicon codicon-close" aria-hidden="true"></span>
    </button>
  </div>
</template>
