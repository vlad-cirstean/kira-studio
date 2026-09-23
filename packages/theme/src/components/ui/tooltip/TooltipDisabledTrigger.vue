<script setup lang="ts"></script>

<template>
  <!-- Blink dispatches no pointer/focus event on a disabled control, so a TooltipTrigger placed
       directly on one never fires; several tips exist only to explain the disabled state. shadcn-vue
       documents this focusable wrapper as the answer. Biome's rule has no option to allow it, and
       every role that silences it (menuitem/tab/treeitem/option) would be a semantic lie. -->
  <!-- biome-ignore lint/a11y/noNoninteractiveTabindex: see comment above -->
  <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
    <slot />
  </span>
</template>
