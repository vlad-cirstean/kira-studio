<script setup lang="ts">
import { useEventListener } from '@vueuse/core';
import { shortcutFor } from '@workbench/shortcuts/keys';
import { runMenuShortcut, useContextMenuStore } from '@workbench/state/contextMenu';
import { useTreeVirtualRows } from '@workbench/util/treeVirtualRows';
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue';
import { useConnectionsStore } from '../state/connections';
import { useSchemaColumnsStore } from '../state/schemaColumns';
import { initSchemaSync } from '../state/schemas';
import { useSettingsStore } from '../state/settings';
import { useTabsStore } from '../state/tabs';
import { reloadTab } from '../state/viewCommands';
import { emptyBackgroundMenu, menuForRow } from './menus';
import { type TreeRowVm, useTreeStore } from './state/tree';
import TreeRow from './TreeRow.vue';

const contextMenuStore = useContextMenuStore();
const schemaColumnsStore = useSchemaColumnsStore();
const connectionsStore = useConnectionsStore();
const tabsStore = useTabsStore();
const settingsStore = useSettingsStore();
const treeStore = useTreeStore();

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
// P41 D17: a redis `database` / s3 `bucket` row, on a connection whose caps say its key space is
// unbounded — double-click/Enter opens a Browse tab instead of the ordinary expand/collapse
// toggle. Gated on the capability, never the row kind alone (`database` is shared by six engines
// that stay expand-only, F13) or the connection kind (Caps is the only thing the UI reads, ARCHITECTURE.md).
function isKeyBrowserRow(row: TreeRowVm): boolean {
  if (row.kind !== 'database' && row.kind !== 'bucket') return false;
  return connectionsStore.states[row.connectionId]?.caps?.keyBrowser === true;
}

const rowHeight = computed(() => (settingsStore.appearance.rowDensity === 'compact' ? 22 : 28));

// P104 §3.4: TreeHost's own recipe (virtualization + pinned ancestor band + reveal-scroll),
// inlined via the shared useTreeVirtualRows composable rather than kept as a wrapper component.
const scrollEl = ref<HTMLElement | null>(null);
const { virtualItems, totalSize, band, onScroll, revealKey } = useTreeVirtualRows({
  rows: () => treeStore.visibleRows,
  rowHeight: () => rowHeight.value,
  scrollElement: scrollEl,
});

onMounted(() => {
  treeStore.initTreeSync();
  initSchemaSync();
  schemaColumnsStore.initSchemaColumnsSync();
});

// revealPath() (Step 7b) sets pendingScrollKey once its expansion/selection work is done;
// scrolling happens here, one tick later, once treeStore.visibleRows reflects the newly expanded
// nodes — revealKey() does the animation-frame wait, the index lookup and the band-inset scroll.
watch(
  () => treeStore.pendingScrollKey,
  async (key) => {
    if (!key) return;
    treeStore.pendingScrollKey = null;
    await revealKey(key);
  },
);

function onSelect(row: TreeRowVm): void {
  treeStore.selectRow(row.key);
}

// The twisty always expands/collapses. A group row (P19) has no adapter path behind it — it's a
// pure view over its parent's already-fetched children — so it toggles treeStore.expanded
// directly rather than going through treeStore.expand()/treeStore.collapse(), which would connect the connection and
// issue an IPC call for a synthetic path no adapter has ever heard of.
function onToggle(row: TreeRowVm): void {
  if (row.kind === 'group') {
    treeStore.toggleGroup(row.connectionId, row.path);
    return;
  }
  if (row.expanded) treeStore.collapse(row.connectionId, row.path);
  else void treeStore.expand(row.connectionId, row.path);
}

// Task 62: double-clicking a tree row that already has an open tab for the same
// (connectionId, path) used to just refocus it — no refetch. A freshly created tab is about to
// fetch on mount anyway, so only the reused case needs an explicit reload here.
function onOpen(row: TreeRowVm): void {
  // A group folder only ever toggles on double-click — it opens nothing (P19 D4).
  if (row.kind === 'group') {
    treeStore.toggleGroup(row.connectionId, row.path);
    return;
  }
  if (OPENABLE_KINDS.has(row.kind)) {
    const { id, reused } = tabsStore.openDataTab(row.connectionId, row.path);
    if (reused) reloadTab('data', id);
    return;
  }
  if (DOCUMENT_OPENABLE_KINDS.has(row.kind)) {
    const { id, reused } = tabsStore.openDocumentTab(row.connectionId, row.path);
    if (reused) reloadTab('document', id);
    return;
  }
  if (KEYVALUE_OPENABLE_KINDS.has(row.kind)) {
    const { id, reused } = tabsStore.openKeyValueTab(row.connectionId, row.path);
    if (reused) reloadTab('keyvalue', id);
    return;
  }
  if (STREAM_OPENABLE_KINDS.has(row.kind)) {
    const { id, reused } = tabsStore.openStreamTab(row.connectionId, row.path);
    if (reused) reloadTab('stream', id);
    return;
  }
  if (isKeyBrowserRow(row)) {
    const { id, reused } = tabsStore.openBrowseTab(row.connectionId, row.path);
    if (reused) reloadTab('browse', id);
    return;
  }
  // A childless, non-openable leaf (column, index) has nothing to open or expand — TreeRow.vue
  // now emits 'open' unconditionally (P9 fix), so this guard is what keeps dblclick a no-op there.
  if (!row.hasChildren) return;
  if (row.expanded) treeStore.collapse(row.connectionId, row.path);
  else void treeStore.expand(row.connectionId, row.path);
}

async function onContextMenu(row: TreeRowVm, event: MouseEvent): Promise<void> {
  // The "Saved filters ▸" submenu (Step 13) is built synchronously by menuForRow() from
  // treeStore.savedQueries, so it must already be populated by the time the menu opens.
  if (OPENABLE_KINDS.has(row.kind)) await treeStore.loadSavedQueries(row.connectionId, row.path);
  contextMenuStore.openContextMenu(event, menuForRow(row));
}

function onBackgroundContextMenu(event: MouseEvent): void {
  // TreeRow.vue stops propagation on its own contextmenu handler, so only a right-click on
  // the empty area below/around the rows (the virtual list's spacer divs) ever reaches here.
  event.preventDefault();
  contextMenuStore.openContextMenu(event, emptyBackgroundMenu());
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
  const row = treeStore.visibleRows.find((r) => r.key === treeStore.selected);
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

// P105 §5.1: the tree background has no interactive role of its own -- both listeners bind here
// via VueUse rather than as raw template attributes on a non-interactive div.
const treeBodyEl = useTemplateRef<HTMLElement>('treeBodyEl');
useEventListener(treeBodyEl, 'contextmenu', onBackgroundContextMenu);
useEventListener(scrollEl, 'keydown', onTreeKeydown);
</script>

<template>
  <div class="project-tree">
    <div ref="treeBodyEl" class="tree-body" data-testid="tree-background">
      <div
        ref="scrollEl"
        class="virtual-list h-full overflow-auto"
        data-testid="virtual-list"
        role="tree"
        aria-label="Project tree"
        @scroll="onScroll"
      >
        <div class="virtual-list-sticky sticky top-0 z-2 h-0" data-testid="tree-sticky-band">
          <template v-for="slot in band" :key="slot.row.key">
            <TreeRow
              class="sticky-row"
              :style="{ top: `${slot.top}px`, height: `${rowHeight}px` }"
              :row="slot.row"
              :selected="treeStore.selected === slot.row.key"
              :sticky="true"
              @select="onSelect"
              @toggle="onToggle"
              @open="onOpen"
              @contextmenu="onContextMenu"
            />
          </template>
        </div>
        <div :style="{ height: `${totalSize}px`, position: 'relative' }">
          <template v-for="item in virtualItems" :key="String(item.key)">
            <TreeRow
              class="virtual-row"
              :style="{ transform: `translateY(${item.start}px)`, height: `${item.size}px` }"
              :row="treeStore.visibleRows[item.index]"
              :selected="treeStore.selected === treeStore.visibleRows[item.index].key"
              :sticky="false"
              @select="onSelect"
              @toggle="onToggle"
              @open="onOpen"
              @contextmenu="onContextMenu"
            />
          </template>
        </div>
      </div>
    </div>
    <div
      v-if="treeStore.searchIncomplete"
      class="p-strip note search-incomplete-note"
      data-testid="search-incomplete-note"
    >
      Searching cached nodes only — expand more of the tree to include it.
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.project-tree {
  @apply h-full flex flex-col min-h-0;
}

.tree-body {
  @apply flex-1 min-h-0;
}

/* Positioned relative to the zero-height .virtual-list-sticky (itself position: sticky), which is
   what makes each row's `top` (stickyBand.ts's own output) land correctly without this component
   needing to know anything about the scrollport (P28 D2). A row here is opaque and full-width so
   it fully occludes whatever real row has scrolled up behind it. */
.sticky-row {
  @apply absolute left-0 right-0 z-1;
  background: var(--kira-bg);
}

.virtual-row {
  @apply absolute top-0 left-0 w-full;
}

/* P24 D34: reuses .p-strip.note (primitives.css) for padding/font-size/colour/background — this
   note sits at the bottom of the tree, so its divider flips to the top edge, opposite .p-strip's
   own default. */
.search-incomplete-note {
  @apply border-b-0;
  border-top: var(--kira-border-width) solid var(--kira-border);
}
</style>
