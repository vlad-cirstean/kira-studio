<script setup lang="ts">
import { useAutomationsModule } from '@workbench/automations/module';
import RunElapsed from '@workbench/automations/runs/RunElapsed.vue';
import { useScriptRuns, useSeenRuns } from '@workbench/automations/runs/runsQueries';
import SmartBadge from '@workbench/automations/smart/SmartBadge.vue';
import { computed } from 'vue';
import { useTabsStore } from '../../../state/tabs';
import AdeChip from '../AdeChip.vue';
import AdeTip from '../AdeTip.vue';
import { chipRun, runReason } from './automationRuns';

const props = defineProps<{ taskId: string }>();
const ctx = useAutomationsModule();
const tabs = useTabsStore();
const { data } = useScriptRuns();
const { seen, markSeen } = useSeenRuns();
const run = computed(() => chipRun(data.value ?? [], props.taskId, seen.value));

const tone = computed(() => {
  const state = run.value?.state;
  if (state === 'failed') return 'red';
  return state === 'blocked' ? 'amber' : 'blue';
});
const word = computed(() => {
  const state = run.value?.state;
  if (state === 'failed') return 'failed';
  return state === 'blocked' ? 'needs you' : '';
});
const tip = computed(() => (run.value ? runReason(run.value) || run.value.scriptName : ''));

function open(): void {
  const r = run.value;
  if (!r) return;
  markSeen(r.id);
  ctx.showAutomations();
  if (r.kind === 'smart') ctx.openRunTab(r.id, r.scriptName);
  else if (r.terminalId) tabs.activateTab(r.terminalId);
}
</script>

<template>
  <AdeTip v-if="run" :text="tip">
    <button
      type="button"
      class="inline-flex shrink-0 items-center gap-1 border-0 bg-transparent p-0 text-inherit"
      data-testid="ade-automation-chip"
      :data-state="run.state"
      @click.stop="open"
    >
      <SmartBadge v-if="run.kind === 'smart'" />
      <AdeChip :label="word ? `${run.scriptName} · ${word}` : run.scriptName" :tone="tone" class="max-w-40 truncate" />
      <RunElapsed v-if="run.state === 'running'" :run="run" class="text-kira-sm text-muted-foreground" />
    </button>
  </AdeTip>
</template>
