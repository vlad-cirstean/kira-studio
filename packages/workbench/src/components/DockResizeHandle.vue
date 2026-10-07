<script setup lang="ts">
import { useDragReleaseFallback } from '@theme/components/ui/resizable/useDragReleaseFallback';
import { useDraggable } from '@vueuse/core';
import { useTemplateRef, watch } from 'vue';

// P132 Part 1 (§0.1/§2.4): the dock sits outside every reka SplitterGroup (WorkbenchShell.vue's
// own file-level comment has why), so its resize handle can't be shadcn's ResizableHandle — a reka
// SplitterResizeHandle, only legal inside a SplitterGroup. VueUse's useDraggable owns the pointer
// wiring (pointerdown/move/up, capture, preventDefault) below; only its onStart/onMove callbacks
// are used — never its own x/y/style, which track the *element's* drag offset, not this handle's
// px-height contract.
interface Props {
  height: number;
  min: number;
  max: number;
}
const props = defineProps<Props>();
const emit = defineEmits<{
  resize: [px: number];
  dragging: [value: boolean];
}>();

function clamp(px: number): number {
  return Math.min(props.max, Math.max(props.min, px));
}

let startY = 0;
let startHeight = 0;

const handleRef = useTemplateRef<HTMLElement>('handle');
const { isDragging } = useDraggable(handleRef, {
  axis: 'y',
  preventDefault: true,
  onStart: (_position, event) => {
    startY = event.clientY;
    startHeight = props.height;
  },
  onMove: (_position, event) => {
    emit('resize', clamp(startHeight + (startY - event.clientY)));
  },
});

useDragReleaseFallback(isDragging, 'pointerup');
watch(isDragging, (dragging) => emit('dragging', dragging));

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    emit('resize', clamp(props.height + 10));
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    emit('resize', clamp(props.height - 10));
  } else if (e.key === 'Home') {
    e.preventDefault();
    emit('resize', props.min);
  } else if (e.key === 'End') {
    e.preventDefault();
    emit('resize', props.max);
  }
}
</script>

<template>
  <!-- biome-ignore lint/a11y/useSemanticElements: ARIA separator widget — <hr> can't carry aria-valuenow/tabindex/keydown (KuiColumnResizeHandle.vue's own precedent) -->
  <div
    ref="handle"
    class="relative shrink-0 h-0.5 bg-transparent hover:bg-focus data-[state=drag]:bg-focus cursor-row-resize before:absolute before:inset-x-0 before:-inset-y-1 pointer-coarse:before:-inset-y-2"
    :data-state="isDragging ? 'drag' : undefined"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize operations panel"
    :aria-valuenow="height"
    :aria-valuemin="min"
    :aria-valuemax="max"
    tabindex="0"
    @keydown="onKeydown"
  />
</template>
