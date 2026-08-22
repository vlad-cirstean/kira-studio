<script setup lang="ts">
import { computed } from 'vue';
import { openContextMenu } from '../workbench/state/contextMenu';
import { settingsState } from '../workbench/state/settings';
import VirtualList from '../workbench/VirtualList.vue';
import { treeBackgroundMenu } from './menus';
import { searchNotice, visibleRows } from './state/tree';
import TreeRow from './TreeRow.vue';

const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));

function onBackgroundMenu(e: MouseEvent): void {
  openContextMenu(e, treeBackgroundMenu());
}
</script>

<template>
  <div class="project-tree" @contextmenu.prevent="onBackgroundMenu">
    <VirtualList :items="visibleRows" :row-height="rowHeight">
      <template #default="{ item }">
        <TreeRow :row="item" />
      </template>
    </VirtualList>
    <div v-if="searchNotice" class="search-notice" data-testid="tree-search-notice">
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

.search-notice {
  flex-shrink: 0;
  padding: 4px 8px;
  border-top: var(--kira-border-width) solid var(--kira-border);
  color: var(--kira-fg-disabled);
  font-size: 11px;
}
</style>
