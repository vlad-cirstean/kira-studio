<script setup lang="ts">
// P104 §3.3: PanelSplitter (hand-rolled pointer-drag maths + a CSS-grid column/row template) →
// reka's own SplitterGroup/SplitterPanel/SplitterResizeHandle.
//
// P110 I2-39: every direct reka SplitterGroup/SplitterPanel below goes through the shadcn-vue
// ResizablePanelGroup/ResizablePanel wrapper instead — the comments here that describe reka's own
// underlying behaviour still say "SplitterGroup"/"SplitterPanel" on purpose, since that is the real
// component these wrappers forward props/emits to unchanged.
//
// P132 Part 1 (§0.1/§2.4): the Operations dock is a full-width flex sibling below the horizontal
// group, outside every SplitterGroup — not a second, nested vertical group the way it used to be.
// Two hazards, both from source at the P104/P110 shape this replaced: (1) a real, non-deterministic
// reka defect — outer-vertical nesting (top row | ops) intermittently hung the whole render process
// on a tree-row click after opening ops (tree.spec.ts caught it; clean on a short timeout, hung on
// a long one against identical steps — never fully root-caused beyond "this nesting direction,
// reliably"). (2) a `sizeUnit="px"` ops panel makes reka re-run its own pixel-layout recompute on
// every ResizeObserver tick of the group's own container, which fought a virtualized SlickGrid
// living in the sibling editor-area panel and hung the tab on the first grid interaction after
// opening ops (a 15s A/B, only that one prop removed, isolated it). Putting the dock in no
// SplitterGroup at all rules out both, rather than re-proving either is absent. It also deletes the
// margin-hack/percent-bridge machinery the nested shape needed to keep project's height in sync
// with main's (project and main are now siblings in the *same* row, so they already share one).
//
// The project panel keeps `sizeUnit="px"` — it's the one rarely-resized SplitterGroup left, the
// same shape already proven safe.
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@theme/components/ui/resizable';
// I2-39: type-only -- resize() is exposed by reka's SplitterPanel at runtime (ResizablePanel
// forwards it unchanged) but isn't in ResizablePanel's own public prop/emit type, so the typed
// ref below still names SplitterPanel directly. No value import: the template uses the
// ResizablePanel/ResizablePanelGroup wrappers above.
import type { SplitterPanel } from 'reka-ui';
import { computed, ref, useTemplateRef, watch } from 'vue';
import DockResizeHandle from './DockResizeHandle.vue';
import MainView from './MainView.vue';
import TabStrip from './TabStrip.vue';

interface Props {
  projectVisible: boolean;
  projectWidth: number;
  opsVisible: boolean;
  opsHeight: number;
  /** P129 Part 3 §0.13: hides the tab-strip row for a `layout: 'full'` module (Kira Space's own
   *  `ade`, which renders its own view in `#main` instead of tab-scoped `MainView`). Default
   *  `true`: Kira Studio passes nothing, so its own geometry is unchanged. */
  tabStripVisible?: boolean;
}
const props = withDefaults(defineProps<Props>(), { tabStripVisible: true });
const emit = defineEmits<{
  'resize-project': [size: number];
  'resize-ops': [size: number];
}>();

const OPS_MIN_PX = 100;
const OPS_MAX_PX = 500;
const dockHeight = computed(() =>
  Math.min(OPS_MAX_PX, Math.max(OPS_MIN_PX, props.opsHeight)),
);
const dockDragging = ref(false);

// SplitterPanel's `defaultSize` only seeds the *initial* render — an external width change
// (mode-switch's own first-activation widen, C11 §14 OQ2) needs the panel's own imperative
// `resize()` to follow it, the same way the old CSS-custom-property binding did for free.
const projectPanelRef = useTemplateRef<InstanceType<typeof SplitterPanel>>('projectPanel');

// A drag emits resize-project, the parent persists it and the same value comes back down as
// projectWidth — the round trip through SplitterPanel's own %-to-px conversion doesn't land on the
// exact same float, so an unguarded watcher calling resize() on every prop change ping-pongs
// forever (resize → emit → prop update → resize → …), hanging the tab. Only a genuinely *external*
// width change (nothing this component itself just emitted) should drive the panel. The dock has
// no such guard to keep: it emits its own px height directly (no SplitterPanel, no %-to-px round
// trip to ping-pong against).
let lastEmittedProjectWidth: number | undefined;

watch(
  () => props.projectWidth,
  (width) => {
    if (Math.abs(width - (lastEmittedProjectWidth ?? Number.NaN)) < 1) return;
    projectPanelRef.value?.resize(width);
  },
);

function onProjectResize(size: number): void {
  // reka also fires onResize on first layout and on programmatic resize(); neither is a user drag.
  if (Math.abs(size - props.projectWidth) < 1) return;
  lastEmittedProjectWidth = size;
  emit('resize-project', size);
}
function onOpsResize(px: number): void {
  emit('resize-ops', px);
}
</script>

<template>
  <!-- flex-1 (was dropped converting the old grid's `flex: 1` to Tailwind classes, collapsing the
       whole shell to content height) and gap-0.5 (the old grid's row-gap, 2px, between rows) both
       reproduce byte-identical geometry to the pre-P104 CSS grid. The dock's own 6px gaps above and
       below (main-to-dock, dock-to-status) come from this same gap-0.5 plus the handle's own h-0.5
       and the status bar's own mt-1 below — no separate spacing rule for the dock. -->
  <div
    class="workbench-shell flex flex-1 flex-col min-h-0 gap-0.5 px-1.5 pb-0.5 bg-chrome"
    :class="{ 'cursor-row-resize select-none': dockDragging }"
  >
    <ResizablePanelGroup direction="horizontal" class="flex-1 min-h-0 gap-0.5">
      <ResizablePanel
        v-if="projectVisible"
        ref="projectPanel"
        class="overflow-hidden min-w-0 min-h-0 rounded-kira border border-border bg-bg"
        data-testid="project-panel"
        size-unit="px"
        :default-size="projectWidth"
        :min-size="180"
        :max-size="480"
        :order="1"
        @resize="onProjectResize"
      >
        <slot name="panel" />
      </ResizablePanel>
      <!-- P110 B32: ResizableHandle's own shared defaults add the P16 divider look (a static
           shadow line, cleared on hover/drag) that this handle never had -- overridden back to
           2px/no-shadow here to keep today's exact appearance; everything else (bg-transparent,
           hover:/drag:bg-focus, cursor) already matches the shared default byte-for-byte. -->
      <ResizableHandle
        v-if="projectVisible"
        class="data-[orientation=horizontal]:w-0.5 data-[orientation=horizontal]:shadow-none"
        :hit-area-margins="{ coarse: 8, fine: 4 }"
      />

      <!-- Border/rounding stay on the inner div: a border on the panel itself shifts reka's px-to-%
           conversion for the project panel by ~0.4px (visual snapshots caught it). -->
      <ResizablePanel class="min-w-0" data-testid="main-panel" :order="2">
        <div class="h-full flex flex-col min-w-0 min-h-0 overflow-hidden rounded-kira border border-border bg-bg">
          <!-- Taller than a tab (--kira-h-md, 26px) by design (h-tabbar) — the extra height is
               the tab's own breathing room from this row's border-bottom, not a margin tacked
               on after it. -->
          <div v-if="tabStripVisible" class="h-tabbar min-h-0 overflow-hidden shrink-0 border-b border-border bg-chrome" data-testid="tab-strip">
            <slot name="tab-strip"><TabStrip /></slot>
          </div>
          <div class="flex-1 min-h-0" data-testid="main-view">
            <slot name="main"><MainView /></slot>
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>

    <template v-if="opsVisible">
      <DockResizeHandle
        :height="dockHeight"
        :min="OPS_MIN_PX"
        :max="OPS_MAX_PX"
        @resize="onOpsResize"
        @dragging="dockDragging = $event"
      />
      <div
        class="shrink-0 overflow-hidden min-w-0 min-h-0 rounded-kira border border-border bg-bg"
        data-testid="operations-panel"
        :style="{ height: `${dockHeight}px` }"
      >
        <slot name="dock" />
      </div>
    </template>

    <!-- The old grid template stayed four rows (main/splitops/ops/status) whether or not ops was
         open — even a collapsed splitops/ops row consumed its own row-gap. mt-1 (4px, two more
         2px row-gaps) reproduces that reserved space exactly; gap-0.5 above already accounts for
         one. Both apps mount a dock, so it is unconditional. -->
    <div class="shrink-0 h-statusbar mt-1" data-testid="status-bar">
      <slot name="status" />
    </div>
  </div>
</template>
