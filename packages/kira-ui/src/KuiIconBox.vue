<script setup lang="ts">
/**
 * G19 D3a: the fixed-size flex wrapper implementing "icons never float unboxed next to text"
 * (`AppButton.vue`'s own stated law in `apps/kira-studio/frontend`, generalised here) — a
 * `--kui-*`-only primitive, used internally by `KuiButton`/`KuiContextMenu` and exported for
 * direct use by either host. Icons are plain codicon class names (`icon?: string`), not a
 * package-owned font — both hosts already load their own codicon stylesheet globally.
 */
defineProps<{ icon?: string }>();
</script>

<template>
  <span class="kui-icon-box">
    <span v-if="icon" class="codicon" :class="icon" aria-hidden="true"></span>
    <slot v-else />
  </span>
</template>
