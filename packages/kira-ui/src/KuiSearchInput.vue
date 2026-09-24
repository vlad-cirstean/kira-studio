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
 *
 * P110 A4: controls.css's `.kui-search-input`/`-icon`/`-field`(+`::placeholder`/`:focus-visible`)/
 * `-clear`(+`:hover`) replaced by `kv:` utilities on this component's own elements. `class` is now
 * a declared prop (root wrapper only — `SearchBox.vue`'s `kv-search-field`, `FileTree.vue`'s
 * `kv-file-tree-filter`, `BranchPicker.vue`'s `kv-branch-filter`, `BaseSelector.vue`'s
 * `kv-base-filter` all pass a width/margin-only override today, previously landing on this same
 * root via Vue's default fallthrough), merged through `cn()` (§1.3). The clear button's 16px box
 * is Tailwind's own default `size-4` (git-ui's kept default spacing scale, 4px steps — rung 1,
 * §1.1), not `kui-icon-box`: the source literal was always a plain `16px`, never `var(--kui-icon-
 * box, …)`, so reusing that token here would newly couple this button's size to a variable it
 * never tracked, a behaviour change to disclose, not a bytes-identical value substitution.
 */
import type { ClassValue } from 'clsx';
import { computed, ref } from 'vue';
import { cn } from './cn.ts';

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  ariaLabel: string;
  /** Combobox callers only (`git-ui`'s `SearchBox.vue`): forwarded verbatim onto the real
   *  `<input>`. Hyphenated `aria-*` keys (not `ariaExpanded`-style) so a static `role="combobox"`
   *  at a call site sits beside attributes Biome's a11y analyzer actually recognizes as ARIA
   *  props, rather than opaque camelCase props it can't connect to the role. */
  role?: string;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  /** Deliberately not hyphenated (unlike its five siblings above): a literal `aria-activedescendant`
   *  on this *component* tag makes Biome's `useAriaActivedescendantWithTabindex` demand a tabindex
   *  on the same tag, but the tabbable element is the real `<input>` this attribute actually lands
   *  on, one component boundary away — invisible to that check either way. */
  ariaActivedescendant?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-haspopup'?: string;
  class?: ClassValue;
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
const ariaHaspopupAttr = computed(() => props['aria-haspopup'] as AriaHaspopup);

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}

function clear(): void {
  emit('update:modelValue', '');
}

defineExpose({ focus: () => inputEl.value?.focus() });
</script>

<template>
  <div :class="cn('kv:relative kv:inline-flex kv:items-center kv:h-kui-control', props.class)">
    <span
      class="codicon codicon-search kv:absolute kv:left-kui-2 kv:pointer-events-none kv:text-kui-icon kv:opacity-70"
      aria-hidden="true"
    ></span>
    <input
      ref="inputEl"
      class="kv:w-full kv:h-full kv:py-0 kv:px-kui-6 kv:bg-kui-bg-input kv:text-kui-fg kv:border kv:border-kui-border-strong kv:rounded-kui kv:[font-family:inherit] kv:text-kui-sm kv:placeholder:text-kui-fg-muted kv:focus-visible:border-kui-focus-border kv:focus-visible:outline kv:focus-visible:outline-1 kv:focus-visible:outline-kui-focus-border kv:focus-visible:-outline-offset-1"
      type="text"
      :value="props.modelValue"
      :placeholder="props.placeholder"
      :aria-label="props.ariaLabel"
      :role="props.role"
      :aria-expanded="props['aria-expanded']"
      :aria-controls="props['aria-controls']"
      :aria-activedescendant="props.ariaActivedescendant"
      :aria-describedby="props['aria-describedby']"
      :aria-invalid="props['aria-invalid']"
      :aria-haspopup="ariaHaspopupAttr"
      @input="onInput"
      @keydown="emit('keydown', $event)"
    />
    <button
      v-if="props.modelValue !== ''"
      type="button"
      class="kv:absolute kv:right-kui-1 kv:inline-flex kv:size-4 kv:items-center kv:justify-center kv:p-0 kv:bg-transparent kv:border-0 kv:text-kui-fg-muted kv:cursor-pointer kv:opacity-70 kv:hover:opacity-100"
      aria-label="Clear filter"
      v-kui-tooltip="'Clear filter'"
      @click="clear"
    >
      <span class="codicon codicon-close" aria-hidden="true"></span>
    </button>
  </div>
</template>
