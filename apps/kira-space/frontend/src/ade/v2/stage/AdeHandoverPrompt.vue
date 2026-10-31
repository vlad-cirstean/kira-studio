<script setup lang="ts">
import type { RoutedPrompt } from '@shared/domain/prompts';
import { onBeforeUnmount, onMounted } from 'vue';
import { useAdeStageDialogStore } from '../state/adeStageDialog';
import AdeStageDialog from './AdeStageDialog.vue';

// The routed `handover` popup: a session finished its stage and offers the move. `entry.ref` is the
// task id. Not now keeps the draft and withdraws the popup; Escape and Cancel only hide it here.
const props = defineProps<{ entry: RoutedPrompt; more: number }>();
const emit = defineEmits<{ hide: [] }>();
const store = useAdeStageDialogStore();

onMounted(() => store.open({ taskId: props.entry.ref, routed: true }));
onBeforeUnmount(() => {
  if (store.routed && store.taskId === props.entry.ref) store.close();
});

async function notNow(): Promise<void> {
  await store.dismiss();
  emit('hide');
}
</script>

<template>
  <AdeStageDialog routed @close="emit('hide')" @not-now="notNow" />
</template>
