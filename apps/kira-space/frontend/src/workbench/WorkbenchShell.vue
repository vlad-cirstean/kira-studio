<script setup lang="ts">
import PanelSplitter from '@theme/primitives/PanelSplitter.vue';
import { useEventListener } from '@vueuse/core';
import { computed } from 'vue';
import GitPanel from '../repo/GitPanel.vue';
import { runCommand } from '../shortcuts/commands';
import { shortcutFor } from '../shortcuts/keys';
import { useLayoutStore } from '../state/layout';
import MainView from './panels/MainView.vue';
import TabStrip from './panels/TabStrip.vue';
import StatusBar from './StatusBar.vue';

// P100 Part 2: Kira Studio's own WorkbenchShell.vue, trimmed — this app has exactly one module
// (no MODES registry, no mode-scoped left panel lookup: GitPanel.vue is the whole of this app's
// own left panel) and no Operations panel (no ops log here), so the grid collapses to
// project/splitproj/main/status — Studio's own splitops/ops rows are dropped, not hidden.
const layoutStore = useLayoutStore();

// shortcuts/keys.ts's own doc comment: this app's Go menu emits no accelerator channels
// (App.vue's own note), so every shortcut binds through a local keydown here, regardless of the
// shared SHORTCUTS table's `global` flag. 'view.find' is the one id kira-space actually has a
// registered handler for (RepoFileView.vue/RepoDiffView.vue's own `registerCommand('view.find', …)`
// — Monaco's find widget when the editor itself isn't already focused). 'repo.search' has no chord
// of its own even in Studio's original (command-palette only, shortcuts/state.ts) — kira-space has
// no command palette (out of this phase's own scope), so it stays reachable only through
// GitPanel.vue's own UI, not the keyboard.
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  const id = shortcutFor(e, ['view.find']);
  if (!id) return;
  e.preventDefault();
  runCommand(id);
});

const projectVisible = computed(() => layoutStore.panel.project.visible);

const gridStyle = computed(() => ({
  '--project-w': projectVisible.value ? `${layoutStore.panel.project.width}px` : '0px',
  '--project-split-w': projectVisible.value ? 'var(--kira-gap)' : '0px',
}));
</script>

<template>
  <div class="workbench-shell" :style="gridStyle">
    <div
      v-if="projectVisible"
      class="panel-surface"
      style="grid-area: project"
      data-testid="project-panel"
    >
      <GitPanel />
    </div>
    <PanelSplitter
      v-if="projectVisible"
      style="grid-area: splitproj"
      orientation="col"
      :size="layoutStore.panel.project.width"
      :min="180"
      :max="480"
      @resize="layoutStore.setProjectWidth"
    />

    <div class="editor-area" style="grid-area: main">
      <div class="tab-strip-slot" data-testid="tab-strip"><TabStrip /></div>
      <div class="main-view" data-testid="main-view"><MainView /></div>
    </div>

    <div style="grid-area: status" data-testid="status-bar">
      <StatusBar />
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.workbench-shell {
  @apply flex-1 min-h-0 box-border grid;
  grid-template-areas:
    'project splitproj main'
    'status status status';
  grid-template-columns: var(--project-w) var(--project-split-w) 1fr;
  grid-template-rows: 1fr var(--kira-statusbar-h);
  gap: var(--kira-gap);
  padding: 0 var(--kira-window-inset) var(--kira-gap);
  background: var(--kira-bg-chrome);
}

.panel-surface {
  @apply overflow-hidden min-w-0 min-h-0 rounded-[var(--kira-radius)];
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg);
}

.editor-area {
  @apply flex flex-col min-w-0 min-h-0 overflow-hidden rounded-[var(--kira-radius)];
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg);
}

.tab-strip-slot {
  height: var(--kira-tabbar-h);
  @apply min-h-0 overflow-hidden shrink-0;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-chrome);
}

.main-view {
  @apply flex-1 min-h-0;
}
</style>
