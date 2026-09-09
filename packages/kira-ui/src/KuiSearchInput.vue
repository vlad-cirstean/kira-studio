<script setup lang="ts">
/**
 * G21 D2: `KuiTextInput` plus a leading search glyph and a trailing clear button — the shape
 * every genuine *filter* input in `packages/git-ui` shares (`FileTree.vue`'s own filter,
 * `BranchPicker.vue` ×2, `review/BaseSelector.vue`, `SearchResults.vue`).
 *
 * G21 D2 follow-up: a plain `autofocus` attribute falls through to this component's *root* `<div>`
 * (Vue's default attrs inheritance targets the single root element), which is not focusable and so
 * silently does nothing — unlike a raw `<input autofocus>`, this component needs its own escape
 * hatch. `defineExpose`'s `focus()` is that hatch: a caller with a template ref on this component
 * calls it explicitly (typically from `onMounted`/`nextTick`) instead of relying on a fallthrough
 * attribute that cannot reach the real `<input>`.
 *
 * G-UX D9 (item 9): `git-ui`'s `SearchBox.vue` used to stay a raw `<input>` for exactly this
 * reason — G19's own reasoning restated there — because it needs a full ARIA combobox
 * (`aria-activedescendant`, regex-error `aria-describedby`) this component could not express. The
 * props below close that gap: every one is optional (the five existing filter call sites —
 * `FileTree.vue`, `BranchPicker.vue` ×2, `review/BaseSelector.vue`, `review/ReviewView.vue` —
 * render byte-identically without them), forwarded verbatim onto the real `<input>` a caller
 * cannot otherwise reach (the same reason `focus()` is exposed: this component's root is a
 * `<div>`, so a plain fallthrough attribute lands in the wrong place). `keydown` is forwarded
 * explicitly for the same reason, rather than relying on Vue's default attrs inheritance (which
 * would put a `@keydown` listener on the root `<div>` — it would still see the event via
 * bubbling, but an explicit forward keeps the contract obvious).
 */
import { computed, ref } from 'vue';

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  ariaLabel: string;
  /** Combobox callers only (`git-ui`'s `SearchBox.vue`): forwarded verbatim onto the real
   *  `<input>`. */
  role?: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
  ariaActivedescendant?: string;
  ariaDescribedby?: string;
  ariaInvalid?: boolean;
  ariaHaspopup?: string;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'keydown', event: KeyboardEvent): void;
}>();

const inputEl = ref<HTMLInputElement | null>(null);

// `aria-haspopup` on a real DOM element has a narrow literal-union type (the DOM lib's
// `AriaAttributes['aria-haspopup']`), stricter than this component's own deliberately loose
// `string` prop (kept wide so a caller never has to import that union just to pass `'listbox'`).
// This is the one attribute of the seven where that widening needs an explicit narrowing back at
// the binding site — the others (aria-expanded/controls/activedescendant/describedby/invalid,
// role) type-check fine as plain string/boolean against the DOM lib's own attribute types.
type AriaHaspopup = 'listbox' | 'menu' | 'tree' | 'grid' | 'dialog' | 'true' | 'false' | undefined;
const ariaHaspopupAttr = computed(() => props.ariaHaspopup as AriaHaspopup);

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
      :role="props.role"
      :aria-expanded="props.ariaExpanded"
      :aria-controls="props.ariaControls"
      :aria-activedescendant="props.ariaActivedescendant"
      :aria-describedby="props.ariaDescribedby"
      :aria-invalid="props.ariaInvalid"
      :aria-haspopup="ariaHaspopupAttr"
      @input="onInput"
      @keydown="emit('keydown', $event)"
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
