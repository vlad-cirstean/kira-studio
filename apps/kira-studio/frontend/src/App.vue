<script setup lang="ts">
import AppTooltip from '@workbench/components/AppTooltip.vue';
import ConfirmDialog from '@workbench/components/ConfirmDialog.vue';
import ContextMenu from '@workbench/components/ContextMenu.vue';
import { workbenchHostKey } from '@workbench/host';
import { runCommand } from '@workbench/shortcuts/commands';
import { useTooltipStore } from '@workbench/state/tooltip';
import { onMounted, onUnmounted, provide } from 'vue';
import ApiDialogs from './api/ApiDialogs.vue';
import { useCollectionsStore } from './api/state/collections';
import { openApiRequestTab } from './api/tabs';
import { control } from './bridge/control';
import ConnectionDialog from './project/ConnectionDialog.vue';
import DataGripImportDialog from './project/DataGripImportDialog.vue';
import CommandPalette from './shortcuts/CommandPalette.vue';
import { usePaletteStore } from './shortcuts/state';
import { useConnectionDialogStore } from './state/connections';
import { useDatagripImportStore } from './state/datagripImport';
import { useFakeDataStore } from './state/fakeData';
import { useLayoutStore } from './state/layout';
import { useModeStore } from './state/mode';
import { useObjectStoreStore } from './state/objectStore';
import { useSettingsStore } from './state/settings';
import { useTabsStore } from './state/tabs';
import DbMcpApprovalDialog from './workbench/DbMcpApprovalDialog.vue';
import GenerateDataDialog from './workbench/GenerateDataDialog.vue';
import { createWorkbenchHost } from './workbench/host';
import { useEngineStore } from './workbench/state/engine';
import TitleBar from './workbench/TitleBar.vue';
import UploadObjectDialog from './workbench/UploadObjectDialog.vue';
import WorkbenchShell from './workbench/WorkbenchShell.vue';

// P103 Part 2 (§5.4): provided once, here, for MainView/TabStrip/WorkbenchShell (via their own
// per-app workbench/*.vue wrappers) to inject through packages/workbench/src/host.ts.
provide(workbenchHostKey, createWorkbenchHost());

const engineStore = useEngineStore();
const tooltipStore = useTooltipStore();
const paletteStore = usePaletteStore();
const modeStore = useModeStore();
const datagripImportStore = useDatagripImportStore();
const fakeDataStore = useFakeDataStore();
const objectStoreStore = useObjectStoreStore();
const layoutStore = useLayoutStore();
const collectionsStore = useCollectionsStore();
const connectionDialogStore = useConnectionDialogStore();
const tabsStore = useTabsStore();
const settingsStore = useSettingsStore();

let unsubscribe: Array<() => void> = [];
let teardownTooltips: (() => void) | null = null;

function closeActiveTab(): void {
  if (modeStore.activeTab) tabsStore.closeTab(modeStore.activeTab.id);
}

onMounted(() => {
  void engineStore.initEngineState();
  teardownTooltips = tooltipStore.initTooltips();
  unsubscribe = [
    control.onOpenSettings(() => {
      settingsStore.settingsOpen = true;
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
    control.onTabNext(tabsStore.activateNextTab),
    control.onTabPrev(tabsStore.activatePrevTab),
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
  <!-- P1 C8: the frame TitleBar + WorkbenchShell now share — WorkbenchShell.vue's own root swapped
       `height: 100%` for `flex: 1; min-height: 0` to match. -->
  <div class="h-full flex flex-col">
    <TitleBar />
    <WorkbenchShell />
  </div>
  <ConnectionDialog v-if="connectionDialogStore.open" />
  <DataGripImportDialog v-if="datagripImportStore.open" />
  <ApiDialogs />
  <UploadObjectDialog v-if="objectStoreStore.open" />
  <GenerateDataDialog v-if="fakeDataStore.open" />
  <DbMcpApprovalDialog />
  <ConfirmDialog />
  <ContextMenu />
  <CommandPalette />
  <AppTooltip />
</template>
