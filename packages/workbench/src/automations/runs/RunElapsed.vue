<script setup lang="ts">
import type { ScriptRun } from '@shared/domain/scriptRuns';
import { useIntervalFn } from '@vueuse/core';
import { computed, ref, watchEffect } from 'vue';
import { formatElapsed, runElapsedMs } from './runText';

// A run's elapsed time; ticks each second only while the run is live.
const props = defineProps<{ run: ScriptRun }>();
const now = ref(Date.now());
const { pause } = useIntervalFn(() => {
  now.value = Date.now();
}, 1000);
watchEffect(() => {
  if (props.run.state !== 'running') pause();
});
const label = computed(() => {
  const ms = runElapsedMs(props.run, now.value);
  return ms === null ? '' : formatElapsed(ms);
});
</script>

<template>
  <span class="font-data" data-testid="run-elapsed">{{ label }}</span>
</template>
