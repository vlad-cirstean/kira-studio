<script setup lang="ts">
import { computed } from 'vue';
import { cellSelectionState } from '../state/cellSelection';
import PanelSplitter from './PanelSplitter.vue';
import CellEditorPanel from './panels/CellEditorPanel.vue';
import MainView from './panels/MainView.vue';
import OperationsPanel from './panels/OperationsPanel.vue';
import ProjectPanel from './panels/ProjectPanel.vue';
import TabStrip from './panels/TabStrip.vue';
import StatusBar from './StatusBar.vue';
import {
  layoutState,
  setCellEditorHeight,
  setOperationsHeight,
  setProjectWidth,
} from './state/layout';

const projectVisible = computed(() => layoutState.panel.project.visible);
// Driven entirely by selection now, not a manual flag (D2): the panel exists to show a currently
// selected cell, so it only makes sense to be on screen while one is selected. There's no longer
// a toggle to disagree with this, so the old `layoutState.panel.cellEditor.visible` flag was
// removed rather than kept alongside as a second, now-unreachable gate.
const cellVisible = computed(() => cellSelectionState.current !== null);
const opsVisible = computed(() => layoutState.panel.operations.visible);

const gridStyle = computed(() => ({
  '--project-w': projectVisible.value ? `${layoutState.panel.project.width}px` : '0px',
  '--project-split-w': projectVisible.value ? 'var(--kira-gap)' : '0px',
  '--cell-h': cellVisible.value ? `${layoutState.panel.cellEditor.height}px` : '0px',
  '--cell-split-h': cellVisible.value ? 'var(--kira-gap)' : '0px',
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
      <div class="tab-strip" data-testid="tab-strip"><TabStrip /></div>
      <div class="main-view" data-testid="main-view"><MainView /></div>
    </div>

    <PanelSplitter
      v-if="cellVisible"
      style="grid-area: splitcell"
      orientation="row"
      reverse
      :size="layoutState.panel.cellEditor.height"
      :min="120"
      :max="480"
      @resize="setCellEditorHeight"
    />
    <div
      v-if="cellVisible"
      class="panel-surface"
      style="grid-area: cell"
      data-testid="cell-editor"
    >
      <CellEditorPanel />
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
    'project splitproj splitcell'
    'project splitproj cell'
    'splitops splitops splitops'
    'ops ops ops'
    'status status status';
  grid-template-columns: var(--project-w) var(--project-split-w) 1fr;
  grid-template-rows:
    1fr var(--cell-split-h) var(--cell-h) var(--ops-split-h) var(--ops-h)
    var(--kira-statusbar-h);
  gap: var(--kira-gap);
  padding: var(--kira-gap);
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

.tab-strip {
  height: var(--kira-h-lg);
  flex-shrink: 0;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-chrome);
  /* A little breathing room before the view's own breadcrumb (ViewHeader) — without it the tab
     strip's border sat flush against the breadcrumb row with no visual separation at all.
     `--kira-s-2` (4px) still read as almost no gap at all; `--kira-s-3` is the smallest step up. */
  margin-bottom: var(--kira-s-3);
}

.main-view {
  flex: 1;
  min-height: 0;
}
</style>
