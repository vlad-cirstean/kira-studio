<script setup lang="ts">
import { useEventListener } from '@vueuse/core';
import MainView from '@workbench/components/MainView.vue';
import TabStrip from '@workbench/components/TabStrip.vue';
import WorkbenchShellBase from '@workbench/components/WorkbenchShell.vue';
import { runCommand } from '@workbench/shortcuts/commands';
import { shortcutFor } from '@workbench/shortcuts/keys';
import { computed } from 'vue';
import { useLayoutStore } from '../state/layout';
import { useModeStore } from '../state/mode';
import { MODES } from './modes';
import StatusBar from './StatusBar.vue';

// P103 Part 2 (§5.4): Kira Studio's own WorkbenchShell.vue, trimmed — this app has no Operations
// panel, so `#dock` is never passed to the shared shell — its grid collapses to
// project/splitproj/main/status exactly as before (the shared component's own `.has-dock`-gated
// rows, §5.4's own hazard note). P128 §2.6/§2.7: `GitPanel`/`GitStart`, once this whole app's own
// left panel, are now one entry (`git`) in this app's own module registry (workbench/modes.ts),
// alongside `terminal` and `ade` — the per-module "+" branch this file used to hold moved into the
// module itself (repo/GitNewTab.vue), the same shape Kira Studio's own terminal module took at
// P128 §2.4. This file keeps only this app's own per-app content: the mode-scoped left-panel
// lookup and the "view.find" keydown binding.
const layoutStore = useLayoutStore();
const modeStore = useModeStore();

// shortcuts/keys.ts's own doc comment: this app's Go menu emits no accelerator channels, so every
// shortcut binds through a local keydown here, regardless of the shared SHORTCUTS table's `global`
// flag. 'view.find' is the one id kira-space actually has a registered handler for.
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  const id = shortcutFor(e, ['view.find']);
  if (!id) return;
  e.preventDefault();
  runCommand(id);
});

// P1 D6/C6 (Kira Studio's own pattern): the left panel mounts whichever module is active's own
// self-contained panel component.
const activeModePanel = computed(() => MODES[modeStore.active].panel);
// MainView.vue's own fallback when the active module has no active tab.
const modeStart = computed(() => MODES[modeStore.active].start);
// The tab strip's own "+", when the active module has one.
const modeNewTab = computed(() => MODES[modeStore.active].newTab);
</script>

<template>
  <WorkbenchShellBase
    :project-visible="layoutStore.panel.project.visible"
    :project-width="layoutStore.panel.project.width"
    @resize-project="layoutStore.setProjectWidth"
  >
    <template #panel>
      <component :is="activeModePanel" />
    </template>
    <template #tab-strip>
      <TabStrip>
        <template #new-tab>
          <component :is="modeNewTab" v-if="modeNewTab" />
        </template>
      </TabStrip>
    </template>
    <template #main>
      <MainView>
        <template #empty>
          <component :is="modeStart" />
        </template>
      </MainView>
    </template>
    <template #status>
      <StatusBar />
    </template>
  </WorkbenchShellBase>
</template>
