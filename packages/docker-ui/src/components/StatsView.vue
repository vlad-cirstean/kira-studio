<script setup lang="ts">
import { formatBytes } from '@workbench/util/format';
import { computed } from 'vue';
import { formatPercent } from '../lib/format';
import { useDockerStatsStore } from '../state/dockerStats';
import StatsSparkline from './StatsSparkline.vue';

const props = defineProps<{ containerId: string }>();

const stats = useDockerStatsStore();
const latest = computed(() => stats.latest.get(props.containerId));
const history = computed(() => stats.history.get(props.containerId) ?? []);
const cpu = computed(() => history.value.map((s) => s.cpuPercent));
const mem = computed(() => history.value.map((s) => s.memUsage));
</script>

<template>
  <div class="flex h-full flex-col gap-3 overflow-auto p-3" data-testid="docker-stats">
    <p v-if="!latest" class="text-muted-foreground" data-testid="docker-stats-waiting">Waiting for stats…</p>
    <template v-else>
      <section class="flex flex-col gap-1">
        <div class="flex items-baseline justify-between">
          <h3 class="text-kira-sm uppercase tracking-wider text-muted-foreground">CPU</h3>
          <span class="font-data" data-testid="docker-stats-cpu">{{ formatPercent(latest.cpuPercent) }}</span>
        </div>
        <StatsSparkline :values="cpu" />
      </section>
      <section class="flex flex-col gap-1">
        <div class="flex items-baseline justify-between">
          <h3 class="text-kira-sm uppercase tracking-wider text-muted-foreground">Memory</h3>
          <span class="font-data" data-testid="docker-stats-mem">
            {{ formatBytes(latest.memUsage) }} / {{ formatBytes(latest.memLimit) }} ({{ formatPercent(latest.memPercent) }})
          </span>
        </div>
        <StatsSparkline :values="mem" :max="latest.memLimit" />
      </section>
      <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt class="text-muted-foreground">Network I/O</dt>
        <dd class="font-data">{{ formatBytes(latest.netRx) }} / {{ formatBytes(latest.netTx) }}</dd>
        <dt class="text-muted-foreground">Block I/O</dt>
        <dd class="font-data">{{ formatBytes(latest.blockRead) }} / {{ formatBytes(latest.blockWrite) }}</dd>
        <dt class="text-muted-foreground">PIDs</dt>
        <dd class="font-data">{{ latest.pids }}</dd>
      </dl>
    </template>
  </div>
</template>
