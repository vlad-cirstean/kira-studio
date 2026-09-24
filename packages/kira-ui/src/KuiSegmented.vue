<script setup lang="ts">
/**
 * G21 D2: one implementation of the four hand-rolled `role="group"` icon-toggle groups F2(b)
 * found — `FileTree.vue`'s tree/flat mode, `ReviewFilesPane.vue`'s since-review/full-range
 * toggle, and `ReviewView.vue`'s pane toggle (with count badges) and its own list-mode toggle.
 * `.kv-mode-active` and its four separately-declared CSS blocks go with them.
 *
 * P110 A7: controls.css's `.kui-segmented`/`.kui-segmented-button`(+active/+hover)/`-badge`
 * replaced by `kv:` utilities. The fieldset's `.kui-segmented-button + .kui-segmented-button`
 * sibling-border rule becomes `kv:divide-x kv:divide-kui-border-strong` (Tailwind's own divider
 * utility is exactly this pattern — a border between children, none before the first). The
 * active/hover split is a `cva` (real variant branching, same bar as `kuiButtonVariants`/
 * `kuiRowVariants`): color and hover-background live only in whichever branch applies, so no two
 * conflicting `kv:` utilities for the same property are ever both present on one button (§1's own
 * cascade-ordering rule). Local to this component only — no other file composes this class set,
 * confirmed by grep — so it isn't exported from `index.ts`, unlike `kuiRowVariants`.
 * `kv:px-[3px]` (the badge's horizontal padding) stays an arbitrary value (§1.1 rung 4): 3px has
 * no step on the kept spacing scale. `kv:leading-[var(--kui-control-h-sm,14px)]` also stays
 * arbitrary: it reads the same raw `--kui-*` var `kv:h-kui-control-sm` already maps to, and
 * Tailwind's `leading-*` scale has no matching step to reuse instead.
 */
import { cva } from 'class-variance-authority';
import type { KuiSegmentedOption } from './optionTypes.ts';

const kuiSegmentedButtonVariants = cva(
  'kv:flex kv:items-center kv:justify-center kv:gap-kui-1 kv:px-kui-3 kv:border-0 kv:bg-transparent kv:text-kui-sm kv:cursor-pointer kv:whitespace-nowrap',
  {
    variants: {
      active: {
        true: 'kv:bg-kui-active kv:text-kui-fg',
        false: 'kv:text-kui-fg-muted kv:hover:bg-kui-hover',
      },
    },
    defaultVariants: { active: false },
  },
);

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
  <fieldset
    class="kv:inline-flex kv:h-kui-control kv:m-0 kv:p-0 kv:border kv:border-kui-border-strong kv:rounded-kui kv:overflow-hidden kv:shrink-0 kv:divide-x kv:divide-kui-border-strong"
    :aria-label="ariaLabel"
  >
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      :class="kuiSegmentedButtonVariants({ active: modelValue === option.id })"
      :aria-pressed="modelValue === option.id"
      :aria-controls="ariaControls"
      v-kui-tooltip="option.label"
      :aria-label="option.badge === undefined ? option.label : `${option.label} (${option.badge})`"
      @click="emit('update:modelValue', option.id)"
    >
      <span class="codicon" :class="option.icon" aria-hidden="true"></span>
      <span
        v-if="option.badge !== undefined"
        class="kv:inline-flex kv:items-center kv:justify-center kv:min-w-kui-control-sm kv:h-kui-control-sm kv:px-[3px] kv:rounded-full kv:bg-kui-hover kv:text-kui-xs kv:leading-[var(--kui-control-h-sm,14px)]"
        data-testid="kui-segmented-badge"
        >{{ option.badge }}</span
      >
    </button>
  </fieldset>
</template>
