<script setup lang="ts">
import type { AppMode } from '@shared/domain/mode';
import { layoutState, toggleOperationsPanel, toggleProjectPanel } from '../state/layout';
import { modeState, setMode } from '../state/mode';
import { settingsOpen } from '../state/settings';
import CodiconIcon from '../theme/CodiconIcon.vue';
import { MODES } from './modes';
import SettingsDialog from './SettingsDialog.vue';

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

    <!-- Moved from the status bar (previously the bottom-right corner) — panel toggles and
         Settings read more naturally as title-bar chrome, alongside the mode switcher, than
         buried in a metrics strip. Filled icon + accent colour when a panel is visible, the
         codicon "-off" companion glyph (a real outline variant that ships for exactly these two
         icons, not a colour-only trick) plus the muted colour when it's not — .is-on used to be a
         background tint alone, easy to miss against the bar's own colour). -->
    <div class="title-bar-actions">
      <button
        type="button"
        class="title-action"
        :class="{ 'is-on': layoutState.panel.project.visible }"
        v-tooltip="'Connections'"
        data-testid="toggle-project-panel"
        @click="toggleProjectPanel"
      >
        <CodiconIcon
          :name="layoutState.panel.project.visible ? 'layout-sidebar-left' : 'layout-sidebar-left-off'"
          :size="15"
        />
      </button>
      <button
        type="button"
        class="title-action"
        :class="{ 'is-on': layoutState.panel.operations.visible }"
        v-tooltip="'Operations'"
        data-testid="toggle-operations-panel"
        @click="toggleOperationsPanel"
      >
        <CodiconIcon
          :name="layoutState.panel.operations.visible ? 'layout-panel' : 'layout-panel-off'"
          :size="15"
        />
      </button>
      <button
        type="button"
        class="title-action"
        v-tooltip="'Settings'"
        data-testid="open-settings"
        aria-label="Settings"
        @click="settingsOpen = true"
      >
        <CodiconIcon name="settings-gear" :size="15" />
      </button>
    </div>
  </div>

  <Teleport to="body">
    <SettingsDialog v-if="settingsOpen" @close="settingsOpen = false" />
  </Teleport>
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
  display: flex;
  align-items: center;
  padding-left: var(--kira-titlebar-inset-left);
  padding-right: var(--kira-s-3);
  background: var(--kira-bg-chrome);
  flex-shrink: 0;
}

/* No app title (removed — HideTitle already drops AppKit's own, and a second wordmark read as
   redundant next to the mode switcher). Centered on the bar's true full width via absolute
   positioning, deliberately NOT `justify-content: center` inside the flex row above — that would
   center within the *padded* box (78px left vs. --kira-s-3 right), not the window, and reads
   visibly off-centre. --kira-titlebar-inset-left's own reserved zone stays real (nothing else
   renders there) — this just stops depending on it for centering math. */
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
     strip, not a ~36px native macOS title bar — the same "step smaller than the primary tabs"
     override ConsoleView.vue's own .result-tab already uses (P42 D6), here because the title bar
     is shorter still. */
  height: var(--kira-h-sm);
  font-size: var(--kira-t-xs);
}

/* margin-left: auto pushes this flush to the bar's right edge, inside the flex row .mode-tabs
   ignores entirely (it's absolutely positioned) — right-alignment via the row's own padding-right
   has none of .mode-tabs' centering problem, since there's nothing on the far side to be
   asymmetric against. */
.title-bar-actions {
  --wails-draggable: none;
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.title-action {
  --wails-draggable: none;
  height: var(--kira-h-sm);
  width: var(--kira-h-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* A real (transparent) border at rest, not `border: none` — so .is-on below only swaps the
     border's colour, never adds one, and the button never resizes/shifts between the two
     states. Same technique .p-tab uses for the identical reason (primitives.css:365). */
  border: var(--kira-border-width) solid transparent;
  border-radius: var(--kira-radius-sm);
  background: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
}
.title-action:hover {
  background: var(--kira-hover);
}
/* This app's own established "active" treatment — .p-tab.is-active's exact combination
   (primitives.css:372-376): a visible border, a background lift, full-brightness text/icon
   colour. Not blue/accent-tinted (a first attempt at this was, and read as an unrelated "info"
   colour rather than "this button is on") and not a background tint alone (the original
   status-bar .is-on was just `background: var(--kira-bg-input)`, too close to the bar's own
   colour to register as a highlight at a glance) — it's the filled-vs-"-off" glyph swap in the
   template PLUS this, together, the same "shape and colour both change" redundancy .p-tab's own
   active state already relies on. */
.title-action.is-on {
  background: var(--kira-bg-elevated);
  border-color: var(--kira-border-strong);
  color: var(--kira-fg);
}
.title-action.is-on:hover {
  background: var(--kira-hover);
}
</style>
