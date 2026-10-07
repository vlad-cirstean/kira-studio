<script setup lang="ts">
import { Input } from '@theme/components/ui/input';
import { useTimeoutFn } from '@vueuse/core';
import { ref } from 'vue';
import { useAddBacklogItem } from '../queries';

// Enter files the text as a backlog item; the note confirms for two seconds.
const text = ref('');
const note = ref('');
const add = useAddBacklogItem();
const { start: hideNote } = useTimeoutFn(
  () => {
    note.value = '';
  },
  2000,
  { immediate: false },
);

async function onEnter(): Promise<void> {
  const value = text.value.trim();
  if (!value || add.isPending.value) return;
  try {
    await add.mutateAsync({ text: value });
    text.value = '';
    note.value = 'added to backlog';
  } catch (err) {
    note.value = err instanceof Error ? err.message : String(err);
  }
  hideNote();
}
</script>

<template>
  <div class="flex items-center gap-2">
    <label for="ade-capture" class="sr-only">Add to backlog</label>
    <Input
      id="ade-capture"
      v-model="text"
      placeholder="+ Add to backlog… (Enter)"
      size="kira-lg"
      class="w-72"
      data-testid="ade-capture"
      @keydown.enter="onEnter"
    />
    <span v-if="note" class="text-kira-sm text-muted-foreground" data-testid="ade-capture-note">{{ note }}</span>
  </div>
</template>
