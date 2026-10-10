<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { computed } from 'vue';
import { formatPercent, formatSize, publishedPorts, stateDotClass } from '../lib/format';
import { useContainerAction, useContainers } from '../queries';
import { useDockerStatsStore } from '../state/dockerStats';
import { useDockerUiStore } from '../state/dockerUi';
import type { DockerContainer } from '../wire';
import ListState from './ListState.vue';
import UsageBar from './UsageBar.vue';

const ui = useDockerUiStore();
const stats = useDockerStatsStore();
const containers = useContainers();
const actions = useContainerAction();

const rows = computed(() =>
  [...(containers.data.value ?? [])].sort((a, b) => {
    const ra = a.state === 'running' ? 0 : 1;
    const rb = b.state === 'running' ? 0 : 1;
    return ra - rb || a.name.localeCompare(b.name);
  }),
);

const COLUMNS =
  'grid-cols-[0.5rem_minmax(0,1fr)_6rem_7rem_5.5rem] @4xl:grid-cols-[0.5rem_minmax(8rem,1.2fr)_minmax(8rem,1.4fr)_minmax(5rem,0.8fr)_7rem_8rem_5.5rem]';

function act(c: DockerContainer, action: 'start' | 'stop' | 'restart'): void {
  void actions.run(c.id, action).catch(() => undefined);
}

function open(c: DockerContainer, tab: 'overview' | 'logs' | 'terminal' = 'overview'): void {
  ui.select({ kind: 'container', id: c.id }, tab);
}
</script>

<template>
  <ListState
    v-if="containers.isPending.value || containers.isError.value || rows.length === 0"
    :loading="containers.isPending.value"
    :error="containers.isError.value"
    icon="server"
    empty-title="No containers yet"
    empty-hint="Start one with docker run or docker compose up."
    @retry="containers.refetch()"
  />
  <div v-else class="@container" role="listbox" data-testid="docker-table">
    <div
      class="grid items-center gap-x-3 border-b border-border px-3 py-1 text-kira-sm uppercase tracking-wider text-muted-foreground"
      :class="COLUMNS"
    >
      <span />
      <span>Name</span>
      <span class="hidden @4xl:block">Image</span>
      <span class="hidden @4xl:block">Ports</span>
      <span class="text-right">CPU</span>
      <span class="text-right">Memory</span>
      <span />
    </div>
    <div
      v-for="c in rows"
      :key="c.id"
      class="group/row grid cursor-default select-none items-center gap-x-3 border-b border-border/60 px-3 py-1.5 outline-none last:border-b-0 hover:bg-hover focus-visible:outline focus-visible:-outline-offset-1 focus-visible:outline-focus"
      :class="COLUMNS"
      data-testid="docker-table-row"
      :data-name="c.name"
      :data-state="c.state"
      role="option"
      :aria-selected="false"
      tabindex="0"
      @click="open(c)"
      @keydown.enter="open(c)"
      @dblclick="open(c, 'logs')"
    >
      <span class="size-1.5 rounded-full" :class="stateDotClass(c.state)" />
      <span class="flex min-w-0 flex-col">
        <span class="flex min-w-0 items-baseline gap-1.5">
          <span class="truncate" :class="c.state === 'running' ? 'font-medium' : 'text-muted-foreground'">{{ c.name }}</span>
          <span v-if="c.composeProject" class="shrink-0 text-kira-sm text-muted-foreground">{{ c.composeProject }}</span>
        </span>
        <span class="truncate text-kira-sm text-muted-foreground @4xl:hidden">{{ c.image }}</span>
      </span>
      <span class="hidden truncate text-muted-foreground @4xl:block">{{ c.image }}</span>
      <span class="hidden truncate font-data text-kira-sm text-muted-foreground @4xl:block">{{ publishedPorts(c.ports).join(' ') || '-' }}</span>
      <template v-if="c.state === 'running' && stats.latest.get(c.id)">
        <span class="flex flex-col items-end gap-0.5">
          <span class="font-data text-kira-sm">{{ formatPercent(stats.latest.get(c.id)!.cpuPercent) }}</span>
          <UsageBar :percent="stats.latest.get(c.id)!.cpuPercent" />
        </span>
        <span class="flex flex-col items-end gap-0.5">
          <span class="font-data text-kira-sm">{{ formatSize(stats.latest.get(c.id)!.memUsage) }}</span>
          <UsageBar :percent="stats.latest.get(c.id)!.memPercent" />
        </span>
      </template>
      <template v-else>
        <span class="text-right text-muted-foreground">{{ c.state === 'running' ? '…' : '-' }}</span>
        <span class="text-right text-muted-foreground">{{ c.state === 'running' ? '…' : '-' }}</span>
      </template>
      <span class="flex items-center justify-end">
        <CodiconIcon v-if="actions.isBusy(c.id)" name="loading" :size="12" class="codicon-modifier-spin" />
        <span v-else class="invisible flex group-hover/row:visible group-focus-within/row:visible">
          <TooltipIconButton icon="output" label="Logs" @click.stop="open(c, 'logs')" />
          <TooltipIconButton v-if="c.state === 'running'" icon="debug-stop" label="Stop" class="text-error hover:text-error" data-testid="docker-table-stop" @click.stop="act(c, 'stop')" />
          <TooltipIconButton v-else icon="play" label="Start" class="text-ok hover:text-ok" data-testid="docker-table-start" @click.stop="act(c, 'start')" />
        </span>
      </span>
    </div>
  </div>
</template>
