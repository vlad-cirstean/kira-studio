<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { tabChipVariants } from '@theme/components/ui/tabs';
import { copyText } from '@workbench/util/clipboard';
import { computed, watch } from 'vue';
import { shortId } from '../lib/format';
import { useContainerAction, useContainerDetail } from '../queries';
import { type DockerDetailTab, useDockerUiStore } from '../state/dockerUi';
import ContainerOverview from './ContainerOverview.vue';
import ExecView from './ExecView.vue';
import InspectView from './InspectView.vue';
import LogsView from './LogsView.vue';
import StatsView from './StatsView.vue';

const props = defineProps<{ containerId: string }>();

const ui = useDockerUiStore();
const id = computed(() => props.containerId);
const detail = useContainerDetail(id);
const actions = useContainerAction();

const c = computed(() => detail.data.value?.container);
const running = computed(() => c.value?.state === 'running');
const busy = computed(() => actions.isBusy(props.containerId));

const TABS: ReadonlyArray<{ id: DockerDetailTab; label: string; needsRunning: boolean }> = [
  { id: 'overview', label: 'Overview', needsRunning: false },
  { id: 'logs', label: 'Logs', needsRunning: false },
  { id: 'terminal', label: 'Terminal', needsRunning: true },
  { id: 'stats', label: 'Stats', needsRunning: true },
  { id: 'inspect', label: 'Inspect', needsRunning: false },
];

const stateVariant = computed(() => {
  switch (c.value?.state) {
    case 'running':
      return 'ok';
    case 'paused':
    case 'restarting':
      return 'warn';
    case 'dead':
      return 'err';
    default:
      return 'default';
  }
});

// A stopped container cannot serve its own Terminal/Stats tabs: fall back to Overview.
watch([running, c], () => {
  if (c.value && !running.value && (ui.detailTab === 'terminal' || ui.detailTab === 'stats')) {
    ui.detailTab = 'overview';
  }
});

function ports(): string[] {
  return (c.value?.ports ?? [])
    .filter((p) => p.publicPort > 0)
    .map((p) => `${p.publicPort}:${p.privatePort}/${p.type}`);
}

function act(action: 'start' | 'stop' | 'restart'): void {
  void actions.run(props.containerId, action).catch(() => undefined);
}
</script>

<template>
  <div class="flex h-full flex-col" data-testid="docker-container-detail">
    <p v-if="detail.isError.value" class="p-3 text-error" data-testid="docker-detail-error">Container not found.</p>
    <div v-else-if="!detail.data.value" class="p-3 text-muted-foreground">Loading…</div>
    <template v-else-if="c">
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span class="text-kira-lg font-semibold" data-testid="docker-detail-name">{{ c.name }}</span>
        <Badge :variant="stateVariant" data-testid="docker-detail-state">{{ c.state }}</Badge>
        <span class="text-muted-foreground">{{ c.image }}</span>
        <span class="inline-flex items-center gap-0.5 font-data text-muted-foreground" data-testid="docker-detail-id">
          {{ shortId(c.id) }}
          <TooltipIconButton icon="copy" label="Copy ID" @click="copyText(c.id)" />
        </span>
        <span v-for="p in ports()" :key="p" class="font-data text-kira-sm text-muted-foreground" data-testid="docker-detail-port">{{ p }}</span>
        <span class="ml-auto flex items-center gap-1">
          <Button size="kira" variant="secondary" :disabled="busy || running" data-testid="docker-action-start" @click="act('start')">
            <CodiconIcon name="play" :size="12" />Start
          </Button>
          <Button size="kira" variant="secondary" :disabled="busy || !running" data-testid="docker-action-stop" @click="act('stop')">
            <CodiconIcon name="debug-stop" :size="12" />Stop
          </Button>
          <Button size="kira" variant="secondary" :disabled="busy || !running" data-testid="docker-action-restart" @click="act('restart')">
            <CodiconIcon name="debug-restart" :size="12" />Restart
          </Button>
        </span>
      </div>
      <p v-if="actions.error.value" class="shrink-0 border-b border-border px-3 py-1 text-error" data-testid="docker-action-error">
        {{ (actions.error.value as Error).message }}
      </p>
      <div class="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5 py-1">
        <button
          v-for="t in TABS"
          :key="t.id"
          type="button"
          :class="[tabChipVariants({ active: ui.detailTab === t.id }), t.needsRunning && !running ? 'opacity-50 cursor-default' : '']"
          :disabled="t.needsRunning && !running"
          :aria-pressed="ui.detailTab === t.id"
          :data-testid="`docker-tab-${t.id}`"
          @click="ui.detailTab = t.id"
        >
          {{ t.label }}
        </button>
      </div>
      <div class="min-h-0 flex-1">
        <ContainerOverview v-if="ui.detailTab === 'overview'" :detail="detail.data.value" />
        <LogsView v-else-if="ui.detailTab === 'logs'" :container-id="containerId" />
        <ExecView v-else-if="ui.detailTab === 'terminal' && running" :container-id="containerId" />
        <StatsView v-else-if="ui.detailTab === 'stats' && running" :container-id="containerId" />
        <InspectView v-else-if="ui.detailTab === 'inspect'" :raw="detail.data.value.raw" />
      </div>
    </template>
  </div>
</template>
