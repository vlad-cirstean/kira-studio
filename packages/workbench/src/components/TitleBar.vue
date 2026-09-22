<script setup lang="ts">
// P103 Part 2 (§5.4): Kira Studio's own workbench/TitleBar.vue and Kira Space's, unified — the bar
// chrome only: height, insets, background, the `--wails-draggable: drag` region this root carries
// (drag.ts's own doc comment — dragging the bar moves the window, inert everywhere without a real
// Wails window). Every interactive child (mode tabs, action buttons) is per-app content, passed
// through the default slot; `.title-bar-actions`/`.title-action`(`--labelled`)/`.is-on` publish
// from `workbench.css` so each app's own `.title-bar-actions` wrapper and `.title-action` buttons
// keep resolving them, unmoved and untouched — P104's job to swap that markup for shadcn-vue's
// Button, not this phase's.
//
// The Settings mount: each app's own `<SettingsDialog v-if="settingsStore.settingsOpen"
// @close="...">` stays entirely in the app (the settings store's own shape is per-app, §5.5's own
// scope) — this component owns only the `<Teleport to="body">` wrapper around whatever the
// `#settings` slot renders, so "Settings teleports to body, not the title bar's own stacking
// context" is one shared fact instead of two identical Teleport calls.
</script>

<template>
  <div class="title-bar">
    <slot />
  </div>
  <Teleport to="body">
    <slot name="settings" />
  </Teleport>
</template>

<style scoped>
/* P1 D2/C8: the root carries --wails-draggable: drag so the bar behaves like a native title bar —
   dragging it moves the window, double-clicking it zooms/minimises per System Settings, both for
   free. Inert (ordinary DOM) on Linux dev builds and under tests/ui (a static file server, no Wails
   window at all). */
.title-bar {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  --wails-draggable: drag;
  height: var(--kira-titlebar-h);
  min-height: var(--kira-titlebar-h);
  padding-left: var(--kira-titlebar-inset-left);
  padding-right: var(--kira-s-3);
  background: var(--kira-bg-chrome);
}
</style>
