<script setup lang="ts">
// Shared bar chrome for both apps. Per-app content comes through the two slots: Kira Space's
// blame item on the left, update/app-metrics items on the right.
</script>

<template>
  <div class="h-statusbar shrink-0 flex items-center px-1.5 text-muted-foreground">
    <div v-if="$slots['left-extra']" class="flex items-center gap-0.5">
      <slot name="left-extra" />
    </div>
    <div class="ml-auto flex items-center gap-0.5">
      <slot name="right" />
    </div>
  </div>
</template>
