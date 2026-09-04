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
  position: relative;
  background: var(--kira-bg-chrome);
  flex-shrink: 0;
}

/* No app title (removed — HideTitle already drops AppKit's own, and a second wordmark read as
   redundant next to the mode switcher). Centered on the bar's true full width via absolute
   positioning, deliberately NOT `justify-content: center` inside a flex row padded by
   --kira-titlebar-inset-left (78px left) against a plain --kira-s-3 (6px right) — that asymmetric
   padding centers within the padded box, not the window, and reads visibly off-centre (shifted
   right by roughly half the padding gap). --kira-titlebar-inset-left's own reserved zone stays
   real — nothing else renders there — this just stops depending on it for centering math. */
.mode-tabs {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
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
