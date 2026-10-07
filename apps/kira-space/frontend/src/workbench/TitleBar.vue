<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import ModeSwitcher from '@workbench/components/ModeSwitcher.vue';
import TitleBarBase from '@workbench/components/TitleBar.vue';
import TitleBarWindowActions from '@workbench/components/TitleBarWindowActions.vue';
import { useAdeWorkflowsUiStore } from '../ade/v2/state/adeWorkflowsUi';
import { control } from '../bridge/control';
import { useKeepAwakeStore } from '../state/keepAwake';
import { useLayoutStore } from '../state/layout';
import { type SpaceMode, useModeStore } from '../state/mode';
import { useSettingsStore } from '../state/settings';
import { MODE_ORDER, MODES } from './modes';
import SettingsDialog from './SettingsDialog.vue';

// P103 Part 2 (§5.4): Kira Studio's own TitleBar.vue, trimmed. Now a
// thin composition over the shared bar chrome (packages/workbench/src/components/TitleBar.vue).
// P116 G5/G6 add the keep-awake toggle and "New window" button back — TitleBarWindowActions.vue,
// shared with Kira Studio's own copy of this file. P128 §2.6: this app gains a mode switcher of
// its own — the shared ModeSwitcher.vue (P128 §2.3), rendered generic over this app's own
// SpaceMode, same as Kira Studio's copy of this file.
const settingsStore = useSettingsStore();
const layoutStore = useLayoutStore();
const keepAwakeStore = useKeepAwakeStore();
const modeStore = useModeStore();

// Leaving Agents unmounts the workflow editor: confirm before dropping its unsaved edits.
async function onClick(mode: SpaceMode): Promise<void> {
  if (modeStore.active === 'ade' && mode !== 'ade' && !(await useAdeWorkflowsUiStore().leave())) return;
  modeStore.setMode(mode);
}

// P92 item 3: no toast channel in the title bar — a rejection is logged, not surfaced. Kira
// Studio's own TitleBar.vue onNewWindow, unchanged.
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

    <div class="flex items-center gap-0.5 ml-auto wails-no-drag">
      <TooltipIconButton
        :icon="layoutStore.panel.project.visible ? 'layout-sidebar-left' : 'layout-sidebar-left-off'"
        label="Repositories"
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
  </TitleBarBase>
</template>
