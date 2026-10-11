<script setup lang="ts">
import Spinner from '@theme/components/Spinner.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { FieldError } from '@theme/components/ui/field';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { displayValue, formatBytes, formatDateTime, useRelativeTime } from '@workbench/behaviour/format';
import { computed } from 'vue';
import { useEngineDiskUsage } from '../queries';
import DetailSection from './DetailSection.vue';

const VOLUME_LIMIT = 10;

const { query, refresh } = useEngineDiskUsage();

const usage = computed(() => query.data.value);
const measuring = computed(() => query.isFetching.value);
const takenAt = computed(() => (usage.value ? new Date(usage.value.takenAt) : new Date()));
const ago = useRelativeTime(takenAt);

const categories = computed(() => {
  const u = usage.value;
  if (!u) return [];
  return [
    { key: 'images', label: t('docker.section.images.label'), c: u.images },
    { key: 'containers', label: t('docker.section.containers.label'), c: u.containers },
    { key: 'volumes', label: t('docker.section.volumes.label'), c: u.volumes },
    { key: 'build-cache', label: t('docker.disk.buildCache.label'), c: u.buildCache },
  ];
});

const topVolumes = computed(() => (usage.value?.volumeSizes ?? []).slice(0, VOLUME_LIMIT));
const moreVolumes = computed(() => Math.max(0, (usage.value?.volumeSizes.length ?? 0) - VOLUME_LIMIT));
const sizeText = (n: number): string => (n < 0 ? displayValue(null) : formatBytes(n));
</script>

<template>
  <DetailSection :title="t('docker.disk.title')" class="shrink-0">
    <template #actions>
      <span class="ml-auto flex items-center gap-1 normal-case tracking-normal">
        <Tooltip v-if="usage">
          <TooltipTrigger as-child>
            <span data-testid="docker-disk-taken">{{ ago }}</span>
          </TooltipTrigger>
          <TooltipContent>{{ formatDateTime(usage.takenAt) }}</TooltipContent>
        </Tooltip>
        <TooltipIconButton
          icon="refresh"
          :label="t('docker.disk.measure.tooltip')"
          :disabled="measuring"
          data-testid="docker-disk-refresh"
          @click="refresh"
        />
      </span>
    </template>

    <FieldError v-if="query.error.value" class="mb-2" data-testid="docker-disk-error">{{ query.error.value.message }}</FieldError>

    <div v-if="measuring && !usage" class="flex items-center gap-2 text-muted-foreground">
      <Spinner label="" />{{ t('docker.measuring.loading') }}
    </div>
    <div v-else-if="!usage" class="flex flex-wrap items-center gap-3 text-muted-foreground">
      <span>{{ t('docker.disk.notMeasured.body') }}</span>
      <Button size="kira" variant="toolbar" data-testid="docker-disk-measure" @click="refresh">{{ t('docker.measure.label') }}</Button>
    </div>
    <template v-else>
      <div class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-6 gap-y-1">
        <span />
        <span class="text-right text-kira-sm text-muted-foreground">{{ t('docker.field.size.label') }}</span>
        <span class="text-right text-kira-sm text-muted-foreground">{{ t('docker.disk.countActive.label') }}</span>
        <span class="text-right text-kira-sm text-muted-foreground">{{ t('docker.disk.reclaimable.label') }}</span>
        <template v-for="r in categories" :key="r.key">
          <span>{{ r.label }}</span>
          <span class="text-right font-data" :data-testid="`docker-disk-${r.key}`">{{ formatBytes(r.c.size) }}</span>
          <span class="text-right font-data">{{ r.c.count }} ({{ r.c.active }})</span>
          <span class="text-right font-data">{{ formatBytes(r.c.reclaimable) }}</span>
        </template>
        <span class="font-medium">{{ t('docker.disk.usedByDocker.label') }}</span>
        <span class="text-right font-data font-medium" data-testid="docker-disk-total">{{ formatBytes(usage.total) }}</span>
        <span />
        <span />
      </div>
      <div v-if="topVolumes.length" class="mt-3">
        <div class="mb-1 text-kira-sm text-muted-foreground">{{ t('docker.disk.volumesBySize.label') }}</div>
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
        <div v-if="moreVolumes" class="text-muted-foreground" data-testid="docker-disk-more">{{ t('docker.disk.more.label', { count: moreVolumes }) }}</div>
      </div>
    </template>
  </DetailSection>
</template>
