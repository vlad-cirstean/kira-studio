<script setup lang="ts">
import { storeToRefs } from 'pinia';
import RunScriptDialog from './RunScriptDialog.vue';
import { useScriptRunDialogStore } from './runDialog';

const store = useScriptRunDialogStore();
const { request } = storeToRefs(store);
</script>

<template>
  <RunScriptDialog
    v-if="request"
    :key="`${request.scriptId}:${request.taskId ?? ''}:${request.branchId ?? ''}`"
    :script-id="request.scriptId"
    :prefill="request.prefill"
    :task-id="request.taskId"
    :branch-id="request.branchId"
    :from="request.from"
    @close="store.close()"
  />
</template>
