<script setup lang="ts">
import type { RoutedPrompt } from '@shared/domain/prompts';
import { computed } from 'vue';
import { useScriptRuns } from '../runs/runsQueries';
import ScheduleConfirmDialog from './ScheduleConfirmDialog.vue';

// The routed `schedule` popup: the waiting run is the entry's ref. Escape or close hides it here;
// the run stays waiting and the notification or Review and run brings it back.
const props = defineProps<{ entry: RoutedPrompt; more: number }>();
const emit = defineEmits<{ hide: [] }>();
const { data } = useScriptRuns();
const run = computed(() => data.value?.find((r) => r.id === props.entry.ref) ?? null);
</script>

<template>
  <ScheduleConfirmDialog
    v-if="run"
    :script-id="run.scriptId"
    :run-id="run.id"
    :more="more"
    @close="emit('hide')"
  />
</template>
