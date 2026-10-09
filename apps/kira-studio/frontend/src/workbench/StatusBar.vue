<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import RunsStatusItem from '@workbench/automations/runs/RunsStatusItem.vue';
import AppMetricsItem from '@workbench/components/AppMetricsItem.vue';
import StatusBarBase from '@workbench/components/StatusBar.vue';
import UpdateAvailableItem from '@workbench/components/UpdateAvailableItem.vue';
import { formatBytes } from '@workbench/util/format';
import { computed } from 'vue';
import { useAppMetricsStore } from '../state/appMetrics';
import { useAppUpdateStore } from '../state/appUpdate';
import { useCacheStatsStore } from '../state/cacheStats';

// P103 Part 2 (§5.4): Kira Studio's own StatusBar.vue, now a thin composition over the shared bar
// chrome (packages/workbench/src/components/StatusBar.vue) — this file keeps exactly the per-app
// right-side items: update/app-metrics/cache-size. P116 H7: the app-metrics item's
// own markup moved to AppMetricsItem.vue, shared with Kira Space's own copy. P119: the update item's
// own markup moved to UpdateAvailableItem.vue the same way — its click now opens the in-app dialog
// (appUpdateStore.openUpdateDialog) instead of the release page (§4.6). P127: the session-status
// widget this file also carried moved out with the rest of agent-activity monitoring — no app shows
// it as of this phase.
const appMetricsStore = useAppMetricsStore();
const appUpdateStore = useAppUpdateStore();
const cacheStatsStore = useCacheStatsStore();

const cacheTitle = computed(() => {
  const stats = cacheStatsStore.stats;
  if (!stats) return undefined;
  const total = stats.l2Hits + stats.l2Misses;
  const hitRate = total === 0 ? 0 : Math.round((stats.l2Hits / total) * 100);
  return `L2 ${stats.l2Entries} pages, ${hitRate}% hit rate, ${stats.l3Entries} cached counts`;
});

const cacheSizeLabel = computed(() => {
  const stats = cacheStatsStore.stats;
  return stats ? formatBytes(stats.l2Bytes) : null;
});
</script>

<template>
  <StatusBarBase>
    <template #right>
      <RunsStatusItem />
      <UpdateAvailableItem
        v-if="appUpdateStore.available"
        :latest-version="appUpdateStore.latestVersion"
        :current-version="appUpdateStore.currentVersion"
        @open="appUpdateStore.openUpdateDialog()"
      />
      <AppMetricsItem :sample="appMetricsStore.sample" />
      <Tooltip v-if="cacheSizeLabel">
        <TooltipTrigger as-child>
          <span class="h-control-sm inline-flex items-center gap-1 px-1.5 rounded-kira-sm text-fg text-kira-sm cursor-pointer border-0 bg-none hover:bg-hover" data-testid="cache-size">
            <CodiconIcon name="database" :size="13" />
            {{ cacheSizeLabel }}
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ cacheTitle }}</TooltipContent>
      </Tooltip>
    </template>
  </StatusBarBase>
</template>
