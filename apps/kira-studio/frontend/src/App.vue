<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import CopyAsCurlDialog from './api/CopyAsCurlDialog.vue';
import DynamicValuesDialog from './api/DynamicValuesDialog.vue';
import EditRawRequestDialog from './api/EditRawRequestDialog.vue';
import EnvironmentsDialog from './api/EnvironmentsDialog.vue';
import ImportCurlDialog from './api/ImportCurlDialog.vue';
import SaveRequestDialog from './api/SaveRequestDialog.vue';
import { saveDialogState } from './api/state/collections';
import { copyAsCurlDialogState, importCurlDialogState } from './api/state/curl';
import { dynamicValuesDialogState } from './api/state/dynamicValues';
import { editRawDialogState } from './api/state/raw';
import { environmentsDialogState, variablesDialogState } from './api/state/variables';
import VariablesDialog from './api/VariablesDialog.vue';
import { control } from './bridge/control';
import ConnectionDialog from './project/ConnectionDialog.vue';
import CommandPalette from './shortcuts/CommandPalette.vue';
import { runCommand } from './shortcuts/commands';
import { togglePalette } from './shortcuts/state';
import { connectionsState, openCreateDialog } from './state/connections';
import { fakeDataDialogState } from './state/fakeData';
import { toggleOperationsPanel, toggleProjectPanel } from './state/layout';
import { activeTab } from './state/mode';
import { uploadDialogState } from './state/objectStore';
import { settingsOpen } from './state/settings';
import { activateNextTab, activatePrevTab, closeTab } from './state/tabs';
import AppTooltip from './workbench/AppTooltip.vue';
import ConfirmDialog from './workbench/ConfirmDialog.vue';
import ContextMenu from './workbench/ContextMenu.vue';
import GenerateDataDialog from './workbench/GenerateDataDialog.vue';
import { initEngineState } from './workbench/state/engine';
import { initTooltips } from './workbench/state/tooltip';
import TitleBar from './workbench/TitleBar.vue';
import UploadObjectDialog from './workbench/UploadObjectDialog.vue';
import WorkbenchShell from './workbench/WorkbenchShell.vue';

let unsubscribe: Array<() => void> = [];
let teardownTooltips: (() => void) | null = null;

function closeActiveTab(): void {
  if (activeTab.value) closeTab(activeTab.value.id);
}

onMounted(() => {
  void initEngineState();
  teardownTooltips = initTooltips();
  unsubscribe = [
    control.onOpenSettings(() => {
      settingsOpen.value = true;
    }),
    control.onNewConnection(() => openCreateDialog()),
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
    control.onViewFormat(() => runCommand('view.format')),
  ];
});

onUnmounted(() => {
  for (const off of unsubscribe) off();
  teardownTooltips?.();
});
</script>

<template>
  <div class="app-frame">
    <TitleBar />
    <WorkbenchShell />
  </div>
  <ConnectionDialog v-if="connectionsState.dialog.open" />
  <SaveRequestDialog v-if="saveDialogState.open" />
  <VariablesDialog v-if="variablesDialogState.open" />
  <EnvironmentsDialog v-if="environmentsDialogState.open" />
  <DynamicValuesDialog v-if="dynamicValuesDialogState.open" />
  <ImportCurlDialog v-if="importCurlDialogState.open" />
  <CopyAsCurlDialog v-if="copyAsCurlDialogState.open" />
  <EditRawRequestDialog v-if="editRawDialogState.open" />
  <UploadObjectDialog v-if="uploadDialogState.open" />
  <GenerateDataDialog v-if="fakeDataDialogState.open" />
  <ConfirmDialog />
  <ContextMenu />
  <CommandPalette />
  <AppTooltip />
</template>

<style scoped>
/* P1 C8: the frame TitleBar + WorkbenchShell now share — WorkbenchShell.vue's own root swapped
   `height: 100%` for `flex: 1; min-height: 0` to match. */
.app-frame {
  height: 100%;
  display: flex;
  flex-direction: column;
}
</style>
