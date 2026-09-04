<script setup lang="ts">
import type { AppMode } from '@shared/domain/mode';
import { modeState, setMode } from '../state/mode';
import { MODES } from './modes';

const MODE_ORDER: AppMode[] = ['studio', 'http'];

function onClick(mode: AppMode): void {
  setMode(mode);
}
</script>

<template>
  <div class="title-bar">
    <div class="mode-tabs">
      <button
        v-for="mode in MODE_ORDER"
        :key="mode"
        type="button"
        class="p-tab mode-tab"
        :class="{ 'is-active': modeState.active === mode }"
        data-testid="mode-tab"
        :data-mode="mode"
        @click="onClick(mode)"
      >
        {{ MODES[mode].label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* P1 D2/C8: the root carries --wails-draggable: drag (drag.ts:98-108) so the bar behaves like a
   native title bar — dragging it moves the window, double-clicking it zooms/minimises per System
   Settings, both for free. On Linux (wails3 task dev) and under tests/ui (a static file server,
   no Wails window at all) the custom property is simply inert and this renders as ordinary DOM. */
.title-bar {
  --wails-draggable: drag;
  height: var(--kira-titlebar-h);
  min-height: var(--kira-titlebar-h);
  display: flex;
  align-items: center;
  /* No app title (removed — HideTitle already drops AppKit's own, and a second wordmark read as
     redundant next to the mode switcher). With only one child, centering it in the whole bar
     (padding included) is what a plain `justify-content: center` already does — no grid trick
     needed once there is nothing on the other side to balance against. */
  justify-content: center;
  padding-left: var(--kira-titlebar-inset-left);
  padding-right: var(--kira-s-3);
  background: var(--kira-bg-chrome);
  flex-shrink: 0;
}

.mode-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* CRITICAL (D2): --wails-draggable inherits from .title-bar above, and isDraggableEvent
   (drag.ts:99-108) reads the event *target's* computed style — so every interactive child here
   must explicitly override it, or clicking a mode tab would also start a window drag. */
.mode-tab {
  --wails-draggable: none;
  /* .p-tab's own height/font-size (--kira-h-md/--kira-t-sm) are sized for the main editor tab
     strip, not a ~28px native macOS title bar — the same "step smaller than the primary tabs"
     override ConsoleView.vue's own .result-tab already uses (P42 D6), here because the title bar
     is shorter still. */
  height: var(--kira-h-sm);
  font-size: var(--kira-t-xs);
}
</style>
