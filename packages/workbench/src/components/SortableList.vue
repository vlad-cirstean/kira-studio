<script setup lang="ts">
import { shallowRef, useTemplateRef, watch } from 'vue';
import { useSortableReorder } from '../behaviour/sortableReorder';

// One Sortable per group needs one component per group: a composable cannot run inside a v-for.
const props = defineProps<{
  ids: readonly string[];
  draggable: string;
  handle?: string;
  keyboardHandle?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ move: [fromId: string, toId: string] }>();

// A parent that rebuilds `ids` on every render would reset Sortable's list mid-drag: only a changed
// content replaces the array handed down.
const stableIds = shallowRef<readonly string[]>(props.ids);
watch(
  () => props.ids,
  (next) => {
    const cur = stableIds.value;
    if (next.length !== cur.length || next.some((id, i) => id !== cur[i])) stableIds.value = next;
  },
);

const el = useTemplateRef<HTMLElement>('el');
useSortableReorder(
  el,
  () => stableIds.value,
  (from, to) => emit('move', from, to),
  {
    draggable: props.draggable,
    handle: props.handle,
    keyboardHandle: props.keyboardHandle,
    disabled: () => props.disabled === true || stableIds.value.length < 2,
    keyboard: true,
  },
);
</script>

<template>
  <div ref="el"><slot /></div>
</template>
