<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import ApiDialogs from './api/ApiDialogs.vue';
import { useCollectionsStore } from './api/state/collections';
import { openApiRequestTab } from './api/tabs';
import { control } from './bridge/control';
import ConnectionDialog from './project/ConnectionDialog.vue';
import DataGripImportDialog from './project/DataGripImportDialog.vue';
import QuickOpen from './repo/QuickOpen.vue';
import { useQuickOpenStore } from './repo/state/quickOpen';
import CommandPalette from './shortcuts/CommandPalette.vue';
import { runCommand } from './shortcuts/commands';
import { usePaletteStore } from './shortcuts/state';
import { useConnectionDialogStore } from './state/connections';
import { useDatagripImportStore } from './state/datagripImport';
import { useFakeDataStore } from './state/fakeData';
import { useLayoutStore } from './state/layout';
import { useModeStore } from './state/mode';
import { useObjectStoreStore } from './state/objectStore';
import { settingsOpen } from './state/settings';
import { activateNextTab, activatePrevTab, closeTab } from './state/tabs';
import AppTooltip from './workbench/AppTooltip.vue';
import ConfirmDialog from './workbench/ConfirmDialog.vue';
import ContextMenu from './workbench/ContextMenu.vue';
import DbMcpApprovalDialog from './workbench/DbMcpApprovalDialog.vue';
import GenerateDataDialog from './workbench/GenerateDataDialog.vue';
import GitCredentialDialog from './workbench/GitCredentialDialog.vue';
import GitPairingDialog from './workbench/GitPairingDialog.vue';
import { useEngineStore } from './workbench/state/engine';
import { useTooltipStore } from './workbench/state/tooltip';
import TitleBar from './workbench/TitleBar.vue';
import UploadObjectDialog from './workbench/UploadObjectDialog.vue';
import WorkbenchShell from './workbench/WorkbenchShell.vue';

const engineStore = useEngineStore();
const tooltipStore = useTooltipStore();
const paletteStore = usePaletteStore();
const modeStore = useModeStore();
const datagripImportStore = useDatagripImportStore();
const fakeDataStore = useFakeDataStore();
const objectStoreStore = useObjectStoreStore();
const layoutStore = useLayoutStore();
const quickOpenStore = useQuickOpenStore();
const collectionsStore = useCollectionsStore();
const connectionDialogStore = useConnectionDialogStore();

let unsubscribe: Array<() => void> = [];
let teardownTooltips: (() => void) | null = null;

function closeActiveTab(): void {
  if (modeStore.activeTab) closeTab(modeStore.activeTab.id);
}

onMounted(() => {
  void engineStore.initEngineState();
  teardownTooltips = tooltipStore.initTooltips();
  unsubscribe = [
    control.onOpenSettings(() => {
      settingsOpen.value = true;
    }),
    control.onNewConnection(() => connectionDialogStore.openCreateDialog()),
    // P28 D18: three menu-bar commands. Subscribed here rather than in the panels that used to
    // own the buttons, so they work with no panel mounted — which is the point of moving them.
    control.onNewRequest(() => {
      modeStore.setMode('api');
      openApiRequestTab();
    }),
    control.onImportPostman(() => {
      modeStore.setMode('api');
      void collectionsStore.importCollection();
    }),
    control.onImportDataGrip(() => {
      modeStore.setMode('studio');
      void datagripImportStore.pickAndScanDataGripProject();
    }),
    control.onToggleProjectPanel(layoutStore.toggleProjectPanel),
    control.onToggleOperationsPanel(layoutStore.toggleOperationsPanel),
    control.onCommandPalette(paletteStore.togglePalette),
    control.onQuickOpen(quickOpenStore.openQuickOpen),
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
  <ConnectionDialog v-if="connectionDialogStore.open" />
  <DataGripImportDialog v-if="datagripImportStore.open" />
  <ApiDialogs />
  <UploadObjectDialog v-if="objectStoreStore.open" />
  <GenerateDataDialog v-if="fakeDataStore.open" />
  <GitPairingDialog />
  <DbMcpApprovalDialog />
  <GitCredentialDialog />
  <ConfirmDialog />
  <ContextMenu />
  <CommandPalette />
  <QuickOpen />
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
