<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    orientation: 'col' | 'row';
    size: number;
    min: number;
    max: number;
    reverse?: boolean;
  }>(),
  { reverse: false },
);

const emit = defineEmits<{ resize: [size: number] }>();

let startPos = 0;
let startSize = 0;
let dragging = false;

function onPointerDown(e: PointerEvent): void {
  dragging = true;
  startPos = props.orientation === 'col' ? e.clientX : e.clientY;
  startSize = props.size;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging) return;
  const pos = props.orientation === 'col' ? e.clientX : e.clientY;
  const delta = pos - startPos;
  const signedDelta = props.reverse ? -delta : delta;
  const next = Math.min(props.max, Math.max(props.min, startSize + signedDelta));
  emit('resize', next);
}

function onPointerUp(e: PointerEvent): void {
  dragging = false;
  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
}
</script>

<template>
  <div
    class="splitter"
    :class="orientation === 'col' ? 'cursor-col-resize' : 'cursor-row-resize'"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
  />
</template>

<style scoped>
.splitter {
  background: transparent;
}

.splitter:hover,
.splitter:active {
  background: var(--kira-focus);
}
</style>
