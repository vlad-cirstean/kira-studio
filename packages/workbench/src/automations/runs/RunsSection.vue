<script setup lang="ts">
import type { ScriptRun } from '@shared/domain/scriptRuns';
import InlineState from '@theme/components/InlineState.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import SectionHeading from '@theme/components/SectionHeading.vue';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { rowVariants } from '@theme/lib/rowVariants';
import { cn } from '@theme/lib/utils';
import { usePersistedState } from '@workbench/behaviour/persisted';
import PanelBar from '@workbench/components/PanelBar.vue';
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
const open = usePersistedState('kira.automations.runsOpen', true);
const filter = ref<Filter>('all');
const FILTER_ITEMS = computed(() => [
  { value: 'all', label: t('common.state.all.option'), testid: 'runs-filter-all' },
  { value: 'running', label: t('common.state.running.status'), testid: 'runs-filter-running' },
  { value: 'failed', label: t('common.state.failed.status'), testid: 'runs-filter-failed' },
]);
const expanded = ref<string | null>(null);
const { data } = useScriptRuns();
const stop = useStopScriptRun();

const rows = computed(() => {
  const all = data.value ?? [];
  if (filter.value === 'running') return all.filter((r) => r.state === 'running');
  if (filter.value === 'failed')
    return all.filter((r) => r.state === 'failed' || r.state === 'blocked');
  return all;
});

function toggle(run: ScriptRun): void {
  // A run without a terminal (smart or headless) lives in its own tab; a skipped one only has a reason.
  if (run.state !== 'skipped' && (run.kind === 'smart' || run.terminalId === '')) {
    ctx.openRunTab(run.id, run.scriptName);
    return;
  }
  expanded.value = expanded.value === run.id ? null : run.id;
}
</script>

<template>
  <section class="flex min-h-0 shrink-0 flex-col border-t border-border" data-testid="runs-section">
    <SectionHeading
      :label="t('automations.runs.title.label')"
      collapsible
      :expanded="open"
      :count="data?.length ?? 0"
      data-testid="runs-toggle"
      @toggle="open = !open"
    />
    <div v-if="open" class="flex max-h-[50vh] min-h-0 flex-col overflow-y-auto">
      <PanelBar>
        <SecondaryTabs
          variant="segmented"
          :model-value="filter"
          :items="FILTER_ITEMS"
          @update:model-value="(v) => (filter = v as Filter)"
        />
      </PanelBar>
      <InlineState v-if="rows.length === 0" kind="empty" data-testid="runs-empty">
        {{ t('automations.runs.none.emptyHint') }}
      </InlineState>
      <div
        v-for="run in rows"
        :key="run.id"
        class="flex flex-col"
        data-testid="run-row"
        :data-state="run.state"
      >
        <div :class="cn(rowVariants({ layout: 'tree' }), 'py-1 pl-1.5')">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1 border-0 bg-transparent p-0 text-left text-inherit"
            :aria-expanded="expanded === run.id"
            @click="toggle(run)"
          >
            <RunStatusBadge :state="run.state" />
            <SmartBadge v-if="run.kind === 'smart'" />
            <span class="min-w-0 flex-1 truncate">
              {{ run.scriptName }}
              <span
                v-if="run.trigger === 'ade'"
                class="text-muted-foreground"
                data-testid="run-trigger"
              >
                · {{ t('automations.run.triggerAde.label', { task: run.taskTitle }) }}
              </span>
              <span
                v-else-if="run.trigger === 'scheduled'"
                class="text-muted-foreground"
                data-testid="run-trigger"
              >
                · {{ t('automations.run.triggerScheduled.label') }}
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
            {{ t('common.action.stop.label') }}
          </Button>
        </div>
        <div v-if="expanded === run.id" class="px-1.5 pb-1.5">
          <RunOutcomeBlock :run="run" @rerun="emit('rerun', run)" />
        </div>
      </div>
    </div>
  </section>
</template>
