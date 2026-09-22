<script setup lang="ts">
import { computed } from 'vue';
import { control } from '../bridge/control';
import { formatBytes } from '../format';
import { useAgentSessionsStore } from '../state/agentSessions';
import { useAppMetricsStore } from '../state/appMetrics';
import { useAppUpdateStore } from '../state/appUpdate';
import { useCacheStatsStore } from '../state/cacheStats';
import CodiconIcon from '../theme/CodiconIcon.vue';
import { useEngineStore } from './state/engine';

const engineStore = useEngineStore();
const agentSessionsStore = useAgentSessionsStore();
const appMetricsStore = useAppMetricsStore();
const appUpdateStore = useAppUpdateStore();
const cacheStatsStore = useCacheStatsStore();

// Summed across every process metrics.Sample covers (internal/metrics/ticker.go's Interval, 5s) —
// a single app-wide figure, not a per-process breakdown. The whole segment is v-if-gated on
// appMetricsStore.sample below, so the '' fallback here never actually renders — it only satisfies
// the type checker.
//
// One decimal below 10% rather than Math.round: an idle app using e.g. 0.4% of the machine's whole
// capacity (a real, non-zero reading — 4% of one core on a 10-core Mac) would otherwise round to a
// flat "0%" indistinguishable from truly idle, which is exactly the kind of thing that reads as
// "this number is broken" (P7 F6).
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

// P22 D11: numbers only. The Activity-Monitor cross-check this used to spell out (P7 F6: this
// figure is normalized — summed across every process, not the per-process "% CPU" column
// Activity Monitor shows, which reads up to logicalCPUs times higher for the same load) is still
// true and still the reason the CPU figure is shaped the way it is — it now lives in this comment
// and in docs/ARCHITECTURE.md's metrics note, not in a five-line hover panel.
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

// P100 Part 2: the blame readout (P76 §5.2 — state/blameStatus.ts, views/repo/blameLine.ts) used
// to live here, a sibling fact beside the caret-status slot below. Blame is intrinsically a repo/
// git fact, not duplicated the way the standalone Terminal renderer was (views/terminal/
// TerminalView.vue's own doc comment) — both its state store and its one caller here moved to
// apps/kira-space wholesale instead.

// P86 §14.1: an app-wide fact like app-metrics/cache-size beside it, not a caret fact — §11's own
// count, absent (not a zero reading, StatusBar's own rule above) rather than shown as "0".
// state.cwd is an absolute path, not an encoded NodePath (tabKinds.ts's own basename, restated
// here since it is not exported there).
function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

const agentCount = computed(() => agentSessionsStore.sessions.length);

// §13's own activity text: 'waiting for you' (attention, plus the bounded message when present),
// 'running <toolName>' (working with a tool), 'working' (working with none), 'idle', or null when
// this window knows no activity for that session (hooks off, or another window's session) — the
// tooltip line then falls back to basename(cwd) alone.
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
  <div class="p-statusbar" :style="{ color: 'var(--kira-fg-muted)' }">
    <!-- LAW 14: the left readout answers "where is the caret" and nothing else — every fact a
         toolbar already carries (row counts, pending edits, durations) stays there instead of
         accumulating here too. Not yet wired per-view; "no selection" is the honest default. -->
    <div class="side">
      <span class="p-status" data-testid="caret-status">
        <span class="mono xs muted">no selection</span>
      </span>
    </div>

    <div class="side">
      <button
        v-if="appUpdateStore.available"
        class="p-status update"
        data-testid="update-available"
        v-tooltip="updateTooltip"
        @click="onOpenReleasePage"
      >
        <CodiconIcon name="cloud-download" :size="13" />
        Update {{ appUpdateStore.latestVersion }}
      </button>
      <span
        v-if="agentCount > 0"
        class="p-status"
        data-testid="agent-sessions"
        v-tooltip="agentTooltip"
      >
        <CodiconIcon name="sparkle" :size="13" />
        {{ agentCount }}
      </span>
      <span
        v-if="appMetricsStore.sample"
        class="p-status"
        data-testid="app-metrics"
        v-tooltip="metricsTooltip"
      >
        <CodiconIcon name="pulse" :size="13" />
        <span class="metric-value mono" data-testid="app-metrics-cpu">{{ cpuLabel }}</span>
        <span class="metric-sep">·</span>
        <span class="metric-value metric-mem mono" data-testid="app-metrics-mem">{{
          memLabel
        }}</span>
      </span>
      <span v-if="cacheSizeLabel" class="p-status" data-testid="cache-size" v-tooltip="cacheTitle">
        <CodiconIcon name="database" :size="13" />
        {{ cacheSizeLabel }}
      </span>
      <span
        class="p-status"
        data-testid="engine-status"
        :data-status="engineStore.status"
        v-tooltip="engineStore.lastPingMs !== null ? `${engineStore.lastPingMs} ms` : undefined"
      >
        <CodiconIcon
          name="circle-large-filled"
          :size="13"
          :style="{ color: engineStore.status === 'ok' ? 'var(--kira-ok)' : 'var(--kira-error)' }"
        />
        engine {{ engineStore.status }}
      </span>
    </div>
  </div>
</template>

<style scoped>
@reference "@/theme/base.css";

/* Fixed, right-aligned slots (monospace, so `ch` is an exact character width) — as the CPU%/
   memory readouts gain digits (0% -> 100%, 12.0 MB -> 1234.5 MB) they grow into their own
   reserved space instead of pushing cache-size/engine-status/the toggle group sideways. */
.metric-value {
  @apply inline-block text-right;
}
.metric-value:not(.metric-mem) {
  @apply min-w-[4ch]; /* "100%" */
}
.metric-mem {
  @apply min-w-[9ch]; /* "1234.5 MB" */
}
.metric-sep {
  color: var(--kira-fg-subtle);
}

/* .update is a <button>, not the <span> its neighbours use — it is activated, so keyboard focus
   and Enter/Space come free. Reset the button's own UA chrome; .p-status already supplies
   height/padding/border-radius/cursor. --kira-info (already used by .p-td.fk) reads as actionable
   against the bar's own --kira-fg-muted. */
.update {
  @apply bg-none;
  font: inherit;
  color: var(--kira-info);
}
.update:hover {
  color: var(--kira-fg);
}
</style>
