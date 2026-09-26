<script setup lang="ts">
// P104 §6.1: every converted call site reaches timing (delayDuration/skipDelayDuration) through
// this one provider.
import { TooltipProvider } from '@theme/components/ui/tooltip';
import ConfirmDialog from '@workbench/components/ConfirmDialog.vue';
import ContextMenu from '@workbench/components/ContextMenu.vue';
import { workbenchHostKey } from '@workbench/host';
import { onMounted, onUnmounted, provide } from 'vue';
import { control } from './bridge/control';
import { useLayoutStore } from './state/layout';
import { useSettingsStore } from './state/settings';
import { useTabsStore } from './state/tabs';
import GitCredentialDialog from './workbench/GitCredentialDialog.vue';
import GitPairingDialog from './workbench/GitPairingDialog.vue';
import { createWorkbenchHost } from './workbench/host';
import TitleBar from './workbench/TitleBar.vue';
import WorkbenchShell from './workbench/WorkbenchShell.vue';

// P103 Part 2 (§5.4): provided once, here, for MainView/TabStrip/WorkbenchShell (via their own
// per-app workbench/*.vue wrappers) to inject through packages/workbench/src/host.ts.
provide(workbenchHostKey, createWorkbenchHost());

// P100 Part 2: Kira Studio's own App.vue, trimmed to this app's own always-mounted root dialogs —
// ConfirmDialog (G1 D17's own precedent) and, moved here wholesale from Studio,
// GitPairingDialog/GitCredentialDialog (a pairing/credential prompt must be able to appear with
// nothing else open).
//
// P116 G1-G4: this app's own Go menu (internal/appshell/menu.go) now emits five of Kira Studio's
// own dozen menu-bar CHANNEL commands (Settings…, Toggle Project Panel, Next/Previous/Close Tab) —
// subscribed here the same shape Studio's own App.vue uses, trimmed to only those five (this app
// has no command palette/connections/requests/imports/view-find-refresh-run-format of its own).
const layoutStore = useLayoutStore();
const settingsStore = useSettingsStore();
const tabsStore = useTabsStore();

let unsubscribe: Array<() => void> = [];

onMounted(() => {
  unsubscribe = [
    control.onOpenSettings(() => {
      settingsStore.settingsOpen = true;
    }),
    control.onToggleProjectPanel(layoutStore.toggleProjectPanel),
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
    <div class="h-full flex flex-col">
      <TitleBar />
      <WorkbenchShell />
    </div>
    <GitPairingDialog />
    <GitCredentialDialog />
    <ConfirmDialog />
    <ContextMenu />
  </TooltipProvider>
</template>
