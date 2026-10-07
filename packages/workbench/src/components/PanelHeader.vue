<script setup lang="ts">
// The panel header bar every workbench panel shares: title, then right-aligned actions.
</script>

<template>
  <div
    class="flex items-center shrink-0 h-bar gap-1 px-1.5 border-b border-border text-kira-sm text-muted-foreground uppercase tracking-wider"
    data-slot="panel-header"
  >
    <span class="font-semibold"><slot /></span>
    <div class="ml-auto flex items-center gap-1"><slot name="actions" /></div>
  </div>
</template>
