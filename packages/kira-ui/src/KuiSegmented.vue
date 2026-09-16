<script setup lang="ts">
/**
 * G21 D2: one implementation of the four hand-rolled `role="group"` icon-toggle groups F2(b)
 * found — `FileTree.vue`'s tree/flat mode, `ReviewFilesPane.vue`'s since-review/full-range
 * toggle, and `ReviewView.vue`'s pane toggle (with count badges) and its own list-mode toggle.
 * `.kv-mode-active` and its four separately-declared CSS blocks go with them.
 */
import type { KuiSegmentedOption } from './optionTypes.ts';

defineProps<{
  options: readonly KuiSegmentedOption[];
  modelValue: string;
  ariaLabel: string;
  /** P77 §3.4: forwarded onto every button's `aria-controls`, pointing at the body this strip
   *  switches — additive only, `KuiSegmented` stays `role="group"`/`aria-pressed`, never a real
   *  `tablist`/`tab` (the a11y change stops here; see that section's own reason). Optional so
   *  every existing call site (`ReviewView.vue` ×2, `FileTree.vue`, `ReviewFilesPane.vue`) is
   *  unaffected. */
  ariaControls?: string;
}>();

const emit = defineEmits<(e: 'update:modelValue', value: string) => void>();
</script>

<template>
  <div class="kui-segmented" role="group" :aria-label="ariaLabel">
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      class="kui-segmented-button"
      :aria-pressed="modelValue === option.id"
      :aria-controls="ariaControls"
      :class="{ 'kui-segmented-button--active': modelValue === option.id }"
      v-kui-tooltip="option.label"
      :aria-label="option.badge === undefined ? option.label : `${option.label} (${option.badge})`"
      @click="emit('update:modelValue', option.id)"
    >
      <span class="codicon" :class="option.icon" aria-hidden="true"></span>
      <span v-if="option.badge !== undefined" class="kui-segmented-badge">{{ option.badge }}</span>
    </button>
  </div>
</template>
