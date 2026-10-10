<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { computed } from 'vue';
import { formatPercent, formatSize } from '../lib/format';
import { useContainerAction, useContainers, useDockerStatus, useImages, useNetworks, useVolumes } from '../queries';
import { useDockerStatsStore } from '../state/dockerStats';
import { type DockerSection, useDockerUiStore } from '../state/dockerUi';
import type { DockerStatsSample } from '../wire';
import ContainerTable from './ContainerTable.vue';
import DetailSection from './DetailSection.vue';
import EndpointChip from './EndpointChip.vue';
import EngineDiskSection from './EngineDiskSection.vue';
import StatsSparkline from './StatsSparkline.vue';
import UsageBar from './UsageBar.vue';

const ui = useDockerUiStore();
const qc = useQueryClient();
const status = useDockerStatus();
const containers = useContainers();
const images = useImages();
const volumes = useVolumes();
const networks = useNetworks();
const stats = useDockerStatsStore();
const actions = useContainerAction();

const engine = computed(() => status.data.value?.engine);

const runningIds = computed(
  () => new Set((containers.data.value ?? []).filter((c) => c.state === 'running').map((c) => c.id)),
);

const totals = computed(() => {
  let cpu = 0;
  let mem = 0;
  for (const [id, s] of stats.latest) {
    if (!runningIds.value.has(id)) continue;
    cpu += s.cpuPercent;
    mem += s.memUsage;
  }
  return { cpu, mem };
});

// Per-container rings share one cadence, so aligning them on the newest sample sums them.
function series(pick: (s: DockerStatsSample) => number): number[] {
  const rings = [...stats.history].filter(([id]) => runningIds.value.has(id)).map(([, ring]) => ring);
  const n = Math.max(0, ...rings.map((r) => r.length));
  const out = new Array<number>(n).fill(0);
  for (const ring of rings) {
    const offset = n - ring.length;
    ring.forEach((s, i) => {
      out[offset + i] += pick(s);
    });
  }
  return out;
}

const cpuSeries = computed(() => series((s) => s.cpuPercent));
const memSeries = computed(() => series((s) => s.memUsage));

const cpuCapacity = computed(() => (engine.value?.cpus ?? 1) * 100);
const cpuPercentOfCapacity = computed(() => (totals.value.cpu / cpuCapacity.value) * 100);
const memPercentOfTotal = computed(() => {
  const total = engine.value?.memTotal ?? 0;
  return total > 0 ? (totals.value.mem / total) * 100 : 0;
});

const split = computed(() => {
  const e = engine.value;
  const total = Math.max(1, (e?.running ?? 0) + (e?.paused ?? 0) + (e?.stopped ?? 0));
  return {
    running: ((e?.running ?? 0) / total) * 100,
    paused: ((e?.paused ?? 0) / total) * 100,
    stopped: ((e?.stopped ?? 0) / total) * 100,
  };
});

const links = computed<Array<{ section: DockerSection; label: string; icon: string; count: number }>>(() => [
  { section: 'images', label: 'Images', icon: 'package', count: images.data.value?.length ?? engine.value?.images ?? 0 },
  { section: 'volumes', label: 'Volumes', icon: 'database', count: volumes.data.value?.length ?? 0 },
  { section: 'networks', label: 'Networks', icon: 'globe', count: networks.data.value?.length ?? 0 },
]);

const facts = computed<Array<[string, string]>>(() => {
  const e = engine.value;
  if (!e) return [];
  return [
    ['Version', `${e.version} (API ${e.apiVersion})`],
    ['OS / arch', `${e.operatingSystem || e.os} / ${e.arch}`],
    ['Kernel', e.kernelVersion],
    ['CPUs', String(e.cpus)],
    ['Memory', formatSize(e.memTotal)],
    ['Endpoint', status.data.value?.endpoint.host ?? ''],
  ];
});

const stoppedIds = computed(() => (containers.data.value ?? []).filter((c) => c.state !== 'running' && c.state !== 'paused').map((c) => c.id));
const anyBusy = computed(() => [...runningIds.value, ...stoppedIds.value].some((id) => actions.isBusy(id)));

function runAll(ids: Iterable<string>, action: 'start' | 'stop'): void {
  for (const id of ids) void actions.run(id, action).catch(() => undefined);
}

function openSection(section: DockerSection): void {
  ui.setSection(section);
}

function refresh(): Promise<void> {
  return qc.invalidateQueries({ queryKey: ['docker'] });
}
</script>

<template>
  <div class="flex h-full flex-col gap-3 overflow-auto p-3" data-testid="docker-engine-overview">
    <template v-if="engine">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 class="text-kira-lg font-semibold">Docker Engine</h2>
        <Badge variant="info">{{ engine.version }}</Badge>
        <span class="inline-flex items-center gap-1 text-kira-sm text-muted-foreground"><EndpointChip /></span>
        <span class="ml-auto flex items-center gap-1">
          <Button
            size="kira"
            variant="secondary"
            :disabled="anyBusy || stoppedIds.length === 0"
            data-testid="docker-start-stopped"
            @click="runAll(stoppedIds, 'start')"
          >
            <CodiconIcon name="play" :size="12" class="text-ok" />Start stopped
          </Button>
          <Button
            size="kira"
            variant="secondary"
            :disabled="anyBusy || runningIds.size === 0"
            data-testid="docker-stop-all"
            @click="runAll(runningIds, 'stop')"
          >
            <CodiconIcon name="debug-stop" :size="12" class="text-error" />Stop all
          </Button>
          <Button size="kira" variant="secondary" data-testid="docker-overview-refresh" @click="refresh">
            <CodiconIcon name="refresh" :size="12" />Refresh
          </Button>
        </span>
      </div>

      <div class="@container shrink-0">
        <div class="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-4">
          <DetailSection title="Status">
            <div class="flex items-baseline gap-1.5">
              <span class="text-kira-xl font-semibold" data-testid="docker-engine-count">{{ engine.running }}</span>
              <span class="text-muted-foreground">running</span>
            </div>
            <div class="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-field">
              <div class="bg-ok" :style="{ width: `${split.running}%` }" />
              <div class="bg-warn" :style="{ width: `${split.paused}%` }" />
              <div class="bg-subtle" :style="{ width: `${split.stopped}%` }" />
            </div>
            <div class="mt-2 text-kira-sm text-muted-foreground" data-testid="docker-engine-counts">
              {{ engine.stopped }} stopped · {{ engine.paused }} paused
            </div>
          </DetailSection>
          <DetailSection title="CPU">
            <div class="flex items-baseline gap-1.5">
              <span class="text-kira-xl font-semibold" data-testid="docker-engine-cpu">{{ formatPercent(totals.cpu) }}</span>
              <span class="text-muted-foreground">of {{ engine.cpus * 100 }}%</span>
            </div>
            <div class="mt-2"><UsageBar :percent="cpuPercentOfCapacity" /></div>
            <div class="mt-2"><StatsSparkline :values="cpuSeries" :max="cpuCapacity" height-class="h-8" /></div>
          </DetailSection>
          <DetailSection title="Memory">
            <div class="flex items-baseline gap-1.5">
              <span class="text-kira-xl font-semibold" data-testid="docker-engine-mem">{{ formatSize(totals.mem) }}</span>
              <span class="text-muted-foreground">of {{ formatSize(engine.memTotal) }}</span>
            </div>
            <div class="mt-2"><UsageBar :percent="memPercentOfTotal" /></div>
            <div class="mt-2"><StatsSparkline :values="memSeries" :max="engine.memTotal" height-class="h-8" /></div>
          </DetailSection>
          <DetailSection title="Resources" flush>
            <button
              v-for="l in links"
              :key="l.section"
              type="button"
              class="flex h-control-lg w-full cursor-default items-center gap-2 px-3 text-left hover:bg-hover"
              :data-testid="`docker-overview-link-${l.section}`"
              @click="openSection(l.section)"
            >
              <CodiconIcon :name="l.icon" :size="13" class="text-muted-foreground" />
              <span class="flex-1">{{ l.label }}</span>
              <Badge variant="count">{{ l.count }}</Badge>
              <CodiconIcon name="chevron-right" :size="12" class="text-muted-foreground" />
            </button>
          </DetailSection>
        </div>
      </div>

      <EngineDiskSection />

      <DetailSection title="Containers" flush class="shrink-0">
        <ContainerTable />
      </DetailSection>

      <DetailSection title="Engine" class="shrink-0">
        <dl class="@container">
          <div class="grid grid-cols-1 gap-x-6 gap-y-2 @xl:grid-cols-2 @4xl:grid-cols-3">
            <div v-for="[k, v] in facts" :key="k" class="min-w-0">
              <dt class="text-kira-sm text-muted-foreground">{{ k }}</dt>
              <dd class="break-all font-data">{{ v }}</dd>
            </div>
          </div>
        </dl>
      </DetailSection>
    </template>
  </div>
</template>
