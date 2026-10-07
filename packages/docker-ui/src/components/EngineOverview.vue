<script setup lang="ts">
import { formatBytes } from '@workbench/util/format';
import { computed } from 'vue';
import { formatPercent } from '../lib/format';
import { useDockerStatus } from '../queries';
import { useDockerStatsStore } from '../state/dockerStats';

const status = useDockerStatus();
const stats = useDockerStatsStore();
const engine = computed(() => status.data.value?.engine);

const totals = computed(() => {
  let cpu = 0;
  let mem = 0;
  for (const s of stats.latest.values()) {
    cpu += s.cpuPercent;
    mem += s.memUsage;
  }
  return { cpu, mem };
});

const facts = computed<Array<[string, string]>>(() => {
  const e = engine.value;
  if (!e) return [];
  return [
    ['Version', `${e.version} (API ${e.apiVersion})`],
    ['OS / arch', `${e.operatingSystem || e.os} / ${e.arch}`],
    ['Kernel', e.kernelVersion],
    ['CPUs', String(e.cpus)],
    ['Memory', formatBytes(e.memTotal)],
    ['Endpoint', status.data.value?.endpoint.host ?? ''],
  ];
});

const counts = computed<Array<[string, number]>>(() => {
  const e = engine.value;
  if (!e) return [];
  return [
    ['Running', e.running],
    ['Paused', e.paused],
    ['Stopped', e.stopped],
    ['Images', e.images],
  ];
});
</script>

<template>
  <div class="flex h-full flex-col gap-4 overflow-auto p-4" data-testid="docker-engine-overview">
    <template v-if="engine">
      <div class="flex flex-wrap gap-3">
        <div v-for="[label, n] in counts" :key="label" class="min-w-28 rounded-kira border border-border bg-field px-3 py-2" data-testid="docker-engine-count">
          <div class="text-kira-sm uppercase tracking-wider text-muted-foreground">{{ label }}</div>
          <div class="text-kira-xl font-semibold">{{ n }}</div>
        </div>
        <div class="min-w-28 rounded-kira border border-border bg-field px-3 py-2">
          <div class="text-kira-sm uppercase tracking-wider text-muted-foreground">Running CPU</div>
          <div class="text-kira-xl font-semibold" data-testid="docker-engine-cpu">{{ formatPercent(totals.cpu) }}</div>
        </div>
        <div class="min-w-28 rounded-kira border border-border bg-field px-3 py-2">
          <div class="text-kira-sm uppercase tracking-wider text-muted-foreground">Running memory</div>
          <div class="text-kira-xl font-semibold" data-testid="docker-engine-mem">{{ formatBytes(totals.mem) }}</div>
        </div>
      </div>
      <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <template v-for="[k, v] in facts" :key="k">
          <dt class="text-muted-foreground">{{ k }}</dt>
          <dd class="font-data break-all">{{ v }}</dd>
        </template>
      </dl>
    </template>
  </div>
</template>
