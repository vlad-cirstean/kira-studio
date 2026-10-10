<script setup lang="ts">
import type { CustomScript } from '@shared/domain/scripts';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { computed } from 'vue';
import RunStatusBadge from '../runs/RunStatusBadge.vue';
import { useScriptRuns } from '../runs/runsQueries';
import { useNextFires } from './scheduleQueries';
import { clockText } from './scheduleText';

// A recurring script row's second line: the clock, its next fire (or off), the last scheduled run.
const props = defineProps<{ script: CustomScript }>();
const schedule = computed(() => props.script.schedule);
const next = useNextFires(
  () => schedule.value?.cron ?? '',
  () => schedule.value?.timezone ?? 'UTC',
  1,
  () => schedule.value?.enabled === true,
);
const { data } = useScriptRuns();
const last = computed(
  () =>
    (data.value ?? []).find((r) => r.scriptId === props.script.id && r.trigger === 'scheduled') ??
    null,
);
const text = computed(() => {
  const s = schedule.value;
  if (!s?.enabled) return 'off';
  const at = next.data.value?.[0];
  return at === undefined ? '' : `next ${clockText(at, s.timezone)}`;
});
</script>

<template>
  <span v-if="schedule" class="flex min-w-0 items-center gap-1 text-kira-sm text-muted-foreground" data-testid="script-schedule-line">
    <CodiconIcon name="watch" :size="12" class="shrink-0" />
    <span data-testid="script-next">{{ text }}</span>
    <RunStatusBadge v-if="last" :state="last.state" />
  </span>
</template>
