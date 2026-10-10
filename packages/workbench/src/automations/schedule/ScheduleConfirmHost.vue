<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useScheduleConfirmStore } from './confirmDialog';
import ScheduleConfirmDialog from './ScheduleConfirmDialog.vue';

// Shows the Run now confirm this window opened. Waiting scheduled runs arrive through PromptHost.
const store = useScheduleConfirmStore();
const { request } = storeToRefs(store);
</script>

<template>
  <ScheduleConfirmDialog
    v-if="request"
    :key="request.scriptId"
    :script-id="request.scriptId"
    :run-id="null"
    :more="0"
    @close="store.close()"
  />
</template>
