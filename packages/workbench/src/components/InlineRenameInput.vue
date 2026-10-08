<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';

// Inline naming field shared by the API collection tree and the quick-command panel: Enter and blur
// commit, Esc cancels, an empty or unchanged name is a cancel (the row would become unclickable).
const props = defineProps<{ name: string }>();
const emit = defineEmits<{ commit: [name: string]; cancel: [] }>();

const draft = ref(props.name);
const inputRef = ref<HTMLInputElement | null>(null);
let settled = false;

onMounted(() => {
  void nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  });
});

function commit(): void {
  if (settled) return;
  settled = true;
  const name = draft.value.trim();
  if (!name || name === props.name) {
    emit('cancel');
    return;
  }
  emit('commit', name);
}

function cancel(): void {
  if (settled) return;
  settled = true;
  emit('cancel');
}
</script>

<template>
  <input
    ref="inputRef"
    v-model="draft"
    class="min-w-0 flex-1 rounded-kira-sm border px-0.5 py-0 text-fg bg-field outline-none border-primary"
    @click.stop
    @dblclick.stop
    @keydown.enter.prevent="commit"
    @keydown.esc.prevent="cancel"
    @blur="commit"
  />
</template>
