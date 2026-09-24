<script setup lang="ts">
/**
 * G19 D3a: the fixed-size flex wrapper implementing "icons never float unboxed next to text"
 * (`AppButton.vue`'s own stated law in `apps/kira-studio/frontend`, generalised here) — a
 * `--kui-*`-only primitive, used internally by `KuiButton`/`KuiContextMenu` and exported for
 * direct use by either host. Icons are plain codicon class names (`icon?: string`), not a
 * package-owned font — both hosts already load their own codicon stylesheet globally.
 *
 * P110 A3: `controls.css`'s own `.kui-icon-box`/`.kui-icon-box .codicon` rules replaced by `kv:`
 * utilities directly on this component's own two spans. `class` is a declared prop (not left to
 * fall through) so a caller's own class merges through `cn()` instead of Vue's default
 * concatenation (§1.3's "through cn()" rule). Both controls.css rules stay in place for now:
 * `KuiMenuList.vue`'s own raw `class="kui-icon-box"` span (not this component) is still a real
 * consumer, and moves in A5 alongside the rest of that file.
 */
import type { ClassValue } from 'clsx';
import { cn } from './cn.ts';

const props = defineProps<{ icon?: string; class?: ClassValue }>();
</script>

<template>
  <span
    :class="
      cn(
        'kv:inline-flex kv:size-kui-icon-box kv:shrink-0 kv:items-center kv:justify-center',
        props.class,
      )
    "
  >
    <span v-if="icon" class="codicon kv:text-kui-icon" :class="icon" aria-hidden="true"></span>
    <slot v-else />
  </span>
</template>
