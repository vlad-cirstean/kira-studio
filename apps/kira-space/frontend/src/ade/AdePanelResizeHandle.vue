<script setup lang="ts">
import { useDebounceFn, useDraggable } from '@vueuse/core';
import { ref } from 'vue';

// P129 Part 6 §0.2: the detail panel's own resize strip (mockup 275, drag handler 1766-1774).
// Hand-rolled on VueUse rather than shadcn/reka `ResizablePanelGroup` — a second nested
// `ResizablePanelGroup` inside `WorkbenchShell`'s own outer one is an unproven topology (P132 Part 1
// §0.1: outer-vertical nesting hung the render process), and reka's own `sizeUnit="px"` re-runs
// layout on every container resize tick, the same feedback shape that hung SlickGrid there.
//
// This component only tracks the gesture (drag, arrow keys) and reports a candidate width — it owns
// no settings write and no clamp source of truth beyond the `min`/`max` it's given; the caller
// (`AdeRepoView.vue`, this module's own layout owner) resolves the effective width and persists it.
const props = defineProps<{
  /** The panel's current effective width (settings-resolved, not the live drag value) — the drag/
   *  arrow-key start point, and the `aria-valuenow` shown between gestures. */
  value: number;
  min: number;
  max: number;
}>();

const emit = defineEmits<{
  /** Fired continuously while dragging, and once per arrow-key press — the caller should render the
   *  panel at this width until a matching `commit` (or drag end with no `commit`, meaning no change). */
  resize: [width: number];
  /** The width to persist — immediately on drag end, debounced on arrow-key repeats (§0.2). */
  commit: [width: number];
}>();

const handleEl = ref<HTMLElement | null>(null);
const dragStartValue = ref(0);

function clamp(w: number): number {
  return Math.max(props.min, Math.min(props.max, w));
}

const commitDebounced = useDebounceFn((w: number) => emit('commit', w), 400);

// `initialValue: {x: 0, y: 0}` makes `useDraggable`'s own `position` the raw pointer delta since
// drag start (it otherwise tracks "initial element position plus delta", meant for a target that
// moves with the cursor — this handle never moves, so a zero initial value turns that into a plain
// dx). Dragging right (dx > 0) narrows the panel, matching the mockup's own `w0 - dx`.
let lastDrag = 0;
useDraggable(handleEl, {
  axis: 'x',
  preventDefault: true,
  initialValue: { x: 0, y: 0 },
  onStart: () => {
    dragStartValue.value = props.value;
  },
  onMove: (position) => {
    lastDrag = clamp(dragStartValue.value - position.x);
    emit('resize', lastDrag);
  },
  onEnd: () => {
    emit('commit', lastDrag);
  },
});

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const next = clamp(props.value + (e.key === 'ArrowLeft' ? 16 : -16));
  emit('resize', next);
  void commitDebounced(next);
}
</script>

<template>
  <!-- biome-ignore lint/a11y/useSemanticElements: ARIA separator widget — <hr> can't carry aria-valuenow/tabindex/keydown -->
  <div
    ref="handleEl"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize panel"
    :aria-valuenow="value"
    :aria-valuemin="min"
    :aria-valuemax="max"
    tabindex="0"
    class="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center border-l border-[#2a2d35] bg-[#16171b]"
    data-testid="ade-panel-resize-handle"
    @keydown="onKeydown"
  >
    <span class="h-7 w-0.5 rounded-[1px] bg-[#3a3e48]" />
  </div>
</template>
