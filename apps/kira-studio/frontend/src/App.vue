<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import ApiDialogs from './api/ApiDialogs.vue';
import { importCollection } from './api/state/collections';
import { openApiRequestTab } from './api/tabs';
import { control } from './bridge/control';
import ConnectionDialog from './project/ConnectionDialog.vue';
import DataGripImportDialog from './project/DataGripImportDialog.vue';
import CommandPalette from './shortcuts/CommandPalette.vue';
import { runCommand } from './shortcuts/commands';
import { togglePalette } from './shortcuts/state';
import { connectionsState, openCreateDialog } from './state/connections';
import { datagripImportState, pickAndScanDataGripProject } from './state/datagripImport';
import { fakeDataDialogState } from './state/fakeData';
import { toggleOperationsPanel, toggleProjectPanel } from './state/layout';
import { activeTab, setMode } from './state/mode';
import { uploadDialogState } from './state/objectStore';
import { settingsOpen } from './state/settings';
import { activateNextTab, activatePrevTab, closeTab } from './state/tabs';
import AppTooltip from './workbench/AppTooltip.vue';
import ConfirmDialog from './workbench/ConfirmDialog.vue';
import ContextMenu from './workbench/ContextMenu.vue';
import GenerateDataDialog from './workbench/GenerateDataDialog.vue';
import GitPairingDialog from './workbench/GitPairingDialog.vue';
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
    // P28 D18: three menu-bar commands. Subscribed here rather than in the panels that used to
    // own the buttons, so they work with no panel mounted — which is the point of moving them.
    control.onNewRequest(() => {
      setMode('api');
      openApiRequestTab();
    }),
    control.onImportPostman(() => {
      setMode('api');
      void importCollection();
    }),
    control.onImportDataGrip(() => {
      setMode('studio');
      void pickAndScanDataGripProject();
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
  <DataGripImportDialog v-if="datagripImportState.open" />
  <ApiDialogs />
  <UploadObjectDialog v-if="uploadDialogState.open" />
  <GenerateDataDialog v-if="fakeDataDialogState.open" />
  <GitPairingDialog />
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
