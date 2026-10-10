<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { tabChipVariants } from '@theme/components/ui/tabs';
import { copyText } from '@workbench/util/clipboard';
import { computed, ref, watch } from 'vue';
import { useDocker } from '../context';
import { formatPercent, formatSize, publishedPorts, shortId, stateDotClass } from '../lib/format';
import { useContainerAction, useContainerDetail } from '../queries';
import { useDockerEditStore } from '../state/dockerEdit';
import { useDockerStatsStore } from '../state/dockerStats';
import { type DockerDetailTab, useDockerUiStore } from '../state/dockerUi';
import ContainerEditView from './ContainerEditView.vue';
import ContainerOverview from './ContainerOverview.vue';
import ExecView from './ExecView.vue';
import InspectView from './InspectView.vue';
import LogsView from './LogsView.vue';
import StatsView from './StatsView.vue';
import UsageBar from './UsageBar.vue';

const props = defineProps<{ containerId: string }>();

const ui = useDockerUiStore();
const docker = useDocker();
const linkError = ref<string | null>(null);
const stats = useDockerStatsStore();
const edits = useDockerEditStore();
const id = computed(() => props.containerId);
const detail = useContainerDetail(id);
const actions = useContainerAction();

const c = computed(() => detail.data.value?.container);
const registryUrl = computed(() => detail.data.value?.registryUrl ?? '');
const running = computed(() => c.value?.state === 'running');
const live = computed(() => (running.value ? stats.latest.get(props.containerId) : undefined));
const recreating = computed(() => edits.applying[props.containerId] === 'recreate');
const busy = computed(() => actions.isBusy(props.containerId) || edits.applying[props.containerId] !== undefined);

const TABS: ReadonlyArray<{ id: DockerDetailTab; label: string; icon: string; needsRunning: boolean }> = [
  { id: 'overview', label: 'Overview', icon: 'info', needsRunning: false },
  { id: 'logs', label: 'Logs', icon: 'output', needsRunning: false },
  { id: 'terminal', label: 'Terminal', icon: 'terminal', needsRunning: true },
  { id: 'stats', label: 'Stats', icon: 'graph', needsRunning: true },
  { id: 'inspect', label: 'Inspect', icon: 'json', needsRunning: false },
  { id: 'edit', label: 'Edit', icon: 'edit', needsRunning: false },
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

function openRegistry(url: string): void {
  linkError.value = null;
  docker.openExternal(url).catch((e: unknown) => {
    linkError.value = e instanceof Error ? e.message : String(e);
  });
}

function act(action: 'start' | 'stop' | 'restart'): void {
  void actions.run(props.containerId, action).catch(() => undefined);
}
</script>

<template>
  <div class="flex h-full flex-col" data-testid="docker-container-detail">
    <div v-if="recreating" class="flex items-center gap-2 p-4 text-muted-foreground" data-testid="docker-detail-recreating">
      <CodiconIcon name="loading" :size="14" class="codicon-modifier-spin" />Recreating…
    </div>
    <Empty v-else-if="detail.isError.value" class="p-4" data-testid="docker-detail-error">
      <EmptyHeader>
        <EmptyMedia variant="icon"><CodiconIcon name="warning" :size="16" class="text-warn" /></EmptyMedia>
        <EmptyTitle>Container not found</EmptyTitle>
        <EmptyDescription>It was removed, or the engine changed.</EmptyDescription>
      </EmptyHeader>
      <Button size="kira" variant="secondary" @click="ui.select(null)">Back to overview</Button>
    </Empty>
    <div v-else-if="!detail.data.value" class="flex flex-col gap-2 p-3" aria-busy="true">
      <div class="h-6 w-1/3 animate-pulse rounded-kira-sm bg-field" />
      <div class="h-4 w-2/3 animate-pulse rounded-kira-sm bg-field" />
    </div>
    <template v-else-if="c">
      <div class="flex shrink-0 flex-col gap-1 border-b border-border px-3 py-2">
        <div class="flex min-w-0 items-center gap-2">
          <span class="size-2 shrink-0 rounded-full" :class="stateDotClass(c.state)" />
          <span class="min-w-0 truncate text-kira-lg font-semibold" data-testid="docker-detail-name">{{ c.name }}</span>
          <Badge :variant="stateVariant" data-testid="docker-detail-state">{{ c.state }}</Badge>
          <span class="ml-auto flex shrink-0 items-center gap-1">
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
        <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-kira-sm text-muted-foreground">
          <span class="min-w-0 truncate" data-testid="docker-detail-image">{{ c.image }}</span>
          <TooltipIconButton
            v-if="registryUrl"
            icon="link-external"
            label="Open in registry"
            data-testid="docker-detail-registry"
            @click="openRegistry(registryUrl)"
          />
          <span class="inline-flex items-center gap-0.5 font-data" data-testid="docker-detail-id">
            {{ shortId(c.id) }}
            <TooltipIconButton icon="copy" label="Copy ID" @click="copyText(c.id)" />
          </span>
          <span v-if="c.status">{{ c.status }}</span>
          <span v-for="p in publishedPorts(c.ports)" :key="p" class="font-data" data-testid="docker-detail-port">:{{ p }}</span>
          <span v-if="live" class="ml-auto flex items-center gap-3" data-testid="docker-detail-live">
            <span class="flex w-28 items-center gap-1.5">
              CPU <span class="font-data text-fg">{{ formatPercent(live.cpuPercent) }}</span>
              <UsageBar :percent="live.cpuPercent" class="flex-1" />
            </span>
            <span class="flex w-32 items-center gap-1.5">
              RAM <span class="font-data text-fg">{{ formatSize(live.memUsage) }}</span>
              <UsageBar :percent="live.memPercent" class="flex-1" />
            </span>
          </span>
        </div>
      </div>
      <p v-if="actions.error.value || linkError" class="shrink-0 border-b border-border px-3 py-1 text-error" data-testid="docker-action-error">
        {{ actions.error.value ? (actions.error.value as Error).message : linkError }}
      </p>
      <div class="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-1.5 py-1" role="tablist">
        <button
          v-for="t in TABS"
          :key="t.id"
          type="button"
          :class="[tabChipVariants({ active: ui.detailTab === t.id }), t.needsRunning && !running ? 'cursor-default opacity-50' : '']"
          :disabled="t.needsRunning && !running"
          role="tab"
          :aria-selected="ui.detailTab === t.id"
          :aria-pressed="ui.detailTab === t.id"
          :data-testid="`docker-tab-${t.id}`"
          @click="ui.detailTab = t.id"
        >
          <CodiconIcon :name="t.icon" :size="13" />
          {{ t.label }}
        </button>
      </div>
      <div class="min-h-0 flex-1">
        <ContainerOverview v-if="ui.detailTab === 'overview'" :detail="detail.data.value" />
        <LogsView v-else-if="ui.detailTab === 'logs'" :container-id="containerId" />
        <ExecView v-else-if="ui.detailTab === 'terminal' && running" :container-id="containerId" />
        <StatsView v-else-if="ui.detailTab === 'stats' && running" :container-id="containerId" />
        <InspectView v-else-if="ui.detailTab === 'inspect'" :raw="detail.data.value.raw" />
        <ContainerEditView v-else-if="ui.detailTab === 'edit'" :container-id="containerId" />
      </div>
    </template>
  </div>
</template>
