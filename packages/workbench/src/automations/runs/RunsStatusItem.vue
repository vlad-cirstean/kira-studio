<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import { usePersistedState } from '@workbench/behaviour/persisted';
import { computed } from 'vue';
import { useAutomationsModule } from '../module';
import { useScriptRuns } from './runsQueries';

// Status-bar count of live Automations runs; hidden at zero. A click opens the Runs section.
const ctx = useAutomationsModule();
const { data } = useScriptRuns();
const runsOpen = usePersistedState('kira.automations.runsOpen', true);
const running = computed(() => (data.value ?? []).filter((r) => r.state === 'running').length);

function show(): void {
  runsOpen.value = true;
  ctx.showAutomations();
}
</script>

<template>
  <Button
    v-if="running > 0"
    variant="toolbar"
    size="kira"
    class="h-control-sm gap-1 px-1.5 text-fg text-kira-sm font-normal"
    data-testid="status-runs"
    @click="show"
  >
    <CodiconIcon name="play" :size="13" />
    {{ t('automations.runs.running.label', { count: running }) }}
  </Button>
</template>
