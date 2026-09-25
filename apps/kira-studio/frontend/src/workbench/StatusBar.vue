<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import StatusBarBase from '@workbench/components/StatusBar.vue';
import { formatBytes } from '@workbench/util/format';
import { computed } from 'vue';
import { control } from '../bridge/control';
import { useAgentSessionsStore } from '../state/agentSessions';
import { useAppMetricsStore } from '../state/appMetrics';
import { useAppUpdateStore } from '../state/appUpdate';
import { useCacheStatsStore } from '../state/cacheStats';
import { useEngineStore } from './state/engine';

// P103 Part 2 (§5.4): Kira Studio's own StatusBar.vue, now a thin composition over the shared bar
// chrome (packages/workbench/src/components/StatusBar.vue) — this file keeps exactly the per-app
// right-side items: update/agent-sessions/app-metrics/cache-size/engine-status.
const engineStore = useEngineStore();
const agentSessionsStore = useAgentSessionsStore();
const appMetricsStore = useAppMetricsStore();
const appUpdateStore = useAppUpdateStore();
const cacheStatsStore = useCacheStatsStore();

// Summed across every process metrics.Sample covers (internal/metrics/ticker.go's Interval, 5s) —
// a single app-wide figure, not a per-process breakdown.
//
// One decimal below 10% rather than Math.round: an idle app using e.g. 0.4% of the machine's whole
// capacity (a real, non-zero reading) would otherwise round to a flat "0%" indistinguishable from
// truly idle (P7 F6).
const cpuLabel = computed(() => {
  const sample = appMetricsStore.sample;
  if (!sample) return '';
  return sample.cpuPercent < 10
    ? `${sample.cpuPercent.toFixed(1)}%`
    : `${Math.round(sample.cpuPercent)}%`;
});
const memLabel = computed(() => {
  const sample = appMetricsStore.sample;
  return sample ? formatBytes(sample.memoryBytes) : '';
});

const metricsTooltip = computed(() => {
  const sample = appMetricsStore.sample;
  if (!sample) return undefined;
  return (
    `${cpuLabel.value} of ${sample.logicalCPUs} cores · ${memLabel.value} across ` +
    `${sample.processCount} processes · every 5s`
  );
});

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

const updateTooltip = computed(
  () =>
    `Version ${appUpdateStore.latestVersion} is available. You have ${appUpdateStore.currentVersion}. ` +
    `Opens GitHub in your browser.`,
);

function onOpenReleasePage(): void {
  void control.updateOpenReleasePage().catch(() => {});
}

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
      <Tooltip v-if="appUpdateStore.available">
        <TooltipTrigger as-child>
          <button
            type="button"
            class="h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-sm cursor-pointer border-0 bg-none hover:bg-hover update"
            data-testid="update-available"
            @click="onOpenReleasePage"
          >
            <CodiconIcon name="cloud-download" :size="13" />
            Update {{ appUpdateStore.latestVersion }}
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ updateTooltip }}</TooltipContent>
      </Tooltip>
      <Tooltip v-if="agentCount > 0">
        <TooltipTrigger as-child>
          <span class="h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-sm cursor-pointer border-0 bg-none hover:bg-hover" data-testid="agent-sessions">
            <CodiconIcon name="sparkle" :size="13" />
            {{ agentCount }}
          </span>
        </TooltipTrigger>
        <TooltipContent class="whitespace-pre-wrap">{{ agentTooltip }}</TooltipContent>
      </Tooltip>
      <Tooltip v-if="appMetricsStore.sample">
        <TooltipTrigger as-child>
          <span class="h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-sm cursor-pointer border-0 bg-none hover:bg-hover" data-testid="app-metrics">
            <CodiconIcon name="pulse" :size="13" />
            <!-- "100%" -->
            <span class="inline-block text-right min-w-[4ch] font-data" data-testid="app-metrics-cpu">{{ cpuLabel }}</span>
            <span class="text-subtle">·</span>
            <!-- "1234.5 MB" -->
            <span class="inline-block text-right min-w-[9ch] font-data" data-testid="app-metrics-mem">{{
              memLabel
            }}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ metricsTooltip }}</TooltipContent>
      </Tooltip>
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

<style scoped>
@reference "@theme/base.css";

/* P110 B39: .metric-value/.metric-value:not(.metric-mem)/.metric-mem/.metric-sep were pure
   @apply-only and moved onto the template directly -- unlike TabStrip.vue's hover/is-active
   opacity toggle, `:not(.metric-mem)` here resolves statically per template call site (the CPU
   span never carries .metric-mem, the mem span always does), not a runtime pointer/selection
   state, so there is no real cascade-order question to preserve.

   .update is a <button>, not the <span> its neighbours use — it is activated, so keyboard focus
   and Enter/Space come free. Its own template class list (P110 B29) already supplies
   height/padding/border-radius/cursor/border-reset. */
.update {
  /* P110 B37: font: inherit has no Tailwind utility equivalent (a font shorthand reset, not a
     single property) -- stays raw, load-bearing here (this IS a <button> with its own visible
     text, unlike ConnectionDialog.vue's own `.kind` no-op precedent). color: var(--kira-info)
     -> text-info. */
  font: inherit;
  @apply text-info;
}
.update:hover {
  @apply text-fg;
}
</style>
