<script setup lang="ts">
import { computed } from 'vue';
import { control } from '../bridge/control';
import { formatBytes } from '../format';
import { appMetricsState } from '../state/appMetrics';
import { appUpdateState } from '../state/appUpdate';
import { blameStatusState } from '../state/blameStatus';
import { cacheStatsState } from '../state/cacheStats';
import { navStatusState } from '../state/navStatus';
import CodiconIcon from '../theme/CodiconIcon.vue';
import { blameLineText, blameLineTooltip } from '../views/repo/blameLine';
import { engineState } from './state/engine';

// Summed across every process metrics.Sample covers (internal/metrics/ticker.go's Interval, 5s) —
// a single app-wide figure, not a per-process breakdown. The whole segment is v-if-gated on
// appMetricsState.sample below, so the '' fallback here never actually renders — it only satisfies
// the type checker.
//
// One decimal below 10% rather than Math.round: an idle app using e.g. 0.4% of the machine's whole
// capacity (a real, non-zero reading — 4% of one core on a 10-core Mac) would otherwise round to a
// flat "0%" indistinguishable from truly idle, which is exactly the kind of thing that reads as
// "this number is broken" (P7 F6).
const cpuLabel = computed(() => {
  const sample = appMetricsState.sample;
  if (!sample) return '';
  return sample.cpuPercent < 10
    ? `${sample.cpuPercent.toFixed(1)}%`
    : `${Math.round(sample.cpuPercent)}%`;
});
const memLabel = computed(() => {
  const sample = appMetricsState.sample;
  return sample ? formatBytes(sample.memoryBytes) : '';
});

// P22 D11: numbers only. The Activity-Monitor cross-check this used to spell out (P7 F6: this
// figure is normalized — summed across every process, not the per-process "% CPU" column
// Activity Monitor shows, which reads up to logicalCPUs times higher for the same load) is still
// true and still the reason the CPU figure is shaped the way it is — it now lives in this comment
// and in docs/ARCHITECTURE.md's metrics note, not in a five-line hover panel.
const metricsTooltip = computed(() => {
  const sample = appMetricsState.sample;
  if (!sample) return undefined;
  return (
    `${cpuLabel.value} of ${sample.logicalCPUs} cores · ${memLabel.value} across ` +
    `${sample.processCount} processes · every 5s`
  );
});

const cacheTitle = computed(() => {
  const stats = cacheStatsState.stats;
  if (!stats) return undefined;
  const total = stats.l2Hits + stats.l2Misses;
  const hitRate = total === 0 ? 0 : Math.round((stats.l2Hits / total) * 100);
  return `L2 ${stats.l2Entries} pages, ${hitRate}% hit rate, ${stats.l3Entries} cached counts`;
});

const cacheSizeLabel = computed(() => {
  const stats = cacheStatsState.stats;
  return stats ? formatBytes(stats.l2Bytes) : null;
});

const updateTooltip = computed(
  () =>
    `Version ${appUpdateState.latestVersion} is available. You have ${appUpdateState.currentVersion}. ` +
    `Opens GitHub in your browser.`,
);

function onOpenReleasePage(): void {
  void control.updateOpenReleasePage().catch(() => {});
}

// P76 §5.2: 'none' and 'uncommitted' both render nothing — an always-present "Uncommitted" readout
// is the extension's own choice; this bar hides items with nothing to say instead (app-metrics,
// cache-size both do the same), so absent is the consistent answer here.
const blame = computed(() =>
  blameStatusState.status.kind === 'resolved' ? blameStatusState.status : null,
);
const blameText = computed(() => (blame.value ? blameLineText(blame.value) : ''));
const blameTooltip = computed(() => (blame.value ? blameLineTooltip(blame.value).join(' — ') : ''));

function onRevealBlameCommit(): void {
  if (blame.value) blameStatusState.reveal?.(blame.value.sha);
}

// P78 §7.3: a sibling fact to the blame readout above, same "absent, not a zero reading" rule —
// nothing to show when no find-references/find-implementations request is in flight or answered.
const navStatus = computed(() =>
  navStatusState.status.kind === 'none' ? null : navStatusState.status,
);
const navStatusTooltip = computed(() =>
  navStatus.value?.kind === 'references' ? navStatus.value.tooltip : undefined,
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
      <!-- P76 §5.2: a sibling fact, not the caret-status slot above — that readout stays unwired. -->
      <button
        v-if="blame"
        class="p-status blame"
        data-testid="blame-status"
        :disabled="!blameStatusState.reveal"
        v-tooltip="blameTooltip"
        @click="onRevealBlameCommit"
      >
        <CodiconIcon name="git-commit" :size="13" />
        <span class="blame-text">{{ blameText }}</span>
      </button>
      <span
        v-if="navStatus"
        class="p-status"
        data-testid="nav-status"
        v-tooltip="navStatusTooltip"
      >
        <CodiconIcon name="references" :size="13" />
        {{ navStatus.summary }}
      </span>
    </div>

    <div class="side">
      <button
        v-if="appUpdateState.available"
        class="p-status update"
        data-testid="update-available"
        v-tooltip="updateTooltip"
        @click="onOpenReleasePage"
      >
        <CodiconIcon name="cloud-download" :size="13" />
        Update {{ appUpdateState.latestVersion }}
      </button>
      <span
        v-if="appMetricsState.sample"
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
        :data-status="engineState.status"
        v-tooltip="engineState.lastPingMs !== null ? `${engineState.lastPingMs} ms` : undefined"
      >
        <CodiconIcon
          name="circle-large-filled"
          :size="13"
          :style="{ color: engineState.status === 'ok' ? 'var(--kira-ok)' : 'var(--kira-error)' }"
        />
        engine {{ engineState.status }}
      </span>
    </div>
  </div>
</template>

<style scoped>
/* Fixed, right-aligned slots (monospace, so `ch` is an exact character width) — as the CPU%/
   memory readouts gain digits (0% -> 100%, 12.0 MB -> 1234.5 MB) they grow into their own
   reserved space instead of pushing cache-size/engine-status/the toggle group sideways. */
.metric-value {
  display: inline-block;
  text-align: right;
}
.metric-value:not(.metric-mem) {
  min-width: 4ch; /* "100%" */
}
.metric-mem {
  min-width: 9ch; /* "1234.5 MB" */
}
.metric-sep {
  color: var(--kira-fg-subtle);
}

/* .update is a <button>, not the <span> its neighbours use — it is activated, so keyboard focus
   and Enter/Space come free. Reset the button's own UA chrome; .p-status already supplies
   height/padding/border-radius/cursor. --kira-info (already used by .p-td.fk) reads as actionable
   against the bar's own --kira-fg-muted. */
.update {
  background: none;
  font: inherit;
  color: var(--kira-info);
}
.update:hover {
  color: var(--kira-fg);
}

/* .blame is a <button> for the same reason .update is (activated -> keyboard focus/Enter/Space
   come free); its UA chrome reset is that rule's, reused. Unlike .update, no accent color — a
   blame readout is informational, not something needing attention. */
.blame {
  background: none;
  font: inherit;
  color: var(--kira-fg);
}
.blame:disabled {
  cursor: default;
}
.blame-text {
  max-width: 48ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
