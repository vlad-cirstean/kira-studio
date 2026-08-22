<script setup lang="ts">
import { computed } from 'vue';
import { connectionsState } from '../../state/connections';
import { activeTab } from '../../state/tabs';
import DdlToolbar from '../../views/ddl/DdlToolbar.vue';
import DataToolbar from '../../views/grid/DataToolbar.vue';
import FilterToolbar from '../../views/grid/FilterToolbar.vue';
import EmptyState from './EmptyState.vue';

// §8.12: the connection's colour on the toolbar band, the second of three places it appears
// (the tree rail and the tab are the other two).
const color = computed(() => {
  const tab = activeTab.value;
  if (!tab?.connectionId) return undefined;
  return connectionsState.records.find((r) => r.id === tab.connectionId)?.color;
});

const tintStyle = computed(() =>
  color.value
    ? {
        borderLeft: `3px solid var(--kira-conn-${color.value})`,
        background: `color-mix(in srgb, var(--kira-conn-${color.value}) 6%, transparent)`,
      }
    : {},
);
</script>

<template>
  <div
    v-if="activeTab && (activeTab.kind === 'data' || activeTab.kind === 'ddl')"
    class="toolbar-band"
    :style="tintStyle"
  >
    <template v-if="activeTab.kind === 'data'">
      <DataToolbar />
      <FilterToolbar />
    </template>
    <DdlToolbar v-else :tab-id="activeTab.id" />
  </div>
  <EmptyState v-else icon="tools" label="No connection selected" />
</template>

<style scoped>
.toolbar-band {
  min-height: 32px;
}
</style>
