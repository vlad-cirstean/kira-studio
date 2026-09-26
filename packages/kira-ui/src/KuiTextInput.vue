<script setup lang="ts">
/**
 * G19 D3a: a thin wrapper around one styled `<input>`, scoped to simple filter-style inputs only
 * (D5/D6's stacked-header/revealed-filter, `BaseSelector.vue`'s own filter). `SearchBox.vue`'s
 * own input is deliberately not migrated — it already carries heavy, input-specific logic (a
 * listbox dropdown, `aria-activedescendant` wiring, regex-error `aria-describedby`) directly on
 * its own ref, and wrapping it would add indirection for no visual gain this phase needs.
 *
 * P110 A4: controls.css's `.kui-text-input`(+`::placeholder`/`:focus-visible`) replaced by `kv:`
 * utilities on this component's own root `<input>`. No variant ever branches this component's
 * classes (unlike `KuiButton`), so a plain string through `cn()` is enough — a `cva` wrapper would
 * add a layer with nothing to select between. `class` is a declared prop, not left to fall
 * through, so an override (`BranchPicker.vue`'s `kv-branch-rename-input`, `ReviewView.vue`'s
 * `kv-review-toolbar-filter` — both width-only now that this is a real `KuiTextInput`) merges
 * through `cn()` instead of Vue's default concatenation (§1.3's "through cn()" rule).
 */
import type { ClassValue } from 'clsx';
import { cn } from './cn.ts';

const kuiTextInputClasses =
  'kv:h-kui-control kv:py-0 kv:px-2 kv:bg-kui-bg-input kv:text-kui-fg kv:border kv:border-kui-border-strong kv:rounded-kui kv:font-inherit kv:text-kui-base kv:placeholder:text-kui-fg-muted kv:focus-visible:border-kui-focus-border kv:focus-visible:outline kv:focus-visible:outline-1 kv:focus-visible:outline-kui-focus-border kv:focus-visible:-outline-offset-1';

const props = defineProps<{
  modelValue: string;
  placeholder?: string;
  ariaLabel?: string;
  class?: ClassValue;
}>();
const emit = defineEmits<(e: 'update:modelValue', value: string) => void>();

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <input
    :class="cn(kuiTextInputClasses, props.class)"
    type="text"
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :aria-label="props.ariaLabel"
    @input="onInput"
  />
</template>
