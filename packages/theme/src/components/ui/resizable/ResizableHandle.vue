<script setup lang="ts">
import { resizeHandleVariants } from '@theme/components/ui/resizable';
import { useDragReleaseFallback } from '@theme/components/ui/resizable/useDragReleaseFallback';
import { cn } from '@theme/lib/utils';
import { reactiveOmit } from '@vueuse/core';
import type { SplitterResizeHandleEmits, SplitterResizeHandleProps } from 'reka-ui';
import { SplitterResizeHandle, useForwardPropsEmits } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { computed, ref, shallowRef, watch } from 'vue';

// Fetched from shadcn-vue.com/r/styles/reka-nova/resizable.json (P99 4.2's direct-curl procedure),
// restyled to `resizeHandleVariants` (P263 §2.9): one look for every pane handle. `line` (default
// true) is the 1px divider between flat panes inside one view; framed panes pass `:line="false"`.
const props = withDefaults(defineProps<SplitterResizeHandleProps & { class?: HTMLAttributes['class']; line?: boolean }>(), {
  line: true,
  hitAreaMargins: () => ({ fine: 4, coarse: 8 }),
});
const emits = defineEmits<SplitterResizeHandleEmits>();

// reka re-registers the handle whenever `hitAreaMargins` changes identity, and a re-registration
// mid-drag orphans the active handle so the drag never ends. A literal margins object in a parent
// template is rebuilt per render, so rebuild it here only when its numbers change.
const margins = shallowRef(props.hitAreaMargins);
watch(
  () => `${props.hitAreaMargins?.coarse}/${props.hitAreaMargins?.fine}`,
  () => {
    margins.value = props.hitAreaMargins;
  },
);

const delegatedProps = reactiveOmit(props, 'class', 'hitAreaMargins', 'line');
const forwardedBase = useForwardPropsEmits(delegatedProps, emits);
const forwarded = computed(() => ({ ...forwardedBase.value, hitAreaMargins: margins.value }));

// reka 2.10.5 ends a drag only on a `window` `mouseup`; replay it when that release never arrives.
const dragging = ref(false);
useDragReleaseFallback(dragging, 'mouseup');
</script>

<template>
  <SplitterResizeHandle
    data-slot="resizable-handle"
    v-bind="forwarded"
    @dragging="dragging = $event"
    :class="cn(resizeHandleVariants({ axis: 'auto', line, hit: 'none' }), props.class)"
  />
</template>
