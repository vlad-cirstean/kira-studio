<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { shortcutFor } from '../shortcuts/keys';
import { settingsState } from '../state/settings';
import { openDataTab, openDocumentTab, openKeyValueTab, openStreamTab } from '../state/tabs';
import { reload as reloadDocumentTab } from '../views/documents/state';
import { reload as reloadDataTab } from '../views/grid/state';
import { reload as reloadKeyValueTab } from '../views/keyvalue/state';
import { reload as reloadStreamTab } from '../views/stream/state';
import { openContextMenu, runMenuShortcut } from '../workbench/state/contextMenu';
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
  toggleGroup,
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

// The twisty always expands/collapses. A group row (P19) has no adapter path behind it — it's a
// pure view over its parent's already-fetched children — so it toggles treeState.expanded
// directly rather than going through expand()/collapse(), which would connect the connection and
// issue an IPC call for a synthetic path no adapter has ever heard of.
function onToggle(row: TreeRowVm): void {
  if (row.kind === 'group') {
    toggleGroup(row.connectionId, row.path);
    return;
  }
  if (row.expanded) collapse(row.connectionId, row.path);
  else void expand(row.connectionId, row.path);
}

// Task 62: double-clicking a tree row that already has an open tab for the same
// (connectionId, path) used to just refocus it — no refetch. A freshly created tab is about to
// fetch on mount anyway, so only the reused case needs an explicit reload here.
function onOpen(row: TreeRowVm): void {
  // A group folder only ever toggles on double-click — it opens nothing (P19 D4).
  if (row.kind === 'group') {
    toggleGroup(row.connectionId, row.path);
    return;
  }
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

const TREE_SHORTCUTS = [
  'tree.open',
  'tree.copyName',
  'tree.copyUri',
  'tree.rename',
  'tree.duplicate',
  'tree.delete',
] as const;

// P21 D6/D9: fires only while a tree row holds real DOM focus (the roving tabindex TreeRow.vue
// already sets) — this is a descendant of ProjectPanel's own type-ahead keydown handler, so it
// runs first on the bubble path, and every key it claims (Enter, a Cmd/Ctrl combo, F2, Delete) is
// one the type-ahead handler already ignores (its own single-printable-character guard).
function onTreeKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, textarea, [contenteditable="true"]')) return;
  const id = shortcutFor(e, TREE_SHORTCUTS);
  if (!id) return;
  const row = visibleRows.value.find((r) => r.key === treeState.selected);
  if (!row) return;
  if (id === 'tree.open') {
    // Enter is the row's primary action, not a menu item — the same action double-click
    // performs, so it dispatches directly rather than through runMenuShortcut.
    e.preventDefault();
    onOpen(row);
    return;
  }
  if (runMenuShortcut(menuForRow(row), id)) e.preventDefault();
}
</script>

<template>
  <div class="project-tree">
    <div
      class="tree-body"
      data-testid="tree-background"
      @contextmenu.prevent="onBackgroundContextMenu"
      @keydown="onTreeKeydown"
    >
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
    <div
      v-if="searchIncomplete"
      class="p-strip note search-incomplete-note"
      data-testid="search-incomplete-note"
    >
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

/* P24 D34: reuses .p-strip.note (primitives.css) for padding/font-size/colour/background — this
   note sits at the bottom of the tree, so its divider flips to the top edge, opposite .p-strip's
   own default. */
.search-incomplete-note {
  border-top: var(--kira-border-width) solid var(--kira-border);
  border-bottom: none;
}
</style>
