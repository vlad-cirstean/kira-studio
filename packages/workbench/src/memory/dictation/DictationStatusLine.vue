<script setup lang="ts">
import { computed } from 'vue';
import { useDictationStore } from './store';

// P216: the screen-reader and sighted status line under a dictated input.
const props = defineProps<{ targetId: string }>();
const store = useDictationStore();

const text = computed(() => {
  if (store.target !== props.targetId) return '';
  switch (store.phase) {
    case 'starting':
      return 'Starting microphone';
    case 'listening':
      return 'Listening';
    case 'finishing':
      return 'Finishing';
    case 'error':
      return store.error;
    default:
      return '';
  }
});
</script>

<template>
  <p
    role="status"
    class="m-0 text-kira-sm"
    :class="[
      text === '' ? 'h-0 overflow-hidden' : 'min-h-4',
      store.phase === 'error' && store.target === targetId ? 'text-error' : 'text-muted-foreground',
    ]"
    :data-testid="`dictation-status-${targetId}`"
  >{{ text }}</p>
</template>
