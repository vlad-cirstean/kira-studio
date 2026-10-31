<script setup lang="ts">
import type { RoutedPrompt } from '@shared/domain/prompts';
import { onBeforeUnmount, onMounted } from 'vue';
import { useAdeBranchRequestStore } from '../state/adeBranchRequest';
import AdeBranchRequestDialog from './AdeBranchRequestDialog.vue';

// The routed `branch-request` popup: an agent waits on the user. `entry.ref` is the request id. Escape
// only hides it; the agent keeps waiting until the user answers or the request times out.
const props = defineProps<{ entry: RoutedPrompt; more: number }>();
const emit = defineEmits<{ hide: [] }>();
const store = useAdeBranchRequestStore();

onMounted(() => store.open({ id: props.entry.ref, routed: true }));
onBeforeUnmount(() => {
  if (store.routed && store.id === props.entry.ref) store.close();
});
</script>

<template>
  <AdeBranchRequestDialog routed @hide="emit('hide')" />
</template>
