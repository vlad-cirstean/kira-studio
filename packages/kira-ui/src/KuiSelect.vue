<script setup lang="ts">
/**
 * G21 D2: a **styled native `<select>`** — `--kui-*` chrome plus a `codicon-chevron-down`
 * affordance, deliberately not a custom listbox. The browser/host owns a `<select>`'s popup
 * positioning and its accessibility for free, the same call G20's own F5 made for the sibling
 * app's equivalent control.
 *
 * P110 A4: controls.css's `.kui-select`/`-field`(+`:focus-visible`)/`-chevron` replaced by `kv:`
 * utilities on this component's own elements. `class` is now a declared prop (root wrapper only —
 * `SearchBox.vue`'s `kv-search-scope` is a font-size-only override today, previously landing on
 * this same root via Vue's default fallthrough), merged through `cn()` (§1.3).
 */
import type { ClassValue } from 'clsx';
import { cn } from './cn.ts';
import type { KuiSelectOption } from './optionTypes.ts';

const props = defineProps<{
  modelValue: string;
  options: readonly KuiSelectOption[];
  ariaLabel?: string;
  id?: string;
  class?: ClassValue;
}>();
const emit = defineEmits<(e: 'update:modelValue', value: string) => void>();

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <span :class="cn('kv:relative kv:inline-flex kv:items-center', props.class)">
    <select
      :id="props.id"
      class="kv:h-kui-control kv:py-0 kv:pr-kui-6 kv:pl-kui-4 kv:bg-kui-bg-input kv:text-kui-fg kv:border kv:border-kui-border-strong kv:rounded-kui kv:[font-family:inherit] kv:text-kui-sm kv:appearance-none kv:focus-visible:border-kui-focus-border kv:focus-visible:outline-1 kv:focus-visible:outline-kui-focus-border kv:focus-visible:-outline-offset-1"
      :value="props.modelValue"
      :aria-label="props.ariaLabel"
      @change="onChange"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <span
      class="codicon codicon-chevron-down kv:absolute kv:right-kui-1 kv:pointer-events-none kv:text-kui-icon kv:opacity-70"
      aria-hidden="true"
    ></span>
  </span>
</template>
