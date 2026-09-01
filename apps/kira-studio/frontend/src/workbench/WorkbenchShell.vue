<script setup lang="ts">
import { computed } from 'vue';
import { layoutState, setOperationsHeight, setProjectWidth } from '../state/layout';
import PanelSplitter from '../theme/primitives/PanelSplitter.vue';
import MainView from './panels/MainView.vue';
import OperationsPanel from './panels/OperationsPanel.vue';
import ProjectPanel from './panels/ProjectPanel.vue';
import TabStrip from './panels/TabStrip.vue';
import StatusBar from './StatusBar.vue';

const projectVisible = computed(() => layoutState.panel.project.visible);
const opsVisible = computed(() => layoutState.panel.operations.visible);

const gridStyle = computed(() => ({
  '--project-w': projectVisible.value ? `${layoutState.panel.project.width}px` : '0px',
  '--project-split-w': projectVisible.value ? 'var(--kira-gap)' : '0px',
  '--ops-h': opsVisible.value ? `${layoutState.panel.operations.height}px` : '0px',
  '--ops-split-h': opsVisible.value ? 'var(--kira-gap)' : '0px',
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
      <ProjectPanel />
    </div>
    <PanelSplitter
      v-if="projectVisible"
      style="grid-area: splitproj"
      orientation="col"
      :size="layoutState.panel.project.width"
      :min="180"
      :max="480"
      @resize="setProjectWidth"
    />

    <div class="editor-area" style="grid-area: main">
      <div class="tab-strip-slot" data-testid="tab-strip"><TabStrip /></div>
      <div class="main-view" data-testid="main-view"><MainView /></div>
    </div>

    <PanelSplitter
      v-if="opsVisible"
      style="grid-area: splitops"
      orientation="row"
      reverse
      :size="layoutState.panel.operations.height"
      :min="100"
      :max="500"
      @resize="setOperationsHeight"
    />
    <div
      v-if="opsVisible"
      class="panel-surface"
      style="grid-area: ops"
      data-testid="operations-panel"
    >
      <OperationsPanel />
    </div>

    <div style="grid-area: status" data-testid="status-bar">
      <StatusBar />
    </div>
  </div>
</template>

<style scoped>
.workbench-shell {
  height: 100%;
  box-sizing: border-box;
  display: grid;
  grid-template-areas:
    'project splitproj main'
    'splitops splitops splitops'
    'ops ops ops'
    'status status status';
  grid-template-columns: var(--project-w) var(--project-split-w) 1fr;
  grid-template-rows: 1fr var(--ops-split-h) var(--ops-h) var(--kira-statusbar-h);
  gap: var(--kira-gap);
  /* Top/right/left inset from the window edge (P31 D8) is its own token, deliberately not
     --kira-gap — that token also sizes the splitter track, and raising it would thicken every
     resize bar. Bottom stays --kira-gap: the status bar reads as seated on the window edge. */
  padding: var(--kira-window-inset) var(--kira-window-inset) var(--kira-gap);
  background: var(--kira-bg-chrome);
}

.panel-surface {
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg);
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.editor-area {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg);
  overflow: hidden;
}

.tab-strip-slot {
  /* Taller than a tab (`--kira-h-md`, 26px) by design — the extra height is the tab's own
     breathing room from this row's border-bottom, not a margin tacked on after it. Every other
     boundary in this stack (breadcrumb / toolbar-rail / toolbar / grid) sits flush with zero gap;
     a `margin-bottom` here to "give the tab bar space" read as one lone, mismatched gap against
     that flush rhythm — asymmetric on its own, and still let a centred 26px tab sit only ~1.5px
     above the border line it was meant to clear. 34px centres the tab with ~3-4px on each side. */
  height: 34px;
  /* `.editor-area` is a column flexbox, so this row is itself a flex item on the vertical axis —
     without `min-height: 0` its default `min-height: auto` lets the tab buttons' own intrinsic
     height push it taller than the `height` above, which is what let individual tabs render past
     this row's bottom edge despite it being tall enough on paper. */
  min-height: 0;
  overflow: hidden;
  flex-shrink: 0;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-chrome);
}

.main-view {
  flex: 1;
  min-height: 0;
}
</style>
