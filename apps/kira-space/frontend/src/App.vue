<script setup lang="ts">
// P104 §6.1: every converted call site reaches timing (delayDuration/skipDelayDuration) through
// this one provider.
import { TooltipProvider } from '@theme/components/ui/tooltip';
import ConfirmDialog from '@workbench/components/ConfirmDialog.vue';
import ContextMenu from '@workbench/components/ContextMenu.vue';
import { workbenchHostKey } from '@workbench/host';
import { provide } from 'vue';
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
// etc. at all, confirmed by grepping it), so there is nothing left to subscribe to here — P104
// deleted the last one (tooltip init/teardown, now TooltipProvider's own job).
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
