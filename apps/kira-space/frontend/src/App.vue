<script setup lang="ts">
// P104 §6.1: every converted call site reaches timing (delayDuration/skipDelayDuration) through
// this one provider.
import { TooltipProvider } from '@theme/components/ui/tooltip';
import { automationsModuleKey } from '@workbench/automations/module';
import ConfirmDialog from '@workbench/components/ConfirmDialog.vue';
import ContextMenu from '@workbench/components/ContextMenu.vue';
import UpdateDialog from '@workbench/components/UpdateDialog.vue';
import { workbenchHostKey } from '@workbench/host';
import { memoryModuleKey } from '@workbench/memory/module';
import { onMounted, onUnmounted, provide } from 'vue';
import AdeReviewWindow from './ade/v2/review/AdeReviewWindow.vue';
import { useAdeReviewWindowStore } from './ade/v2/state/adeReviewWindow';
import { control } from './bridge/control';
import { useAppUpdateStore } from './state/appUpdate';
import { useLayoutStore } from './state/layout';
import { useSettingsStore } from './state/settings';
import { createAutomationsModule } from './workbench/automationsModule';
import GitCredentialDialog from './workbench/GitCredentialDialog.vue';
import GitPairingDialog from './workbench/GitPairingDialog.vue';
import { createWorkbenchHost, useTabsStore } from './workbench/host';
import MobilePairingDialog from './workbench/MobilePairingDialog.vue';
import { createMemoryModule } from './workbench/memoryModule';
import TitleBar from './workbench/TitleBar.vue';
import WorkbenchShell from './workbench/WorkbenchShell.vue';

// P103 Part 2 (§5.4): provided once, here, for MainView/TabStrip/WorkbenchShell (via their own
// per-app workbench/*.vue wrappers) to inject through packages/workbench/src/host.ts.
provide(workbenchHostKey, createWorkbenchHost());
// P128 §2.4/§2.7: the terminal module's own context, for AutomationsPanel.vue/AutomationsStart.vue/
// AutomationsNewTab.vue/TerminalTabView.vue (all shared with Kira Studio) to inject.
provide(automationsModuleKey, createAutomationsModule());
provide(memoryModuleKey, createMemoryModule());

// P100 Part 2: Kira Studio's own App.vue, trimmed to this app's own always-mounted root dialogs —
// ConfirmDialog (G1 D17's own precedent) and, moved here wholesale from Studio,
// GitPairingDialog/GitCredentialDialog (a pairing/credential prompt must be able to appear with
// nothing else open).
//
// P116 G1-G4 (P132 Part 2 adds Toggle Operations Panel): this app's own Go menu
// (internal/appshell/menu.go) emits six of Kira Studio's own dozen menu-bar CHANNEL commands
// (Settings…, Toggle Project/Operations Panel, Next/Previous/Close Tab) — subscribed here the same
// shape Studio's own App.vue uses (this app has no command palette/connections/requests/imports/
// view-find-refresh-run-format of its own).
const layoutStore = useLayoutStore();
const settingsStore = useSettingsStore();
const tabsStore = useTabsStore();
const appUpdateStore = useAppUpdateStore();
const reviewWindow = useAdeReviewWindowStore();

let unsubscribe: Array<() => void> = [];

onMounted(() => {
  unsubscribe = [
    control.onOpenSettings(() => {
      settingsStore.settingsOpen = true;
    }),
    control.onToggleProjectPanel(layoutStore.toggleProjectPanel),
    control.onToggleOperationsPanel(layoutStore.toggleOperationsPanel),
    control.onTabNext(tabsStore.activateNextTab),
    control.onTabPrev(tabsStore.activatePrevTab),
    control.onTabClose(tabsStore.closeActiveTab),
  ];
});

onUnmounted(() => {
  for (const off of unsubscribe) off();
});
</script>

<template>
  <!-- P104 §6.1: disable-hoverable-content matches the app's pointer-events: none tooltip. -->
  <TooltipProvider :delay-duration="400" :skip-delay-duration="300" disable-hoverable-content>
    <AdeReviewWindow v-if="reviewWindow.target" />
    <div v-else class="h-full flex flex-col">
      <TitleBar />
      <WorkbenchShell />
    </div>
    <GitPairingDialog />
    <MobilePairingDialog />
    <GitCredentialDialog />
    <ConfirmDialog />
    <UpdateDialog v-if="appUpdateStore.dialogOpen" :store="appUpdateStore" />
    <ContextMenu />
  </TooltipProvider>
</template>
