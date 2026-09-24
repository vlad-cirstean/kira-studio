<script setup lang="ts">
// P103 Part 2 (§5.4): Kira Studio's own workbench/StatusBar.vue and Kira Space's, unified — the
// bar chrome (P110 B29's own utility strings on the elements themselves, plus the
// `font-data`/`text-muted-foreground` Tailwind utilities, none redeclared by either app's own
// `<style scoped>`) and LAW 14's own left "caret status" readout, identical prose in both files.
// Everything else — Kira Studio's update/agent-sessions/app-metrics/cache-size/engine-status
// items on the right, Kira Space's blame item beside the caret status on the left — is per-app
// content through the two slots below.
</script>

<template>
  <div class="h-statusbar shrink-0 flex items-center justify-between px-1.5 text-muted-foreground">
    <!-- LAW 14: this readout answers "where is the caret" and nothing else — every fact a toolbar
         already carries stays there instead of accumulating here too. Not yet wired per-view; "no
         selection" is the honest default. -->
    <div class="flex items-center gap-0.5">
      <span
        class="h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-sm cursor-pointer border-0 bg-none hover:bg-hover"
        data-testid="caret-status"
      >
        <span class="font-data xs text-muted-foreground">no selection</span>
      </span>
      <slot name="left-extra" />
    </div>
    <div class="flex items-center gap-0.5">
      <slot name="right" />
    </div>
  </div>
</template>
