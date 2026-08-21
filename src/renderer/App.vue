<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { control } from './bridge/control';
import ConnectionDialog from './project/ConnectionDialog.vue';
import FiltersDialog from './project/FiltersDialog.vue';
import { closeDialog, connectionsState } from './project/state/connections';
import { closeFiltersDialog, filtersDialogState } from './project/state/tree';
import ContextMenu from './workbench/ContextMenu.vue';
import { contextMenuState } from './workbench/state/contextMenu';
import { initEngineState } from './workbench/state/engine';
import { toggleOperationsPanel, toggleProjectPanel } from './workbench/state/layout';
import { settingsOpen } from './workbench/state/settings';
import WorkbenchShell from './workbench/WorkbenchShell.vue';

let unsubscribe: Array<() => void> = [];

onMounted(() => {
  void initEngineState();
  unsubscribe = [
    control.onOpenSettings(() => {
      settingsOpen.value = true;
    }),
    control.onToggleProjectPanel(toggleProjectPanel),
    control.onToggleOperationsPanel(toggleOperationsPanel),
  ];
});

onUnmounted(() => {
  for (const off of unsubscribe) off();
});
</script>

<template>
  <WorkbenchShell />
  <Teleport to="body">
    <ConnectionDialog v-if="connectionsState.dialog.open" @close="closeDialog" />
    <FiltersDialog v-if="filtersDialogState.open" @close="closeFiltersDialog" />
    <ContextMenu v-if="contextMenuState.open" />
  </Teleport>
</template>
