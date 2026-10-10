<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { useWindowFocus } from '@vueuse/core';
import { queryClient } from '@workbench/state/queryClient';
import { windowKey } from '@workbench/util/window';
import { storeToRefs } from 'pinia';
import { computed, watch } from 'vue';
import { useAutomationsModule } from '../module';
import { useScriptRuns } from '../runs/runsQueries';
import { useScheduleConfirmStore } from './confirmDialog';
import ScheduleConfirmDialog from './ScheduleConfirmDialog.vue';

// Shows the schedule confirm popup: a request this window opened, or the oldest waiting run when
// this is the main window. Routing to other windows is not done: no window shows it then.
const ctx = useAutomationsModule();
const store = useScheduleConfirmStore();
const { request, dismissed } = storeToRefs(store);
const { data } = useScriptRuns();

const waiting = computed(() =>
  (data.value ?? [])
    .filter((r) => r.state === 'waiting')
    .sort((a, b) => a.createdAt - b.createdAt),
);
const open = computed(() => waiting.value.filter((r) => !dismissed.value.includes(r.id)));

const main = useQuery(
  {
    queryKey: ['scriptRuns', 'mainWindow'],
    queryFn: () => ctx.runs.mainWindow(),
    staleTime: Number.POSITIVE_INFINITY,
  },
  queryClient,
);
const focused = useWindowFocus();
watch([() => waiting.value.length, focused], ([, f]) => {
  if (f) void main.refetch();
});
const isMain = computed(() => main.data.value === windowKey);

const current = computed(() => {
  if (request.value) return request.value;
  const head = open.value[0];
  return isMain.value && head ? { scriptId: head.scriptId, runId: head.id } : null;
});
const more = computed(() => (request.value ? 0 : Math.max(0, open.value.length - 1)));
</script>

<template>
  <ScheduleConfirmDialog
    v-if="current"
    :key="`${current.runId ?? 'now'}:${current.scriptId}`"
    :script-id="current.scriptId"
    :run-id="current.runId"
    :more="more"
    @close="store.close(current.runId)"
  />
</template>
