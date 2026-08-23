<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { settingsState } from '../state/settings';
import { openDataTab, openDocumentTab, openKeyValueTab, openStreamTab } from '../state/tabs';
import { reload as reloadDocumentTab } from '../views/documents/state';
import { reload as reloadDataTab } from '../views/grid/state';
import { reload as reloadKeyValueTab } from '../views/keyvalue/state';
import { reload as reloadStreamTab } from '../views/stream/state';
import { openContextMenu } from '../workbench/state/contextMenu';
import VirtualList from '../workbench/VirtualList.vue';
import { emptyBackgroundMenu, menuForRow } from './menus';
import {
  collapse,
  expand,
  initTreeSync,
  loadSavedQueries,
  searchIncomplete,
  selectRow,
  type TreeRowVm,
  treeState,
  visibleRows,
} from './state/tree';
import TreeRow from './TreeRow.vue';

// Double-click opens a data tab for a relation (§8.10's "Open data" — the same action) rather
// than toggling the twisty, which the twisty button itself already does.
const OPENABLE_KINDS = new Set(['table', 'view', 'matview']);
// A collection opens the same way, but into a 'document' tab (P8) — not the grid's 'data' tab.
const DOCUMENT_OPENABLE_KINDS = new Set(['collection']);
// A redis key opens into a 'keyvalue' tab (P9) — 'namespace'/'database' stay expand-only, like
// mongo's own 'database' node. An s3 object reuses the exact same tab kind (P17's page.ts doc
// comment explains why) — 'prefix'/'bucket' stay expand-only the same way.
const KEYVALUE_OPENABLE_KINDS = new Set(['key', 'object']);
// A kafka topic or sqs queue opens into a 'stream' tab (P10) — 'partition'/'consumerGroup' stay
// browse-only leaves with nothing to open (onOpen's hasChildren guard makes double-click a no-op
// on them, same as a column/index leaf).
const STREAM_OPENABLE_KINDS = new Set(['topic', 'queue']);

const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));
const virtualListRef = ref<{ scrollToIndex: (index: number) => void } | null>(null);

onMounted(() => {
  initTreeSync();
});

// revealPath() (Step 7b) sets pendingScrollKey once its expansion/selection work is done;
// scrolling happens here, one tick later, once visibleRows reflects the newly expanded nodes.
watch(
  () => treeState.pendingScrollKey,
  async (key) => {
    if (!key) return;
    treeState.pendingScrollKey = null;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const index = visibleRows.value.findIndex((row) => row.key === key);
    if (index >= 0) virtualListRef.value?.scrollToIndex(index);
  },
);

function onSelect(row: TreeRowVm): void {
  selectRow(row.key);
}

// The twisty always expands/collapses, regardless of kind — a table's columns must stay
// reachable in the tree (tree.spec.ts's own WIDE_TABLE_PATH scenario). Only double-click
// (onOpen) is kind-aware: it opens data for a table/view/matview instead of expanding it.
function onToggle(row: TreeRowVm): void {
  if (row.expanded) collapse(row.connectionId, row.path);
  else void expand(row.connectionId, row.path);
}

// Task 62: double-clicking a tree row that already has an open tab for the same
// (connectionId, path) used to just refocus it — no refetch. A freshly created tab is about to
// fetch on mount anyway, so only the reused case needs an explicit reload here.
function onOpen(row: TreeRowVm): void {
  if (OPENABLE_KINDS.has(row.kind)) {
    const { id, reused } = openDataTab(row.connectionId, row.path);
    if (reused) void reloadDataTab(id);
    return;
  }
  if (DOCUMENT_OPENABLE_KINDS.has(row.kind)) {
    const { id, reused } = openDocumentTab(row.connectionId, row.path);
    if (reused) void reloadDocumentTab(id);
    return;
  }
  if (KEYVALUE_OPENABLE_KINDS.has(row.kind)) {
    const { id, reused } = openKeyValueTab(row.connectionId, row.path);
    if (reused) void reloadKeyValueTab(id);
    return;
  }
  if (STREAM_OPENABLE_KINDS.has(row.kind)) {
    const { id, reused } = openStreamTab(row.connectionId, row.path);
    if (reused) void reloadStreamTab(id);
    return;
  }
  // A childless, non-openable leaf (column, index) has nothing to open or expand — TreeRow.vue
  // now emits 'open' unconditionally (P9 fix), so this guard is what keeps dblclick a no-op there.
  if (!row.hasChildren) return;
  if (row.expanded) collapse(row.connectionId, row.path);
  else void expand(row.connectionId, row.path);
}

async function onContextMenu(row: TreeRowVm, event: MouseEvent): Promise<void> {
  // The "Saved filters ▸" submenu (Step 13) is built synchronously by menuForRow() from
  // treeState.savedQueries, so it must already be populated by the time the menu opens.
  if (OPENABLE_KINDS.has(row.kind)) await loadSavedQueries(row.connectionId, row.path);
  openContextMenu(event, menuForRow(row));
}

function onBackgroundContextMenu(event: MouseEvent): void {
  // TreeRow.vue stops propagation on its own contextmenu handler, so only a right-click on
  // the empty area below/around the rows (the virtual list's spacer divs) ever reaches here.
  openContextMenu(event, emptyBackgroundMenu());
}
</script>

<template>
  <div class="project-tree">
    <div class="tree-body" data-testid="tree-background" @contextmenu.prevent="onBackgroundContextMenu">
      <VirtualList ref="virtualListRef" :items="visibleRows" :row-height="rowHeight">
        <template #default="{ item }">
          <TreeRow
            :row="item"
            :selected="treeState.selected === item.key"
            @select="onSelect"
            @toggle="onToggle"
            @open="onOpen"
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
