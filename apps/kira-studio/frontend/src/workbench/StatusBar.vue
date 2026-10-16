<script setup lang="ts">
import RunsStatusItem from '@workbench/automations/runs/RunsStatusItem.vue';
import AppMetricsItem from '@workbench/components/AppMetricsItem.vue';
import StatusBarBase from '@workbench/components/StatusBar.vue';
import UpdateAvailableItem from '@workbench/components/UpdateAvailableItem.vue';
import { useAppMetricsStore } from '../state/appMetrics';
import { useAppUpdateStore } from '../state/appUpdate';

// P103 Part 2 (§5.4): Kira Studio's own StatusBar.vue, now a thin composition over the shared bar
// chrome (packages/workbench/src/components/StatusBar.vue) — this file keeps exactly the per-app
// right-side items: update/app-metrics. P116 H7: the app-metrics item's
// own markup moved to AppMetricsItem.vue, shared with Kira Space's own copy. P119: the update item's
// own markup moved to UpdateAvailableItem.vue the same way — its click now opens the in-app dialog
// (appUpdateStore.openUpdateDialog) instead of the release page (§4.6). P127: the session-status
// widget this file also carried moved out with the rest of agent-activity monitoring — no app shows
// it as of this phase.
const appMetricsStore = useAppMetricsStore();
const appUpdateStore = useAppUpdateStore();
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
    </template>
  </StatusBarBase>
</template>
