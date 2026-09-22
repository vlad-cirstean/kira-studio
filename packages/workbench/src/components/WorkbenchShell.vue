<script setup lang="ts">
import PanelSplitter from '@theme/primitives/PanelSplitter.vue';
import { computed, useSlots } from 'vue';
import MainView from './MainView.vue';
import TabStrip from './TabStrip.vue';

// P103 Part 2 (§5.4): Kira Studio's own workbench/WorkbenchShell.vue and Kira Space's, unified —
// the grid, the splitters and the `--kira-*` custom-property style binding. `#panel` and
// `#tab-strip` have no sensible shared default (each app's left panel and TabStrip's own
// `#new-tab` content are genuinely per-app — the latter is why this shell renders <TabStrip/>
// itself but still exposes a slot around it, rather than hardcoding it with no way for an app to
// reach its `#new-tab` slot); `#main` defaults to a bare `<MainView/>` (an app overrides it only to
// supply MainView's own `#empty` fallback); `#status` has no default; `#dock` is optional.
//
// Risk §11 (WorkbenchShell hazard): `#dock` present vs. absent is a **structural** grid choice, not
// a zero-height row — Kira Space's own grid has two rows (main/status) today, not four rows with
// two driven to 0px, and must render byte-identical. `hasDock` below reads whether the *slot
// itself* was passed (Kira Studio always passes `#dock`, gating its own visibility inside with
// `opsVisible`; Kira Space never passes it at all) — a compile-time-stable fact per app, not a
// runtime toggle — and switches the `.has-dock` class that selects between the two static
// `grid-template-areas`/`grid-template-rows` blocks below, so Kira Space's rendered grid has no
// splitops/ops rows in its DOM at all, matching today exactly.
interface Props {
  projectVisible: boolean;
  projectWidth: number;
  opsVisible?: boolean;
  opsHeight?: number;
}
const props = defineProps<Props>();
const emit = defineEmits<{
  'resize-project': [size: number];
  'resize-ops': [size: number];
}>();

const slots = useSlots();
const hasDock = computed(() => !!slots.dock);

const gridStyle = computed(() => {
  const style: Record<string, string> = {
    '--project-w': props.projectVisible ? `${props.projectWidth}px` : '0px',
    '--project-split-w': props.projectVisible ? 'var(--kira-gap)' : '0px',
  };
  if (hasDock.value) {
    style['--ops-h'] = props.opsVisible ? `${props.opsHeight ?? 0}px` : '0px';
    style['--ops-split-h'] = props.opsVisible ? 'var(--kira-gap)' : '0px';
  }
  return style;
});
</script>

<template>
  <div class="workbench-shell" :class="{ 'has-dock': hasDock }" :style="gridStyle">
    <div
      v-if="projectVisible"
      class="panel-surface"
      style="grid-area: project"
      data-testid="project-panel"
    >
      <slot name="panel" />
    </div>
    <PanelSplitter
      v-if="projectVisible"
      style="grid-area: splitproj"
      orientation="col"
      :size="projectWidth"
      :min="180"
      :max="480"
      @resize="emit('resize-project', $event)"
    />

    <div class="editor-area" style="grid-area: main">
      <div class="tab-strip-slot" data-testid="tab-strip">
        <slot name="tab-strip"><TabStrip /></slot>
      </div>
      <div class="main-view" data-testid="main-view">
        <slot name="main"><MainView /></slot>
      </div>
    </div>

    <template v-if="hasDock">
      <PanelSplitter
        v-if="opsVisible"
        style="grid-area: splitops"
        orientation="row"
        reverse
        :size="opsHeight ?? 0"
        :min="100"
        :max="500"
        @resize="emit('resize-ops', $event)"
      />
      <div
        v-if="opsVisible"
        class="panel-surface"
        style="grid-area: ops"
        data-testid="operations-panel"
      >
        <slot name="dock" />
      </div>
    </template>

    <div style="grid-area: status" data-testid="status-bar">
      <slot name="status" />
    </div>
  </div>
</template>

<style scoped>
.workbench-shell {
  /* P1 C8: a flex child of App.vue's own .app-frame (TitleBar + WorkbenchShell). Grid-template-*
     stays hand CSS — the columns/rows are driven by :style-bound custom properties (gridStyle
     above), which Tailwind's utility scale has no way to express. */
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  display: grid;
  grid-template-areas:
    'project splitproj main'
    'status status status';
  grid-template-columns: var(--project-w) var(--project-split-w) 1fr;
  grid-template-rows: 1fr var(--kira-statusbar-h);
  gap: var(--kira-gap);
  /* Right/left inset from the window edge (P31 D8) is its own token, deliberately not --kira-gap —
     that token also sizes the splitter track. Bottom stays --kira-gap: the status bar reads as
     seated on the window edge. */
  padding: 0 var(--kira-window-inset) var(--kira-gap);
  background: var(--kira-bg-chrome);
}

/* Risk §11: a structural row-set change, not a zero-height row — see the script comment above. */
.workbench-shell.has-dock {
  grid-template-areas:
    'project splitproj main'
    'splitops splitops splitops'
    'ops ops ops'
    'status status status';
  grid-template-rows: 1fr var(--ops-split-h) var(--ops-h) var(--kira-statusbar-h);
}

.panel-surface {
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg);
}

.editor-area {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg);
}

.tab-strip-slot {
  /* Taller than a tab (--kira-h-md, 26px) by design — the extra height is the tab's own breathing
     room from this row's border-bottom, not a margin tacked on after it. */
  height: var(--kira-tabbar-h);
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
