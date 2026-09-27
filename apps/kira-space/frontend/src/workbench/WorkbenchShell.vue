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

// P129 Part 3 §0.12/§0.13/§2.1: a `layout: 'full'` module (`ade`) has no panel/start/newTab at all
// — `def`'s own `layout` discriminant is what every computed below narrows on, so a `FullModeDef`
// never has its (non-existent) `.panel`/`.start`/`.newTab` accessed.
const def = computed(() => MODES[modeStore.active]);
const isFull = computed(() => def.value.layout === 'full');
// P1 D6/C6 (Kira Studio's own pattern): the left panel mounts whichever module is active's own
// self-contained panel component.
const activeModePanel = computed(() => (def.value.layout === 'full' ? undefined : def.value.panel));
// MainView.vue's own fallback when the active module has no active tab.
const modeStart = computed(() => (def.value.layout === 'full' ? undefined : def.value.start));
// The tab strip's own "+", when the active module has one.
const modeNewTab = computed(() => (def.value.layout === 'full' ? undefined : def.value.newTab));
// Rendered in `#main` instead of the tab-scoped MainView, in place of it, for a full-layout module.
const fullView = computed(() => (def.value.layout === 'full' ? def.value.view : undefined));
</script>

<template>
  <WorkbenchShellBase
    :project-visible="!isFull && layoutStore.panel.project.visible"
    :project-width="layoutStore.panel.project.width"
    :tab-strip-visible="!isFull"
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
      <component :is="fullView" v-if="isFull" />
      <MainView v-else>
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
