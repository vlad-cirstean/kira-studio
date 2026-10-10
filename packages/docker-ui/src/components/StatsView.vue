<script setup lang="ts">
import { computed } from 'vue';
import { formatPercent, formatSize } from '../lib/format';
import { useDockerStatsStore } from '../state/dockerStats';
import ContainerSizeSection from './ContainerSizeSection.vue';
import DetailSection from './DetailSection.vue';
import StatsSparkline from './StatsSparkline.vue';

const props = defineProps<{ containerId: string; running: boolean }>();

const stats = useDockerStatsStore();
const latest = computed(() => stats.latest.get(props.containerId));
const history = computed(() => stats.history.get(props.containerId) ?? []);
const cpu = computed(() => history.value.map((s) => s.cpuPercent));
const mem = computed(() => history.value.map((s) => s.memUsage));
</script>

<template>
  <div class="h-full overflow-auto p-3" data-testid="docker-stats">
    <div class="@container flex flex-col gap-3">
      <ContainerSizeSection :id="containerId" />
      <p v-if="!running" class="text-muted-foreground" data-testid="docker-stats-stopped">Live stats need a running container.</p>
      <p v-else-if="!latest" class="text-muted-foreground" data-testid="docker-stats-waiting">Waiting for stats…</p>
      <div v-else class="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
        <DetailSection title="CPU">
          <div class="mb-2 flex items-baseline justify-between">
            <span class="text-kira-xl font-semibold" data-testid="docker-stats-cpu">{{ formatPercent(latest.cpuPercent) }}</span>
            <span class="text-kira-sm text-muted-foreground">last {{ cpu.length }} samples</span>
          </div>
          <StatsSparkline :values="cpu" height-class="h-24" />
        </DetailSection>
        <DetailSection title="Memory">
          <div class="mb-2 flex items-baseline justify-between">
            <span class="text-kira-xl font-semibold" data-testid="docker-stats-mem">{{ formatSize(latest.memUsage) }}</span>
            <span class="text-kira-sm text-muted-foreground">of {{ formatSize(latest.memLimit) }} ({{ formatPercent(latest.memPercent) }})</span>
          </div>
          <StatsSparkline :values="mem" :max="latest.memLimit" height-class="h-24" />
        </DetailSection>
        <DetailSection title="I/O" class="@3xl:col-span-2">
          <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt class="text-muted-foreground">Network rx / tx</dt>
            <dd class="font-data">{{ formatSize(latest.netRx) }} / {{ formatSize(latest.netTx) }}</dd>
            <dt class="text-muted-foreground">Block read / write</dt>
            <dd class="font-data">{{ formatSize(latest.blockRead) }} / {{ formatSize(latest.blockWrite) }}</dd>
            <dt class="text-muted-foreground">PIDs</dt>
            <dd class="font-data">{{ latest.pids }}</dd>
          </dl>
        </DetailSection>
      </div>
    </div>
  </div>
</template>
