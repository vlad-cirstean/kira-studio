<script setup lang="ts">
// P262 §2.6: panel/picker/list section heading. Successor of git-ui's RefSectionHeader;
// `justify-between` is unconditional, so a trailing action in the default slot needs no variant.
defineProps<{ label: string }>()
</script>

<template>
  <div
    data-slot="section-heading"
    class="flex items-center justify-between h-control-sm px-1.5 text-kira-sm text-subtle uppercase tracking-wider"
  >
    <span>{{ label }}</span>
    <slot />
  </div>
</template>
