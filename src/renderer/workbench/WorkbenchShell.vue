<script setup lang="ts">
import { computed, ref } from 'vue';
import CellEditorPanel from './panels/CellEditorPanel.vue';
import MainView from './panels/MainView.vue';
import OperationsPanel from './panels/OperationsPanel.vue';
import ProjectPanel from './panels/ProjectPanel.vue';
import TabStrip from './panels/TabStrip.vue';
import Toolbar from './panels/Toolbar.vue';
import FilterToolbar from './FilterToolbar.vue';
import Splitter from './Splitter.vue';
import StatusBar from './StatusBar.vue';
import { findDataTab, tabsState } from './state/tabs';
import {
  layoutState,
  setCellEditorHeight,
  setOperationsHeight,
  setProjectWidth,
} from './state/layout';

const projectVisible = computed(() => layoutState.panel.project.visible);
const cellVisible = computed(() => layoutState.panel.cellEditor.visible);
const opsVisible = computed(() => layoutState.panel.operations.visible);
const filterVisible = ref(false);
// P2 renders the data toolbar only for a `data` tab (P4's `ddl` tab is out of scope here).
const activeTab = computed(() => {
  if (tabsState.activeId === null) return null;
  return findDataTab(tabsState.activeId);
});

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
    <Splitter
      v-if="projectVisible"
      style="grid-area: splitproj"
      orientation="col"
      :size="layoutState.panel.project.width"
      :min="180"
      :max="480"
      @resize="setProjectWidth"
    />

    <div class="main-column" style="grid-area: main">
      <div class="tab-strip" data-testid="tab-strip"><TabStrip /></div>
      <div class="toolbar" data-testid="toolbar">
        <Toolbar v-if="activeTab" :tab-id="activeTab.id" @toggle-filter="filterVisible = !filterVisible" />
      </div>
      <FilterToolbar v-if="filterVisible && activeTab" :tab="activeTab" />
      <div class="main-view" data-testid="main-view"><MainView /></div>
    </div>

    <Splitter
      v-if="cellVisible"
      style="grid-area: splitcell"
      orientation="row"
      reverse
      :size="layoutState.panel.cellEditor.height"
      :min="120"
      :max="480"
      @resize="setCellEditorHeight"
    />
    <div v-if="cellVisible" style="grid-area: cell" data-testid="cell-editor">
      <CellEditorPanel />
    </div>

    <Splitter
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
  padding: var(--kira-shell-pad);
  border: var(--kira-border-width) solid var(--kira-border);
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

.main-column {
  grid-area: main;
  display: flex;
  flex-direction: column;
  gap: var(--kira-gap);
  min-width: 0;
  min-height: 0;
}

.tab-strip {
  height: 36px;
  flex-shrink: 0;
  background: var(--kira-bg-chrome);
}

.toolbar {
  height: 32px;
  flex-shrink: 0;
}

.main-view {
  flex: 1;
  min-height: 0;
}
</style>
