<script setup lang="ts">
import type { ScriptRun } from '@shared/domain/scriptRuns';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { useLocalStorage } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useAutomationsModule } from '../module';
import SmartBadge from '../smart/SmartBadge.vue';
import RunElapsed from './RunElapsed.vue';
import RunOutcomeBlock from './RunOutcomeBlock.vue';
import RunStatusBadge from './RunStatusBadge.vue';
import { useScriptRuns, useStopScriptRun } from './runsQueries';

const emit = defineEmits<{ rerun: [run: ScriptRun] }>();
const ctx = useAutomationsModule();

type Filter = 'all' | 'running' | 'failed';
const open = useLocalStorage('kira.automations.runsOpen', true);
const filter = ref<Filter>('all');
const expanded = ref<string | null>(null);
const { data } = useScriptRuns();
const stop = useStopScriptRun();

const rows = computed(() => {
  const all = data.value ?? [];
  if (filter.value === 'running') return all.filter((r) => r.state === 'running');
  if (filter.value === 'failed') return all.filter((r) => r.state === 'failed' || r.state === 'blocked');
  return all;
});

function toggle(run: ScriptRun): void {
  if (run.kind === 'smart') {
    ctx.openRunTab(run.id, run.scriptName);
    return;
  }
  expanded.value = expanded.value === run.id ? null : run.id;
}
</script>

<template>
  <section class="flex min-h-0 shrink-0 flex-col border-t border-border" data-testid="runs-section">
    <button
      type="button"
      class="flex h-bar shrink-0 items-center gap-1 border-0 bg-transparent px-1.5 text-left text-kira-sm font-semibold uppercase tracking-wider text-muted-foreground"
      :aria-expanded="open"
      data-testid="runs-toggle"
      @click="open = !open"
    >
      <CodiconIcon :name="open ? 'chevron-down' : 'chevron-right'" :size="12" />
      Runs
      <span class="ml-auto font-normal">{{ data?.length ?? 0 }}</span>
    </button>
    <div v-if="open" class="flex max-h-72 min-h-0 flex-col overflow-y-auto">
      <ToggleGroup
        type="single"
        size="kira"
        class="px-1.5 py-1"
        :model-value="filter"
        @update:model-value="(v) => v && (filter = v as Filter)"
      >
        <ToggleGroupItem value="all" data-testid="runs-filter-all">All</ToggleGroupItem>
        <ToggleGroupItem value="running" data-testid="runs-filter-running">Running</ToggleGroupItem>
        <ToggleGroupItem value="failed" data-testid="runs-filter-failed">Failed</ToggleGroupItem>
      </ToggleGroup>
      <span v-if="rows.length === 0" class="px-1.5 py-2 text-kira-sm text-muted-foreground" data-testid="runs-empty">
        No runs.
      </span>
      <div v-for="run in rows" :key="run.id" class="flex flex-col" data-testid="run-row" :data-state="run.state">
        <div class="flex items-center gap-1 px-1.5 py-1 hover:bg-hover">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1 border-0 bg-transparent p-0 text-left text-inherit"
            :aria-expanded="expanded === run.id"
            @click="toggle(run)"
          >
            <RunStatusBadge :state="run.state" />
            <SmartBadge v-if="run.kind === 'smart'" />
            <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {{ run.scriptName }}
              <span v-if="run.trigger === 'ade'" class="text-muted-foreground" data-testid="run-trigger">
                · ADE · {{ run.taskTitle }}
              </span>
            </span>
            <RunElapsed :run="run" class="text-kira-sm text-muted-foreground" />
          </button>
          <Button
            v-if="run.state === 'running'"
            variant="dialog"
            size="kira-lg"
            data-testid="run-stop"
            @click="stop.mutate(run.id)"
          >
            Stop
          </Button>
        </div>
        <div v-if="expanded === run.id" class="px-1.5 pb-1.5">
          <RunOutcomeBlock :run="run" @rerun="emit('rerun', run)" />
        </div>
      </div>
    </div>
  </section>
</template>
