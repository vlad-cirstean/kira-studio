<script setup lang="ts">
import { computed } from 'vue';
import { formatBytes } from '../format';
import { appMetricsState } from '../state/appMetrics';
import { cacheStatsState } from '../state/cacheStats';
import { layoutState, toggleOperationsPanel, toggleProjectPanel } from '../state/layout';
import { settingsOpen } from '../state/settings';
import CodiconIcon from '../theme/CodiconIcon.vue';
import SettingsDialog from './SettingsDialog.vue';
import { engineState } from './state/engine';

// Summed across every OS process the app owns (browser, renderer, GPU, utility) — a single
// app-wide figure, not a per-process breakdown (main/index.ts's own APP_METRICS_INTERVAL_MS).
// The whole segment is v-if-gated on appMetricsState.sample below, so the '' fallback here never
// actually renders — it only satisfies the type checker.
const cpuLabel = computed(() => {
  const sample = appMetricsState.sample;
  return sample ? `${Math.round(sample.cpuPercent)}%` : '';
});
const memLabel = computed(() => {
  const sample = appMetricsState.sample;
  return sample ? formatBytes(sample.memoryBytes) : '';
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
        v-tooltip="'CPU and memory across all app processes, updated every 5s'"
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

      <!-- Panel toggles live here, icon-only, with Settings — separated from the read-outs
           above by a hairline, so "things I toggle" and "things I read" never mix. -->
      <span class="p-sb-toggles">
        <button
          type="button"
          class="p-status"
          :class="{ 'is-on': layoutState.panel.project.visible }"
          v-tooltip="'Connections'"
          data-testid="toggle-project-panel"
          @click="toggleProjectPanel"
        >
          <CodiconIcon name="layout-sidebar-left" :size="13" />
        </button>
        <button
          type="button"
          class="p-status"
          :class="{ 'is-on': layoutState.panel.operations.visible }"
          v-tooltip="'Operations'"
          data-testid="toggle-operations-panel"
          @click="toggleOperationsPanel"
        >
          <CodiconIcon name="layout-panel" :size="13" />
        </button>
        <button
          type="button"
          class="p-status"
          v-tooltip="'Settings'"
          data-testid="open-settings"
          aria-label="Settings"
          @click="settingsOpen = true"
        >
          <CodiconIcon name="settings-gear" :size="13" />
        </button>
      </span>
    </div>
  </div>

  <Teleport to="body">
    <SettingsDialog v-if="settingsOpen" @close="settingsOpen = false" />
  </Teleport>
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
  color: var(--kira-fg-disabled);
}
</style>
