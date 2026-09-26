<script setup lang="ts">
// P128 §2.7: the `ade` module's own left panel — a placeholder ahead of a later chapter's real
// agent surface (SPEC.md's own vocabulary). Header only, mirroring TerminalPanel.vue's own
// no-seam header bar (packages/workbench/src/terminal/TerminalPanel.vue) — nothing else to show
// yet. No Go, no store, no bridge: this file is the whole of the `ade` module today.
</script>

<template>
  <div data-testid="ade-panel" class="flex h-full flex-col">
    <div class="flex items-center shrink-0 h-bar gap-1 px-1.5 border-b border-border text-kira-sm text-muted-foreground uppercase tracking-wider">
      <span class="font-semibold">Agents</span>
    </div>
  </div>
</template>
