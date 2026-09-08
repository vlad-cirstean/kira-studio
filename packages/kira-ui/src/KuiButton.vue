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
import KuiIconBox from './KuiIconBox.vue';

withDefaults(
  defineProps<{
    icon?: string;
    variant?: 'default' | 'primary' | 'danger';
    active?: boolean;
    count?: number;
  }>(),
  { variant: 'default', active: false },
);
</script>

<template>
  <button
    type="button"
    class="kui-button"
    :class="[`kui-button--${variant}`, { 'kui-button--active': active }]"
  >
    <KuiIconBox v-if="icon" :icon="icon" />
    <slot />
    <span v-if="count !== undefined" class="kui-button-count">{{ count }}</span>
  </button>
</template>
