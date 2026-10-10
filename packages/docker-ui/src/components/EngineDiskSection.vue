<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { useTimeAgo } from '@vueuse/core';
import { computed } from 'vue';
import { formatSize } from '../lib/format';
import { useEngineDiskUsage } from '../queries';
import DetailSection from './DetailSection.vue';

const VOLUME_LIMIT = 10;

const { query, refresh } = useEngineDiskUsage();

const usage = computed(() => query.data.value);
const measuring = computed(() => query.isFetching.value);
const takenAt = computed(() => (usage.value ? new Date(usage.value.takenAt) : new Date()));
const ago = useTimeAgo(takenAt);

const categories = computed(() => {
  const u = usage.value;
  if (!u) return [];
  return [
    { key: 'images', label: 'Images', c: u.images },
    { key: 'containers', label: 'Containers', c: u.containers },
    { key: 'volumes', label: 'Volumes', c: u.volumes },
    { key: 'build-cache', label: 'Build cache', c: u.buildCache },
  ];
});

const topVolumes = computed(() => (usage.value?.volumeSizes ?? []).slice(0, VOLUME_LIMIT));
const moreVolumes = computed(() => Math.max(0, (usage.value?.volumeSizes.length ?? 0) - VOLUME_LIMIT));
const sizeText = (n: number): string => (n < 0 ? '-' : formatSize(n));
</script>

<template>
  <DetailSection title="Disk" class="shrink-0">
    <template #actions>
      <span class="ml-auto flex items-center gap-1 normal-case tracking-normal">
        <span
          v-if="usage"
          :title="new Date(usage.takenAt).toLocaleString()"
          data-testid="docker-disk-taken"
        >{{ ago }}</span>
        <TooltipIconButton
          icon="refresh"
          label="Measure disk usage"
          :disabled="measuring"
          data-testid="docker-disk-refresh"
          @click="refresh"
        />
      </span>
    </template>

    <p v-if="query.error.value" class="mb-2 text-error" data-testid="docker-disk-error">{{ query.error.value.message }}</p>

    <div v-if="measuring && !usage" class="flex items-center gap-2 text-muted-foreground">
      <CodiconIcon name="loading" :size="12" class="codicon-modifier-spin" />Measuring…
    </div>
    <div v-else-if="!usage" class="flex flex-wrap items-center gap-3 text-muted-foreground">
      <span>Not measured. Measuring scans the engine's storage and can take a while.</span>
      <Button size="kira" variant="secondary" data-testid="docker-disk-measure" @click="refresh">Measure</Button>
    </div>
    <template v-else>
      <div class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-6 gap-y-1">
        <span />
        <span class="text-right text-kira-sm text-muted-foreground">Size</span>
        <span class="text-right text-kira-sm text-muted-foreground">Count (active)</span>
        <span class="text-right text-kira-sm text-muted-foreground">Reclaimable</span>
        <template v-for="r in categories" :key="r.key">
          <span>{{ r.label }}</span>
          <span class="text-right font-data" :data-testid="`docker-disk-${r.key}`">{{ formatSize(r.c.size) }}</span>
          <span class="text-right font-data">{{ r.c.count }} ({{ r.c.active }})</span>
          <span class="text-right font-data">{{ formatSize(r.c.reclaimable) }}</span>
        </template>
        <span class="font-semibold">Used by Docker</span>
        <span class="text-right font-data font-semibold" data-testid="docker-disk-total">{{ formatSize(usage.total) }}</span>
        <span />
        <span />
      </div>
      <div v-if="topVolumes.length" class="mt-3">
        <div class="mb-1 text-kira-sm text-muted-foreground">Volumes by size</div>
        <div
          v-for="v in topVolumes"
          :key="v.name"
          class="flex items-baseline gap-3"
          data-testid="docker-disk-volume"
          :data-name="v.name"
        >
          <span class="min-w-0 flex-1 truncate font-data">{{ v.name }}</span>
          <span class="font-data">{{ sizeText(v.size) }}</span>
        </div>
        <div v-if="moreVolumes" class="text-muted-foreground" data-testid="docker-disk-more">{{ moreVolumes }} more</div>
      </div>
    </template>
  </DetailSection>
</template>
