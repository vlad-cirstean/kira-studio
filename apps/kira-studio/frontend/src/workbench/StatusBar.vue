<script setup lang="ts">
import { computed } from 'vue';
import { formatBytes } from '../format';
import { appMetricsState } from '../state/appMetrics';
import { cacheStatsState } from '../state/cacheStats';
import CodiconIcon from '../theme/CodiconIcon.vue';
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

// States the convention explicitly (normalized, not the per-core-sum Activity Monitor's own
// per-process "% CPU" column uses) since a user comparing against that column is the exact
// cross-check "the numbers are not trusted" points at — that column reads up to logicalCPUs times
// higher for the same load, not because either number is wrong (P7 F6).
const metricsTooltip = computed(() => {
  const sample = appMetricsState.sample;
  if (!sample) return undefined;
  return (
    `${cpuLabel.value} of ${sample.logicalCPUs} CPU cores · ${memLabel.value} memory footprint ` +
    `across ${sample.processCount} processes · updated every 5s. Activity Monitor's own per-process ` +
    `"% CPU" column is not normalized and reads up to ${sample.logicalCPUs}x higher for the same load.`
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
</style>
