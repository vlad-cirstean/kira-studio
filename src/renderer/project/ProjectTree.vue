<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { settingsState } from '../workbench/state/settings';
import VirtualList from '../workbench/VirtualList.vue';
import {
  collapse,
  expand,
  initTreeSync,
  searchIncomplete,
  type TreeRowVm,
  visibleRows,
} from './state/tree';
import TreeRow from './TreeRow.vue';

const selectedKey = ref<string | null>(null);
const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

onMounted(() => {
  initTreeSync();
});

function onSelect(row: TreeRowVm): void {
  selectedKey.value = row.key;
}

function onToggle(row: TreeRowVm): void {
  if (row.expanded) collapse(row.connectionId, row.path);
  else void expand(row.connectionId, row.path);
}

// Right-click menu wiring lands in Step 9 (context menu service) — the row already emits the
// event so that step only needs to build the handler, not touch the tree again.
function onContextMenu(_row: TreeRowVm, _event: MouseEvent): void {}
</script>

<template>
  <div class="project-tree">
    <div class="tree-body">
      <VirtualList :items="visibleRows" :row-height="rowHeight">
        <template #default="{ item }">
          <TreeRow
            :row="item"
            :selected="selectedKey === item.key"
            @select="onSelect"
            @toggle="onToggle"
            @contextmenu="onContextMenu"
          />
        </template>
      </VirtualList>
    </div>
    <div v-if="searchIncomplete" class="search-incomplete-note" data-testid="search-incomplete-note">
      Searching cached nodes only — expand more of the tree to include it.
    </div>
  </div>
</template>

<style scoped>
.project-tree {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.tree-body {
  flex: 1;
  min-height: 0;
}

.search-incomplete-note {
  flex-shrink: 0;
  padding: 4px 8px;
  font-size: 10px;
  color: var(--kira-fg-muted);
  border-top: var(--kira-border-width) solid var(--kira-border);
}
</style>
