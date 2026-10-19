<script setup lang="ts">
import { useTemplateRef } from 'vue';
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

const el = useTemplateRef<HTMLElement>('el');
useSortableReorder(
  el,
  () => props.ids,
  (from, to) => emit('move', from, to),
  {
    draggable: props.draggable,
    handle: props.handle,
    keyboardHandle: props.keyboardHandle,
    disabled: () => props.disabled === true || props.ids.length < 2,
    keyboard: true,
  },
);
</script>

<template>
  <div ref="el"><slot /></div>
</template>
