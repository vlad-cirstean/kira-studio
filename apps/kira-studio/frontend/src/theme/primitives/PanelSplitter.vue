<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    orientation: 'col' | 'row';
    size: number;
    min: number;
    max: number;
    reverse?: boolean;
    /** P22 D13: draw a visible hairline down the middle of the track at rest. Off by default:
     *  WorkbenchShell's two splitters sit in a grid GAP between `.panel-surface` boxes, so the
     *  boundary is already a groove on the shell's own ground and a second line there would read
     *  as a double rule. On by default nowhere — a splitter inside a view has no gap band behind
     *  it (both request views' own `.request-splitter` comments already said exactly this about
     *  height), so it is the caller who knows which situation it is in. */
    divider?: boolean;
  }>(),
  { reverse: false, divider: false },
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
    :class="[
      orientation === 'col' ? 'cursor-col-resize' : 'cursor-row-resize',
      { 'has-divider': divider },
    ]"
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

/* P22 D13: the line is drawn as a centred inset box-shadow, not a border — a border would change
   the track's own box size and shift the panes it separates, and the track is a pointer target
   whose 4px height/width is load-bearing for grabbing it. --kira-border (not --kira-border-strong)
   is the weight every other in-view boundary uses (.p-toolbar, .p-view-head, .cell-dock). */
.splitter.has-divider.cursor-row-resize {
  box-shadow: inset 0 calc(var(--kira-border-width) * -1) 0 0 var(--kira-border);
}
.splitter.has-divider.cursor-col-resize {
  box-shadow: inset calc(var(--kira-border-width) * -1) 0 0 0 var(--kira-border);
}
.splitter.has-divider:hover,
.splitter.has-divider:active {
  box-shadow: none; /* the --kira-focus fill above takes over whole */
}
</style>
