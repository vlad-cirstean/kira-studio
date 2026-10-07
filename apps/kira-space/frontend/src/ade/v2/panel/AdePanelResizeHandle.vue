<script setup lang="ts">
import { useDragReleaseFallback } from '@theme/components/ui/resizable/useDragReleaseFallback';
import { useDebounceFn, useDraggable } from '@vueuse/core';
import { ref } from 'vue';

// Hand-rolled on VueUse, not reka `ResizablePanelGroup`: a nested group hung the render process
// (P132 Part 1 §0.1), and reka's px sizing re-runs layout on every container resize tick.
// Tracks the gesture only; the caller clamps nothing beyond `min`/`max` and persists the width.
const props = defineProps<{
  /** Effective panel width: the drag and arrow-key start point. */
  value: number;
  min: number;
  max: number;
  /** The panel sits left of the handle: dragging right widens it. */
  invert?: boolean;
}>();

const emit = defineEmits<{
  /** While dragging and per arrow-key press: render the panel at this width. */
  resize: [width: number];
  /** Width to persist: on drag end, debounced on arrow-key repeats. */
  commit: [width: number];
}>();

const handleEl = ref<HTMLElement | null>(null);
const dragStartValue = ref(0);

function sign(): number {
  return props.invert ? 1 : -1;
}

function clamp(w: number): number {
  return Math.max(props.min, Math.min(props.max, w));
}

const commitDebounced = useDebounceFn((w: number) => emit('commit', w), 400);

// `position` is the handle's viewport offset plus the delta, not the delta (VueUse seeds it from
// the pointer-down offset), so the delta comes from the pointer events. Dragging right narrows the
// panel.
let startX = 0;
let lastDrag = 0;
let moved = false;
const { isDragging } = useDraggable(handleEl, {
  axis: 'x',
  preventDefault: true,
  onStart: (_pos, e) => {
    dragStartValue.value = props.value;
    startX = e.clientX;
    moved = false;
  },
  onMove: (_pos, e) => {
    moved = true;
    lastDrag = clamp(dragStartValue.value + sign() * (e.clientX - startX));
    emit('resize', lastDrag);
  },
  onEnd: () => {
    if (moved) emit('commit', lastDrag);
  },
});

useDragReleaseFallback(isDragging, 'pointerup');

function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const next = clamp(props.value + (e.key === 'ArrowLeft' ? -sign() : sign()) * 16);
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
    class="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center border-l border-border bg-chrome"
    data-testid="ade-panel-resize-handle"
    @keydown="onKeydown"
  >
    <span class="h-7 w-0.5 rounded-[1px] bg-border-strong" />
  </div>
</template>
