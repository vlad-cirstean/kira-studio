<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { useAutomationsModule } from '@workbench/automations/module';
import RunElapsed from '@workbench/automations/runs/RunElapsed.vue';
import RunOutcomeBlock from '@workbench/automations/runs/RunOutcomeBlock.vue';
import RunStatusBadge from '@workbench/automations/runs/RunStatusBadge.vue';
import { useSeenRuns, useStopScriptRun, useTaskScriptRuns } from '@workbench/automations/runs/runsQueries';
import SmartBadge from '@workbench/automations/smart/SmartBadge.vue';
import { computed, ref } from 'vue';

const props = defineProps<{ taskId: string }>();
const ctx = useAutomationsModule();
const { data } = useTaskScriptRuns(() => props.taskId);
const stop = useStopScriptRun();
const { markSeen } = useSeenRuns();
const expanded = ref<string | null>(null);
const rows = computed(() => data.value ?? []);

function toggle(id: string): void {
  markSeen(id);
  expanded.value = expanded.value === id ? null : id;
}
</script>

<template>
  <section v-if="rows.length > 0" class="flex max-h-48 flex-col gap-1 overflow-y-auto" data-testid="ade-automations">
    <h4 class="m-0 text-kira-sm font-semibold uppercase tracking-wider text-muted-foreground">Automations</h4>
    <div v-for="run in rows" :key="run.id" class="flex flex-col" data-testid="ade-automation-row" :data-state="run.state">
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1.5 border-0 bg-transparent p-0 text-left text-inherit"
          :aria-expanded="expanded === run.id"
          @click="toggle(run.id)"
        >
          <RunStatusBadge :state="run.state" />
          <SmartBadge v-if="run.kind === 'smart'" />
          <span class="min-w-0 truncate">{{ run.scriptName }}</span>
          <span v-if="run.branchLabel" class="shrink-0 font-data text-kira-sm text-muted-foreground">{{ run.branchLabel }}</span>
          <RunElapsed :run="run" class="ml-auto shrink-0 text-kira-sm text-muted-foreground" />
        </button>
        <Button
          v-if="run.kind === 'smart'"
          variant="dialog"
          size="kira-lg"
          data-testid="ade-automation-open"
          @click="ctx.showAutomations(); ctx.openRunTab(run.id, run.scriptName)"
        >
          Open
        </Button>
        <Button v-if="run.state === 'running'" variant="dialog" size="kira-lg" data-testid="ade-automation-stop" @click="stop.mutate(run.id)">
          Stop
        </Button>
      </div>
      <div v-if="expanded === run.id" class="pt-1">
        <RunOutcomeBlock :run="run" />
      </div>
    </div>
  </section>
</template>
