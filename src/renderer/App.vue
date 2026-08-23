<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { control } from './bridge/control';
import ConnectionDialog from './project/ConnectionDialog.vue';
import CommandPalette from './shortcuts/CommandPalette.vue';
import { runCommand } from './shortcuts/commands';
import { togglePalette } from './shortcuts/state';
import { connectionsState } from './state/connections';
import { settingsOpen } from './state/settings';
import { activateNextTab, activatePrevTab, closeTab, tabsState } from './state/tabs';
import ContextMenu from './workbench/ContextMenu.vue';
import { initEngineState } from './workbench/state/engine';
import { toggleOperationsPanel, toggleProjectPanel } from './workbench/state/layout';
import WorkbenchShell from './workbench/WorkbenchShell.vue';

let unsubscribe: Array<() => void> = [];

function closeActiveTab(): void {
  if (tabsState.activeId) closeTab(tabsState.activeId);
}

onMounted(() => {
  void initEngineState();
  unsubscribe = [
    control.onOpenSettings(() => {
      settingsOpen.value = true;
    }),
    control.onToggleProjectPanel(toggleProjectPanel),
    control.onToggleOperationsPanel(toggleOperationsPanel),
    control.onCommandPalette(togglePalette),
    control.onTabNext(activateNextTab),
    control.onTabPrev(activatePrevTab),
    control.onTabClose(closeActiveTab),
    control.onViewFind(() => runCommand('view.find')),
    control.onViewRefresh(() => runCommand('view.refresh')),
    control.onViewRun(() => runCommand('view.run')),
    control.onViewRunAll(() => runCommand('view.run-all')),
  ];
});

onUnmounted(() => {
  for (const off of unsubscribe) off();
});
</script>

<template>
  <WorkbenchShell />
  <ConnectionDialog v-if="connectionsState.dialog.open" />
  <ContextMenu />
  <CommandPalette />
</template>
