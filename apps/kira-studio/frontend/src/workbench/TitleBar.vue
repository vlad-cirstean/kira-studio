<script setup lang="ts">
import type { AppMode } from '@shared/domain/mode';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import TitleBarBase from '@workbench/components/TitleBar.vue';
import TitleBarWindowActions from '@workbench/components/TitleBarWindowActions.vue';
import { control } from '../bridge/control';
import { useKeepAwakeStore } from '../state/keepAwake';
import { useLayoutStore } from '../state/layout';
import { useModeStore } from '../state/mode';
import { useSettingsStore } from '../state/settings';
import { MODES } from './modes';
import SettingsDialog from './SettingsDialog.vue';

// P103 Part 2 (§5.4): Kira Studio's own TitleBar.vue, now a thin composition over the shared bar
// chrome (height/insets/background/Teleport, packages/workbench/src/components/TitleBar.vue) —
// this file keeps exactly the per-app content: the mode switcher, the panel toggles, and the
// SettingsDialog it teleports. P116 H7: the keep-awake/new-window buttons moved to
// TitleBarWindowActions.vue, shared with Kira Space's own copy of this file.
const keepAwakeStore = useKeepAwakeStore();
const settingsStore = useSettingsStore();
const layoutStore = useLayoutStore();
const modeStore = useModeStore();

// P91 OQ-1: Terminal joins Studio/Api last, the plan's own stated default.
const MODE_ORDER: AppMode[] = ['studio', 'api', 'terminal'];

function onClick(mode: AppMode): void {
  modeStore.setMode(mode);
}

// P92 item 3: no toast channel in the title bar — a rejection (e.g. a `-tags server` build) is
// logged, not surfaced.
function onNewWindow(): void {
  control.windowsOpenNew().catch((err: unknown) => {
    console.error('new window', err);
  });
}

// P87 §8.2: the button shows only the manual source.
function onToggleKeepAwake(): void {
  keepAwakeStore.setKeepAwakeManual(!keepAwakeStore.status.manual).catch((err: unknown) => {
    console.error('toggle keep-awake', err);
  });
}
</script>

<template>
  <TitleBarBase>
    <!-- No app title (removed — HideTitle already drops AppKit's own, and a second wordmark read
         as redundant next to the mode switcher). Centered on the bar's true full width via
         absolute positioning, deliberately NOT `justify-content: center` inside the flex row —
         that would center within the *padded* box, not the window, and reads visibly off-centre. -->
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-0.5">
      <!-- P15 D9: px-3 (12px) -- the tab chip's own metrics (--kira-h-md/--kira-t-sm, 26px/11px)
           inside a 38px bar leaves 6px of clearance, the same --kira-s-3 the bar already uses as
           its own right padding. wails-no-drag: isDraggableEvent (drag.ts) reads the event
           target's computed style, so every interactive child of the shared, wails-drag-carrying
           TitleBar root must explicitly override it, or clicking a mode tab would also start a
           window drag. -->
      <button
        v-for="mode in MODE_ORDER"
        :key="mode"
        type="button"
        class="h-control-lg inline-flex items-center gap-1 px-3 rounded-kira-sm border cursor-pointer max-w-52 shrink-0 text-kira-md wails-no-drag"
        :class="[
          modeStore.active === mode ? 'bg-elevated border-border-strong text-fg' : 'border-transparent text-muted-foreground hover:bg-hover',
          { 'is-active': modeStore.active === mode },
        ]"
        data-testid="mode-tab"
        :data-mode="mode"
        @click="onClick(mode)"
      >
        <!-- P22 D6: rendered at the icon's own 16px design size (--kira-icon-box) — the glyph fills
             its box instead of leaving per-glyph advance slack at 13px (F9(a)). Mode-tab-local. -->
        <span
          class="size-4 flex items-center justify-center shrink-0 leading-3.5"
          data-testid="mode-tab-icon"
          ><CodiconIcon :name="MODES[mode].icon" :size="16"
        /></span>
        <span class="mode-label leading-3.5">{{ MODES[mode].label }}</span>
      </button>
    </div>

    <!-- Panel toggles and Settings read as title-bar chrome alongside the mode switcher. Filled
         icon + accent colour when a panel is visible, the codicon "-off" companion glyph plus the
         muted colour when it's not. -->
    <div class="flex items-center gap-0.5 ml-auto wails-no-drag">
      <TooltipIconButton
        :icon="layoutStore.panel.project.visible ? 'layout-sidebar-left' : 'layout-sidebar-left-off'"
        label="Connections"
        :icon-size="15"
        variant="title"
        size="title"
        :aria-pressed="layoutStore.panel.project.visible"
        data-testid="toggle-project-panel"
        @click="layoutStore.toggleProjectPanel"
      />
      <TooltipIconButton
        :icon="layoutStore.panel.operations.visible ? 'layout-panel' : 'layout-panel-off'"
        label="Operations"
        :icon-size="15"
        variant="title"
        size="title"
        :aria-pressed="layoutStore.panel.operations.visible"
        data-testid="toggle-operations-panel"
        @click="layoutStore.toggleOperationsPanel"
      />
      <TooltipIconButton
        icon="settings-gear"
        label="Settings"
        :icon-size="15"
        variant="title"
        size="title"
        data-testid="open-settings"
        @click="settingsStore.settingsOpen = true"
      />
      <TitleBarWindowActions
        :keep-awake="keepAwakeStore.status"
        @toggle-keep-awake="onToggleKeepAwake"
        @new-window="onNewWindow"
      />
    </div>

    <template #settings>
      <SettingsDialog v-if="settingsStore.settingsOpen" @close="settingsStore.settingsOpen = false" />
    </template>
    <!-- CRITICAL (D2): --wails-draggable inherits from the shared TitleBar's own root, and
         isDraggableEvent (drag.ts) reads the event *target's* computed style — every interactive
         child here must explicitly override it (wails-no-drag, inline on the button/action-row
         above), or clicking a mode tab would also start a window drag. P110 I2-18: the mode tab's
         hover now lives in the `:class` ternary above (`hover:bg-hover` only in the inactive
         branch), replacing `.mode-tab:hover:not(.is-active)` -- `is-active` itself stays a real
         class (terminal-module.spec.ts/mode-switch.spec.ts/etc. assert `toHaveClass(/is-active/)`
         on it), `mode-tab` was marker-only and dropped. -->
  </TitleBarBase>
</template>
