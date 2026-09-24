<script setup lang="ts">
// P104 §3.3: PanelSplitter (hand-rolled pointer-drag maths + a CSS-grid column/row template) →
// reka's own SplitterGroup/SplitterPanel/SplitterResizeHandle. Panel order stands in for the old
// `reverse` prop: reka resizes whichever side of a handle the drag moves toward, so putting the ops
// panel *after* its handle in the vertical group needs no sign-flipped delta the way the hand-rolled
// version did.
//
// Nesting orientation is load-bearing, not a style choice: OUTER horizontal (project | main), with
// a vertical group nested *inside* main's own panel for editor-area/ops, is the one topology proven
// stable (a full interaction.spec.ts/leaks.spec.ts pass, real grid interaction after opening ops).
// The reverse nesting — outer vertical (top row | ops), horizontal nested inside the top row's own
// panel — reproduces a real, non-deterministic reka defect: even with every one of this file's own
// watchers/resize() calls disabled (ablation-tested), a plain tree-row click after opening ops would
// intermittently hang the whole render process (tree.spec.ts caught it; it passed clean on a short
// timeout and hung on a long one against the *identical* steps — a genuine race, not a timing
// artifact of the test itself). Root cause not fully isolated beyond "this nesting direction,
// reliably"; the fix is to never use it, not to chase the exact reka internals further.
//
// The old CSS grid still put "project" and "main" in the *same* row, with "splitops"/"ops" spanning
// full width below (Risk §11) — so project's height must shrink together with main's when ops
// opens, which the STABLE topology above doesn't give for free (project is a sibling of the
// *whole* main-plus-ops column, not of main alone). Reproduced here with a plain CSS margin instead
// of a second nested group: opsMarginPx below tracks the exact px height ops's own row-gap and
// panel currently occupy, applied as project-panel's own margin-bottom. A stretched flex item's
// content box shrinks by its own margin (default `align-items: stretch`), so this reaches the same
// visual result as sharing a grid row, with no additional SplitterGroup nesting at all.
//
// The ops panel itself still avoids reka's own `sizeUnit="px"`: it makes reka's SplitterGroup
// re-run its own pixel-layout recompute (recalculateLayoutForPixelPanels) on every ResizeObserver
// notification of the *group's own container*, and with a virtualized SlickGrid living in the
// sibling editor-area panel, that recompute and the grid's own resize handling feed each other —
// found empirically (a 15s A/B against the exact same tree with only this one prop removed) hanging
// the whole tab on the very first grid interaction after opening the Operations panel, every time.
// The project panel keeps `sizeUnit="px"` — it's the outer, rarely-resized group here again, the
// exact shape already proven safe.
import { ResizableHandle } from '@theme/components/ui/resizable';
import { useElementSize } from '@vueuse/core';
import { SplitterGroup, SplitterPanel } from 'reka-ui';
import { computed, useSlots, useTemplateRef, watch } from 'vue';
import MainView from './MainView.vue';
import TabStrip from './TabStrip.vue';

// Risk §11 (WorkbenchShell hazard, carried over): `#dock` present vs. absent is a **structural**
// choice — Kira Studio always passes `#dock` (gating its own visibility inside with `opsVisible`),
// Kira Space never passes it at all — so Kira Space's tree never mounts an ops SplitterGroup/panel
// at all, matching today.
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

// SplitterPanel's `defaultSize` only seeds the *initial* render — an external width change
// (mode-switch's own first-activation widen, C11 §14 OQ2) needs the panel's own imperative
// `resize()` to follow it, the same way the old CSS-custom-property binding did for free.
const projectPanelRef = useTemplateRef<InstanceType<typeof SplitterPanel>>('projectPanel');
const opsPanelRef = useTemplateRef<InstanceType<typeof SplitterPanel>>('opsPanel');
const vGroupRef = useTemplateRef<HTMLElement>('vGroup');
const { height: vGroupHeight } = useElementSize(vGroupRef);

// Both sides of this are "controlled": a drag emits resize-project/resize-ops, the parent
// persists it and the same value comes back down as projectWidth/opsHeight — the round trip
// through SplitterPanel's own %-to-px conversion (and, for ops, the manual px<->percent one below)
// doesn't land on the exact same float, so an unguarded watcher calling resize() on every prop
// change ping-pongs forever (resize → emit → prop update → resize → emit → …), hanging the tab.
// Only a genuinely *external* width/height change (nothing this component itself just emitted)
// should drive the panel.
let lastEmittedProjectWidth: number | undefined;
let lastEmittedOpsHeight: number | undefined;

watch(
  () => props.projectWidth,
  (width) => {
    if (Math.abs(width - (lastEmittedProjectWidth ?? Number.NaN)) < 1) return;
    projectPanelRef.value?.resize(width);
  },
);

// opsHeight (px) <-> the ops SplitterPanel's own percentage, against the vertical group's live
// height (see the file-level comment for why this panel isn't sizeUnit="px" like the project one).
const opsHeightPercent = computed(() => {
  const h = vGroupHeight.value;
  if (!h || props.opsHeight === undefined) return 25; // pre-measurement seed; corrected below once real.
  return Math.min(100, Math.max(0, (props.opsHeight / h) * 100));
});
const opsMinPercent = computed(() => (vGroupHeight.value ? Math.min(100, (100 / vGroupHeight.value) * 100) : 15));
const opsMaxPercent = computed(() => (vGroupHeight.value ? Math.min(100, (500 / vGroupHeight.value) * 100) : 70));

watch([() => props.opsHeight, vGroupHeight], ([height, h]) => {
  if (height === undefined || !h) return;
  if (Math.abs(height - (lastEmittedOpsHeight ?? Number.NaN)) < 1) return;
  opsPanelRef.value?.resize((height / h) * 100);
});

// The plain-CSS half of the "project shares main's row" coupling (see file-level comment) — the
// exact px height ops's own resize handle + panel currently occupy, as project-panel's own
// margin-bottom. Reka's own layout numbers are never read back for this: opsHeight is already the
// external, px contract this component receives, so no measurement is needed.
const opsMarginPx = computed(() => {
  if (!hasDock.value || !props.opsVisible) return 0;
  return (props.opsHeight ?? 0) + 2; // +2: the SplitterResizeHandle's own gap-0.5 track (--kira-gap).
});

function onProjectResize(size: number): void {
  lastEmittedProjectWidth = size;
  emit('resize-project', size);
}
function onOpsResize(percent: number): void {
  const h = vGroupHeight.value;
  if (!h) return;
  const px = Math.round((percent / 100) * h);
  lastEmittedOpsHeight = px;
  emit('resize-ops', px);
}
</script>

<template>
  <!-- flex-1 (was dropped converting the old grid's `flex: 1` to Tailwind classes, collapsing the
       whole shell to content height) and gap-0.5 (the old grid's row-gap: var(--kira-gap), between
       the content row and the status bar) both reproduce byte-identical geometry to the pre-P104
       CSS grid — found via a tree.spec.ts virtualization-boundary regression the grid version never
       had; SplitterGroup's own default alignment otherwise leaves this 2px unaccounted for. -->
  <div class="workbench-shell flex flex-1 flex-col min-h-0 gap-0.5 px-1.5 pb-0.5 bg-chrome">
    <SplitterGroup direction="horizontal" class="flex-1 min-h-0 gap-0.5">
      <SplitterPanel
        v-if="projectVisible"
        ref="projectPanel"
        class="panel-surface"
        data-testid="project-panel"
        size-unit="px"
        :default-size="projectWidth"
        :min-size="180"
        :max-size="480"
        :order="1"
        :style="{ marginBottom: opsMarginPx ? `${opsMarginPx}px` : undefined }"
        @resize="onProjectResize"
      >
        <slot name="panel" />
      </SplitterPanel>
      <!-- P110 B32: ResizableHandle's own shared defaults add the P16 divider look (a static
           shadow line, cleared on hover/drag) that this handle never had -- overridden back to
           2px/no-shadow here to keep today's exact appearance; everything else (bg-transparent,
           hover:/drag:bg-focus, cursor) already matches the shared default byte-for-byte. -->
      <ResizableHandle
        v-if="projectVisible"
        class="data-[orientation=horizontal]:w-0.5 data-[orientation=horizontal]:shadow-none"
        :hit-area-margins="{ coarse: 8, fine: 4 }"
      />

      <SplitterPanel class="min-w-0" :order="2">
        <template v-if="hasDock">
          <SplitterGroup ref="vGroup" direction="vertical" class="h-full gap-0.5">
            <SplitterPanel class="editor-area" :order="1">
              <div class="tab-strip-slot" data-testid="tab-strip">
                <slot name="tab-strip"><TabStrip /></slot>
              </div>
              <div class="main-view" data-testid="main-view">
                <slot name="main"><MainView /></slot>
              </div>
            </SplitterPanel>
            <!-- Same override as the project handle above (its own comment), mirrored for the
                 vertical orientation. -->
            <ResizableHandle
              v-if="opsVisible"
              class="data-[orientation=vertical]:h-0.5 data-[orientation=vertical]:shadow-none"
              :hit-area-margins="{ coarse: 8, fine: 4 }"
            />
            <SplitterPanel
              v-if="opsVisible"
              ref="opsPanel"
              class="panel-surface"
              data-testid="operations-panel"
              :default-size="opsHeightPercent"
              :min-size="opsMinPercent"
              :max-size="opsMaxPercent"
              :order="2"
              @resize="onOpsResize"
            >
              <slot name="dock" />
            </SplitterPanel>
          </SplitterGroup>
        </template>
        <div v-else class="editor-area h-full">
          <div class="tab-strip-slot" data-testid="tab-strip">
            <slot name="tab-strip"><TabStrip /></slot>
          </div>
          <div class="main-view" data-testid="main-view">
            <slot name="main"><MainView /></slot>
          </div>
        </div>
      </SplitterPanel>
    </SplitterGroup>

    <!-- The old grid template stays four rows (main/splitops/ops/status) whether or not ops is
         open when hasDock (Risk §11's own "structural, not a zero-height row" point) — even a
         collapsed splitops/ops row still consumes its own row-gap. mt-1 (4px = two more
         --kira-gap) reproduces that reserved space exactly; gap-0.5 above already accounts for
         one. Kira Space (no #dock slot) never adds it, matching its own two-row grid exactly. -->
    <div class="shrink-0 h-statusbar" :class="{ 'mt-1': hasDock }" data-testid="status-bar">
      <slot name="status" />
    </div>
  </div>
</template>

<style scoped>
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

.h-statusbar {
  height: var(--kira-statusbar-h);
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
