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
    <div class="title-bar-left">
      <span class="app-title" data-testid="app-title">Kira Studio</span>
    </div>
    <div class="mode-tabs">
      <button
        v-for="mode in MODE_ORDER"
        :key="mode"
        type="button"
        class="p-tab"
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
  /* Three equal-fraction tracks, the outer two left empty of any forced width: with nothing else
     competing for space in the third column, `1fr`/`1fr` come out equal, which is what centers
     .mode-tabs on the bar as a whole rather than on the space remaining after the title — the
     usual trick for a title-left/content-centred bar without measuring either side by hand. */
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding-left: var(--kira-titlebar-inset-left);
  padding-right: var(--kira-s-3);
  background: var(--kira-bg-chrome);
  flex-shrink: 0;
}

.title-bar-left {
  justify-self: start;
  min-width: 0;
  overflow: hidden;
}

.app-title {
  font-size: var(--kira-t-sm);
  font-weight: 600;
  color: var(--kira-fg-muted);
  letter-spacing: 0.2px;
  white-space: nowrap;
  user-select: none;
}

.mode-tabs {
  justify-self: center;
  display: flex;
  align-items: center;
  gap: 2px;
}

/* CRITICAL (D2): --wails-draggable inherits from .title-bar above, and isDraggableEvent
   (drag.ts:99-108) reads the event *target's* computed style — so every interactive child here
   must explicitly override it, or clicking a mode tab would also start a window drag. */
.mode-tabs .p-tab {
  --wails-draggable: none;
}
</style>
