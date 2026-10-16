<script setup lang="ts">
import type { AppMetricsSample } from '@shared/protocol/events';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { formatBytes, formatPercent } from '@workbench/behaviour/format';
import { computed } from 'vue';

// P116 H7: the status bar's CPU/memory readout, hoisted verbatim from Kira Studio's own
// StatusBar.vue (same data-testids) — a plain presentational item, the sample itself stays owned by
// each app's own appMetrics store (createAppMetricsStore.ts).
const props = defineProps<{ sample: AppMetricsSample | null }>();

// Summed across every process metrics.Sample covers (internal/metrics/ticker.go's Interval, 5s) —
// a single app-wide figure, not a per-process breakdown.
const cpuLabel = computed(() => (props.sample ? formatPercent(props.sample.cpuPercent) : ''));
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
      <Button as="span" variant="toolbar" size="status" class="text-fg" data-testid="app-metrics">
        <CodiconIcon name="pulse" :size="13" />
        <!-- "100%", "12.3%" -->
        <span class="inline-block text-right min-w-[5ch] font-data" data-testid="app-metrics-cpu">{{
          cpuLabel
        }}</span>
        <span class="text-subtle">·</span>
        <!-- "1234.5 MB" -->
        <span class="inline-block text-right min-w-[9ch] font-data" data-testid="app-metrics-mem">{{
          memLabel
        }}</span>
      </Button>
    </TooltipTrigger>
    <TooltipContent>{{ metricsTooltip }}</TooltipContent>
  </Tooltip>
</template>
