<script setup lang="ts">
import type { AppMode } from '@shared/domain/mode';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import ModeSwitcher from '@workbench/components/ModeSwitcher.vue';
import TitleBarBase from '@workbench/components/TitleBar.vue';
import TitleBarWindowActions from '@workbench/components/TitleBarWindowActions.vue';
import { control } from '../bridge/control';
import { useKeepAwakeStore } from '../state/keepAwake';
import { useLayoutStore } from '../state/layout';
import { useModeStore } from '../state/mode';
import { useSettingsStore } from '../state/settings';
import { MODE_ORDER, MODES } from './modes';
import SettingsDialog from './SettingsDialog.vue';

// P103 Part 2 (§5.4): Kira Studio's own TitleBar.vue, now a thin composition over the shared bar
// chrome (height/insets/background/Teleport, packages/workbench/src/components/TitleBar.vue) —
// this file keeps exactly the per-app content: the mode switcher, the panel toggles, and the
// SettingsDialog it teleports. P116 H7: the keep-awake/new-window buttons moved to
// TitleBarWindowActions.vue, shared with Kira Space's own copy of this file. P128 §2.3: the mode
// switcher's own markup moved to the shared ModeSwitcher.vue, rendered generic over AppMode.
const keepAwakeStore = useKeepAwakeStore();
const settingsStore = useSettingsStore();
const layoutStore = useLayoutStore();
const modeStore = useModeStore();

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
    <ModeSwitcher :order="MODE_ORDER" :modes="MODES" :active="modeStore.active" @select="onClick" />

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
         child here must explicitly override it (wails-no-drag, on ModeSwitcher's own mode-tab
         buttons and the action-row above), or clicking a mode tab would also start a window drag.
         P110 I2-18/P128 §2.3: the mode tab's hover lives in ModeSwitcher.vue's own `:class` ternary
         (`hover:bg-hover` only in the inactive branch), replacing `.mode-tab:hover:not(.is-active)`
         -- `is-active` itself stays a real class (terminal-module.spec.ts/mode-switch.spec.ts/etc.
         assert `toHaveClass(/is-active/)` on it), `mode-tab` was marker-only and dropped. -->
  </TitleBarBase>
</template>
