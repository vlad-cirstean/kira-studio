<script setup lang="ts">
import { resizeHandleVariants } from '@theme/components/ui/resizable';
import type {
  ResizeAxis,
  ResizeDirection,
  ResizeUnit,
} from '@theme/components/ui/resizable/paneResizeMath';
import { usePaneResize } from '@theme/components/ui/resizable/usePaneResize';
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';
import { useTemplateRef, watch } from 'vue';

// The one pane and column resize handle: ARIA separator, pointer drag and keyboard. The caller owns
// the layout (the resized pane takes `flex: 0 0 <size>`) and the persistence (`commit`).
const props = withDefaults(
  defineProps<{
    /** Accessible name, e.g. "Resize author column". */
    label?: string;
    size: number;
    min: number;
    /** Unset: no upper bound. */
    max?: number;
    axis?: ResizeAxis;
    unit?: ResizeUnit;
    /** Element whose length is 100%; required for `unit: 'percent'`. */
    container?: HTMLElement | null;
    direction?: ResizeDirection;
    step?: number;
    /** The 1px divider between flat panes inside one view; framed panes pass `false`. */
    line?: boolean;
    class?: HTMLAttributes['class'];
  }>(),
  { axis: 'x', unit: 'px', direction: 'normal', line: false },
);

const emit = defineEmits<{
  /** Every pointer move and keyboard step: render this size. */
  live: [size: number];
  /** Pointer release, keyboard step, Home or End: persist this size. */
  commit: [size: number];
  /** Drag aborted: drop the live preview. */
  cancel: [];
  /** A drag starts or ends (the shell shows the resize cursor everywhere meanwhile). */
  dragging: [value: boolean];
}>();

const handle = useTemplateRef<HTMLElement>('handle');
const { handleProps, dragging } = usePaneResize({
  target: handle,
  size: () => props.size,
  min: () => props.min,
  max: () => props.max,
  axis: props.axis,
  unit: props.unit,
  container: () => props.container,
  direction: props.direction,
  step: props.step,
  onLive: (size) => emit('live', size),
  onCommit: (size) => emit('commit', size),
  onCancel: () => emit('cancel'),
});
watch(dragging, (value) => emit('dragging', value));
</script>

<template>
  <div
    ref="handle"
    v-bind="handleProps"
    data-slot="resizable-handle"
    :aria-label="label"
    :class="cn(resizeHandleVariants({ axis, line }), props.class)"
  />
</template>
