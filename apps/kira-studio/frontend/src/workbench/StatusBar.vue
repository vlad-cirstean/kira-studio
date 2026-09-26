<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import AppMetricsItem from '@workbench/components/AppMetricsItem.vue';
import StatusBarBase from '@workbench/components/StatusBar.vue';
import UpdateAvailableItem from '@workbench/components/UpdateAvailableItem.vue';
import { formatBytes } from '@workbench/util/format';
import { computed } from 'vue';
import { useAgentSessionsStore } from '../state/agentSessions';
import { useAppMetricsStore } from '../state/appMetrics';
import { useAppUpdateStore } from '../state/appUpdate';
import { useCacheStatsStore } from '../state/cacheStats';
import { useEngineStore } from './state/engine';

// P103 Part 2 (§5.4): Kira Studio's own StatusBar.vue, now a thin composition over the shared bar
// chrome (packages/workbench/src/components/StatusBar.vue) — this file keeps exactly the per-app
// right-side items: update/agent-sessions/app-metrics/cache-size/engine-status. P116 H7: the
// app-metrics item's own markup moved to AppMetricsItem.vue, shared with Kira Space's own copy.
// P119: the update item's own markup moved to UpdateAvailableItem.vue the same way — its click now
// opens the in-app dialog (appUpdateStore.openUpdateDialog) instead of the release page (§4.6).
const engineStore = useEngineStore();
const agentSessionsStore = useAgentSessionsStore();
const appMetricsStore = useAppMetricsStore();
const appUpdateStore = useAppUpdateStore();
const cacheStatsStore = useCacheStatsStore();

const cacheTitle = computed(() => {
  const stats = cacheStatsStore.stats;
  if (!stats) return undefined;
  const total = stats.l2Hits + stats.l2Misses;
  const hitRate = total === 0 ? 0 : Math.round((stats.l2Hits / total) * 100);
  return `L2 ${stats.l2Entries} pages, ${hitRate}% hit rate, ${stats.l3Entries} cached counts`;
});

const cacheSizeLabel = computed(() => {
  const stats = cacheStatsStore.stats;
  return stats ? formatBytes(stats.l2Bytes) : null;
});

// P86 §14.1: an app-wide fact like app-metrics/cache-size beside it, not a caret fact — absent
// (not a zero reading) rather than shown as "0".
function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

const agentCount = computed(() => agentSessionsStore.sessions.length);

// §13's own activity text: 'waiting for you' (attention, plus the bounded message when present),
// 'running <toolName>' (working with a tool), 'working' (working with none), 'idle', or null when
// this window knows no activity for that session.
function activityText(terminalId: string): string | null {
  const activity = agentSessionsStore.agentActivityFor(terminalId);
  if (!activity) return null;
  if (activity.phase === 'attention') {
    return activity.message ? `waiting for you: ${activity.message}` : 'waiting for you';
  }
  if (activity.phase === 'working') {
    return activity.toolName ? `running ${activity.toolName}` : 'working';
  }
  return 'idle';
}

const agentTooltip = computed(() =>
  agentSessionsStore.sessions
    .map((s) => {
      const text = activityText(s.terminalId);
      return text ? `${basename(s.cwd)} — ${text}` : basename(s.cwd);
    })
    .join('\n'),
);
</script>

<template>
  <StatusBarBase>
    <template #right>
      <UpdateAvailableItem
        v-if="appUpdateStore.available"
        :latest-version="appUpdateStore.latestVersion"
        :current-version="appUpdateStore.currentVersion"
        @open="appUpdateStore.openUpdateDialog()"
      />
      <Tooltip v-if="agentCount > 0">
        <TooltipTrigger as-child>
          <span class="h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-sm cursor-pointer border-0 bg-none hover:bg-hover" data-testid="agent-sessions">
            <CodiconIcon name="sparkle" :size="13" />
            {{ agentCount }}
          </span>
        </TooltipTrigger>
        <TooltipContent class="whitespace-pre-wrap">{{ agentTooltip }}</TooltipContent>
      </Tooltip>
      <AppMetricsItem :sample="appMetricsStore.sample" />
      <Tooltip v-if="cacheSizeLabel">
        <TooltipTrigger as-child>
          <span class="h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-sm cursor-pointer border-0 bg-none hover:bg-hover" data-testid="cache-size">
            <CodiconIcon name="database" :size="13" />
            {{ cacheSizeLabel }}
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ cacheTitle }}</TooltipContent>
      </Tooltip>
      <Tooltip :disabled="engineStore.lastPingMs === null">
        <TooltipTrigger as-child>
          <span class="h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-sm cursor-pointer border-0 bg-none hover:bg-hover" data-testid="engine-status" :data-status="engineStore.status">
            <CodiconIcon
              name="circle-large-filled"
              :size="13"
              :class="engineStore.status === 'ok' ? 'text-ok' : 'text-error'"
            />
            engine {{ engineStore.status }}
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ engineStore.lastPingMs }} ms</TooltipContent>
      </Tooltip>
    </template>
  </StatusBarBase>
</template>
