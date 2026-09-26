<script setup lang="ts">
import type { AppMetricsSample } from '@shared/protocol/events';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { formatBytes } from '@workbench/util/format';
import { computed } from 'vue';

// P116 H7: the status bar's CPU/memory readout, hoisted verbatim from Kira Studio's own
// StatusBar.vue (same data-testids) — a plain presentational item, the sample itself stays owned by
// each app's own appMetrics store (createAppMetricsStore.ts).
const props = defineProps<{ sample: AppMetricsSample | null }>();

// Summed across every process metrics.Sample covers (internal/metrics/ticker.go's Interval, 5s) —
// a single app-wide figure, not a per-process breakdown.
//
// One decimal below 10% rather than Math.round: an idle app using e.g. 0.4% of the machine's whole
// capacity (a real, non-zero reading) would otherwise round to a flat "0%" indistinguishable from
// truly idle (P7 F6).
const cpuLabel = computed(() => {
  const sample = props.sample;
  if (!sample) return '';
  return sample.cpuPercent < 10
    ? `${sample.cpuPercent.toFixed(1)}%`
    : `${Math.round(sample.cpuPercent)}%`;
});
const memLabel = computed(() => {
  const sample = props.sample;
  return sample ? formatBytes(sample.memoryBytes) : '';
});

const metricsTooltip = computed(() => {
  const sample = props.sample;
  if (!sample) return undefined;
  return (
    `${cpuLabel.value} of ${sample.logicalCPUs} cores · ${memLabel.value} across ` +
    `${sample.processCount} processes · every 5s`
  );
});
</script>

<template>
  <Tooltip v-if="sample">
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
</template>
