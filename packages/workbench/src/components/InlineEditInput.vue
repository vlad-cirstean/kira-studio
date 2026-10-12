<script setup lang="ts">
import { useTemplateRef } from 'vue';
import { useFocusOnMount } from '../behaviour/focus';
import { useInlineEdit } from '../behaviour/inlineEdit';

// The inline row-name field (API collection tree, Automations panel): Enter and blur commit, Esc
// cancels, a blank or unchanged name is a cancel (the row would become unclickable). The parent
// swaps the field out on `commit`/`cancel`.
const props = withDefaults(defineProps<{ name: string; selectOnFocus?: boolean }>(), {
  selectOnFocus: true,
});
const emit = defineEmits<{ commit: [name: string]; cancel: [] }>();

const input = useTemplateRef<HTMLInputElement>('input');
useFocusOnMount(input, { select: props.selectOnFocus });

const edit = useInlineEdit({
  source: () => props.name,
  commit: (text) => emit('commit', text),
  cancel: () => emit('cancel'),
  once: true,
});
</script>

<template>
  <input
    ref="input"
    :value="edit.text.value"
    class="min-w-0 flex-1 rounded-kira-sm border px-0.5 py-0 text-fg bg-field outline-none border-primary"
    :aria-invalid="edit.error.value ? true : undefined"
    :title="edit.error.value || undefined"
    @input="edit.onInput(($event.target as HTMLInputElement).value)"
    @click.stop
    @dblclick.stop
    @keydown="edit.onKeydown"
    @blur="edit.onCommit"
  >
</template>
