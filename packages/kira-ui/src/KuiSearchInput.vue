<script setup lang="ts">
/**
 * G21 D2: `KuiTextInput` plus a leading search glyph and a trailing clear button — the shape
 * every genuine *filter* input in `packages/git-ui` shares (`FileTree.vue`'s own filter,
 * `BranchPicker.vue` ×2, `review/BaseSelector.vue`, `SearchResults.vue`). `SearchBox.vue`'s main
 * query input stays raw (G19's own reasoning, restated at that call site): it is a full ARIA
 * combobox with `aria-activedescendant` and regex-error `aria-describedby` wiring bound directly
 * to its own ref, not a simple filter.
 *
 * G21 D2 follow-up: a plain `autofocus` attribute falls through to this component's *root* `<div>`
 * (Vue's default attrs inheritance targets the single root element), which is not focusable and so
 * silently does nothing — unlike a raw `<input autofocus>`, this component needs its own escape
 * hatch. `defineExpose`'s `focus()` is that hatch: a caller with a template ref on this component
 * calls it explicitly (typically from `onMounted`/`nextTick`) instead of relying on a fallthrough
 * attribute that cannot reach the real `<input>`.
 */
import { ref } from 'vue';

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  ariaLabel: string;
}>();
const emit = defineEmits<(e: 'update:modelValue', value: string) => void>();

const inputEl = ref<HTMLInputElement | null>(null);

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}

function clear(): void {
  emit('update:modelValue', '');
}

defineExpose({ focus: () => inputEl.value?.focus() });
</script>

<template>
  <div class="kui-search-input">
    <span class="codicon codicon-search kui-search-input-icon" aria-hidden="true"></span>
    <input
      ref="inputEl"
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
