<script setup lang="ts">
import AppTooltip from '@workbench/components/AppTooltip.vue';
import ConfirmDialog from '@workbench/components/ConfirmDialog.vue';
import ContextMenu from '@workbench/components/ContextMenu.vue';
import { workbenchHostKey } from '@workbench/host';
import { useTooltipStore } from '@workbench/state/tooltip';
import { onMounted, onUnmounted, provide } from 'vue';
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
// nothing else open). Studio's own onMounted here subscribed to a dozen menu-bar CHANNEL commands
// (onOpenSettings/onToggleProjectPanel/onCommandPalette/onTabNext/…) — this app's own Go menu
// (internal/shell/menutemplate.go) emits none of those (bridge/index.ts's own control object has
// no onOpenSettings/onToggleProjectPanel/onCommandPalette/onTabNext/onTabPrev/onTabClose/onViewFind
// etc. at all, confirmed by grepping it), so there is nothing left to subscribe to here — only
// tooltip init/teardown remains.
const tooltipStore = useTooltipStore();

let teardownTooltips: (() => void) | null = null;

onMounted(() => {
  teardownTooltips = tooltipStore.initTooltips();
});

onUnmounted(() => {
  teardownTooltips?.();
});
</script>

<template>
  <div class="h-full flex flex-col">
    <TitleBar />
    <WorkbenchShell />
  </div>
  <GitPairingDialog />
  <GitCredentialDialog />
  <ConfirmDialog />
  <ContextMenu />
  <AppTooltip />
</template>
