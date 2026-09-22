<script setup lang="ts">
import PanelSplitter from '@theme/primitives/PanelSplitter.vue';
import { computed } from 'vue';
import { useLayoutStore } from '../state/layout';
import { useModeStore } from '../state/mode';
import { MODES } from './modes';
import MainView from './panels/MainView.vue';
import OperationsPanel from './panels/OperationsPanel.vue';
import TabStrip from './panels/TabStrip.vue';
import StatusBar from './StatusBar.vue';

const modeStore = useModeStore();
const layoutStore = useLayoutStore();

// P1 D6/C6: the left panel mounts whichever mode is active's own self-contained panel component
// (ProjectPanel for Studio, api/CollectionsPanel for Api) — the shared PanelShell slot Studio used
// to have all to itself now comes from the registry, not a hardcoded <ProjectPanel />. P100 Part
// 2: Git (P67b §4.1's third peer, GitPanel.vue) moved to apps/kira-space wholesale, so this is
// back to a direct lookup with no repo-workspace folding step.
const activeModePanel = computed(() => MODES[modeStore.active].panel);

const projectVisible = computed(() => layoutStore.panel.project.visible);
const opsVisible = computed(() => layoutStore.panel.operations.visible);

const gridStyle = computed(() => ({
  '--project-w': projectVisible.value ? `${layoutStore.panel.project.width}px` : '0px',
  '--project-split-w': projectVisible.value ? 'var(--kira-gap)' : '0px',
  '--ops-h': opsVisible.value ? `${layoutStore.panel.operations.height}px` : '0px',
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
      <component :is="activeModePanel" />
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

    <PanelSplitter
      v-if="opsVisible"
      style="grid-area: splitops"
      orientation="row"
      reverse
      :size="layoutStore.panel.operations.height"
      :min="100"
      :max="500"
      @resize="layoutStore.setOperationsHeight"
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
@reference "@theme/base.css";

.workbench-shell {
  /* P1 C8: a flex child of App.vue's new .app-frame (TitleBar + WorkbenchShell), not a lone
     fill-parent block any more. Grid-template-areas/columns/rows stay hand CSS — the columns/rows
     are driven by :style-bound custom properties (gridStyle above), which Tailwind's utility
     scale has no way to express. */
  @apply flex-1 min-h-0 box-border grid;
  grid-template-areas:
    'project splitproj main'
    'splitops splitops splitops'
    'ops ops ops'
    'status status status';
  grid-template-columns: var(--project-w) var(--project-split-w) 1fr;
  grid-template-rows: 1fr var(--ops-split-h) var(--ops-h) var(--kira-statusbar-h);
  gap: var(--kira-gap);
  /* Right/left inset from the window edge (P31 D8) is its own token, deliberately not
     --kira-gap — that token also sizes the splitter track, and raising it would thicken every
     resize bar. Bottom stays --kira-gap: the status bar reads as seated on the window edge.
     No top inset (dropped alongside this session's own TitleBar.vue work): a padding-top here
     put a visible gap between the title bar's own bottom edge and this shell's content, which
     read as the title bar's content sitting off-centre relative to the panel right below it —
     not a title-bar centering bug, an optical one from the two regions' combined rhythm.
     --kira-titlebar-h absorbed the removed 6px instead, so the total vertical chrome is
     unchanged; only which region owns it moved. */
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
  /* Taller than a tab (`--kira-h-md`, 26px) by design — the extra height is the tab's own
     breathing room from this row's border-bottom, not a margin tacked on after it. Every other
     boundary in this stack (breadcrumb / toolbar-rail / toolbar / grid) sits flush with zero gap;
     a `margin-bottom` here to "give the tab bar space" read as one lone, mismatched gap against
     that flush rhythm — asymmetric on its own, and still let a centred 26px tab sit only ~1.5px
     above the border line it was meant to clear. 34px centres the tab with ~3-4px on each side. */
  height: var(--kira-tabbar-h);
  /* `.editor-area` is a column flexbox, so this row is itself a flex item on the vertical axis —
     without `min-height: 0` its default `min-height: auto` lets the tab buttons' own intrinsic
     height push it taller than the `height` above, which is what let individual tabs render past
     this row's bottom edge despite it being tall enough on paper. */
  @apply min-h-0 overflow-hidden shrink-0;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-chrome);
}

.main-view {
  @apply flex-1 min-h-0;
}
</style>
