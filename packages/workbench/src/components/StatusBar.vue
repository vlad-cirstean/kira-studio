<script setup lang="ts">
// P103 Part 2 (§5.4): Kira Studio's own workbench/StatusBar.vue and Kira Space's, unified — the
// bar chrome (`.p-statusbar`/`.side`/`.p-status`/`.mono`/`.xs`/`.muted`, all global classes from
// `packages/theme` already, not redeclared by either app's own `<style scoped>`) and LAW 14's own
// left "caret status" readout, identical prose in both files. Everything else — Kira Studio's
// update/agent-sessions/app-metrics/cache-size/engine-status items on the right, Kira Space's
// blame item beside the caret status on the left — is per-app content through the two slots below.
</script>

<template>
  <div class="p-statusbar text-muted-foreground">
    <!-- LAW 14: this readout answers "where is the caret" and nothing else — every fact a toolbar
         already carries stays there instead of accumulating here too. Not yet wired per-view; "no
         selection" is the honest default. -->
    <div class="side">
      <span class="p-status" data-testid="caret-status">
        <span class="mono xs muted">no selection</span>
      </span>
      <slot name="left-extra" />
    </div>
    <div class="side">
      <slot name="right" />
    </div>
  </div>
</template>
