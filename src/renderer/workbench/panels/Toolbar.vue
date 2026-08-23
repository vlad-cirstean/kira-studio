<script setup lang="ts">
import { computed } from 'vue';
import { connectionsState } from '../../state/connections';
import { activeTab } from '../../state/tabs';
import DdlToolbar from '../../views/ddl/DdlToolbar.vue';
import DataToolbar from '../../views/grid/DataToolbar.vue';
import FilterToolbar from '../../views/grid/FilterToolbar.vue';
import EmptyState from './EmptyState.vue';

// P16 design system LAW: the connection colour reaches the view as a 2px rail
// capping the toolbar that acts on it — not a tint or a border around the
// whole band (the tree rail and the tab rail are the other two places it
// appears). No colour assigned leaves the rail slot unpainted rather than
// unrendered, so the toolbar never shifts when a colour is set.
const color = computed(() => {
  const tab = activeTab.value;
  if (!tab?.connectionId) return undefined;
  return connectionsState.records.find((r) => r.id === tab.connectionId)?.color;
});

const railStyle = computed(() => ({
  '--kira-rail': color.value ? `var(--kira-conn-${color.value})` : undefined,
}));
</script>

<template>
  <div
    v-if="activeTab && (activeTab.kind === 'data' || activeTab.kind === 'ddl')"
    class="toolbar-band"
  >
    <div class="p-toolbar-rail" :style="railStyle" />
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
