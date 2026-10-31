<script setup lang="ts">
import type { AppMetricsSample } from '@shared/protocol/events';
import TooltipDetails from '@theme/components/TooltipDetails.vue';
import { t } from '@theme/i18n';
import { formatBytes, formatPercent } from '@workbench/behaviour/format';
import StatusBarItem from '@workbench/components/StatusBarItem.vue';
import { computed } from 'vue';

// P116 H7: the status bar's CPU/memory readout, hoisted verbatim from Kira Studio's own
// StatusBar.vue (same data-testids) — a plain presentational item, the sample itself stays owned by
// each app's own appMetrics store (createAppMetricsStore.ts).
const props = defineProps<{ sample: AppMetricsSample | null; appName: string }>();

// Summed across every process metrics.Sample covers (internal/metrics/ticker.go's Interval, 5s) —
// a single app-wide figure, not a per-process breakdown.
const cpuLabel = computed(() => (props.sample ? formatPercent(props.sample.cpuPercent) : ''));
const memLabel = computed(() => {
  const sample = props.sample;
  return sample ? formatBytes(sample.memoryBytes) : '';
});

const rows = computed(() => {
  const sample = props.sample;
  if (!sample) return [];
  return [
    {
      label: t('docker.metric.cpu.label'),
      value: t('workbench.statusBar.metrics.cpuShare.label', { percent: cpuLabel.value }),
    },
    { label: t('workbench.statusBar.metrics.cores.label'), value: String(sample.logicalCPUs) },
    { label: t('common.module.memory.label'), value: memLabel.value },
    { label: t('workbench.statusBar.metrics.processes.label'), value: String(sample.processCount) },
  ];
});
</script>

<template>
  <StatusBarItem v-if="sample" icon="pulse" as="span" data-testid="app-metrics">
    <!-- "100%", "12.3%" -->
    <span class="inline-block text-right min-w-[5ch]" data-testid="app-metrics-cpu">{{
      cpuLabel
    }}</span>
    <span class="text-subtle">·</span>
    <!-- "1234.5 MB" -->
    <span class="inline-block text-right min-w-[9ch]" data-testid="app-metrics-mem">{{
      memLabel
    }}</span>
    <template #tip>
      <TooltipDetails
        :title="t('workbench.statusBar.metrics.tooltip', { app: appName })"
        :rows="rows"
        :hint="t('workbench.statusBar.metrics.interval.hint')"
      />
    </template>
  </StatusBarItem>
</template>
