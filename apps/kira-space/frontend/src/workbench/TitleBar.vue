<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import TitleBarBase from '@workbench/components/TitleBar.vue';
import TitleBarWindowActions from '@workbench/components/TitleBarWindowActions.vue';
import { control } from '../bridge/control';
import { useKeepAwakeStore } from '../state/keepAwake';
import { useLayoutStore } from '../state/layout';
import { useSettingsStore } from '../state/settings';
import SettingsDialog from './SettingsDialog.vue';

// P103 Part 2 (§5.4): Kira Studio's own TitleBar.vue, trimmed — no mode switcher (one module), no
// Operations panel toggle. Now a thin composition over the shared bar chrome
// (packages/workbench/src/components/TitleBar.vue). P116 G5/G6 add the keep-awake toggle and "New
// window" button back — TitleBarWindowActions.vue, shared with Kira Studio's own copy of this file.
const settingsStore = useSettingsStore();
const layoutStore = useLayoutStore();
const keepAwakeStore = useKeepAwakeStore();

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
