<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { useLocalStorage } from '@vueuse/core';
import { computed } from 'vue';
import { useAutomationsModule } from '../module';
import { useScriptRuns } from './runsQueries';

// Status-bar count of live Automations runs; hidden at zero. A click opens the Runs section.
const ctx = useAutomationsModule();
const { data } = useScriptRuns();
const runsOpen = useLocalStorage('kira.automations.runsOpen', true);
const running = computed(() => (data.value ?? []).filter((r) => r.state === 'running').length);

function show(): void {
  runsOpen.value = true;
  ctx.showAutomations();
}
</script>

<template>
  <button
    v-if="running > 0"
    type="button"
    class="h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-sm cursor-pointer border-0 bg-none hover:bg-hover"
    data-testid="status-runs"
    @click="show"
  >
    <CodiconIcon name="play" :size="13" />
    {{ running }} running
  </button>
</template>
