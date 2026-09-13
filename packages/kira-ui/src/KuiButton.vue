<script setup lang="ts">
/**
 * G19 D3a: generalises `apps/kira-studio/frontend`'s own `AppButton.vue` shape — an icon-box, a
 * default slot, an optional count badge, a `variant`, an `active` state — for
 * `packages/git-ui`'s own toolbar/menu buttons. One size only, driven by `--kui-control-h`; no
 * `kind: 'toolbar' | 'dialog'` distinction (that was Kira-Studio-specific sizing this package's
 * one consumer does not need).
 *
 * Every attribute this component does not declare as a prop (`disabled`, `title`, `aria-label`,
 * `data-testid`, `@click`, an extra `class`…) falls through to the root `<button>` by Vue's own
 * default attrs-inheritance — the same reason `AppButton.vue`'s own callers can already pass
 * those straight through without this component repeating each one.
 */
import { ref } from 'vue';
import KuiIconBox from './KuiIconBox.vue';

withDefaults(
  defineProps<{
    icon?: string;
    /** G34 D5: `'ghost'` retired — once `.kui-button` is itself borderless and muted at rest
     *  (Kira's own `.p-btn`), "ghost" no longer named anything distinct from the default; it
     *  differed only by `opacity: 0.8`, a worse way of saying "muted" than a colour token is.
     *  `'icon'` is its replacement for the icon-only case: Kira's `.p-iconbtn` — a square at the
     *  control height, no text, no border — and the shape every hand-rolled icon-button
     *  implementation in `packages/git-ui` collapsed onto (G34 D14). */
    variant?: 'default' | 'primary' | 'danger' | 'icon';
    active?: boolean;
    count?: number;
  }>(),
  { variant: 'default', active: false },
);

// G34 D5/D14: a plain DOM ref plus `defineExpose`, the same escape hatch `KuiSearchInput` already
// exposes for the identical structural problem — a caller cannot otherwise reach the root DOM
// node of a `<script setup>` component. This is what lets `BranchPicker.vue`'s last raw
// `<button>` become a real `KuiButton` (its trigger needs `.focus()` to return focus on close).
const buttonEl = ref<HTMLButtonElement | null>(null);
defineExpose({
  focus: () => buttonEl.value?.focus(),
});
</script>

<template>
  <button
    ref="buttonEl"
    type="button"
    class="kui-button"
    :class="[`kui-button--${variant}`, { 'kui-button--active': active }]"
  >
    <KuiIconBox v-if="icon" :icon="icon" />
    <slot />
    <span v-if="count !== undefined" class="kui-button-count">{{ count }}</span>
  </button>
</template>
