<script setup lang="ts">
import { computed, ref } from 'vue';
import { copyText } from '../clipboard';
import { shortcutFor } from '../shortcuts/keys';
import { confirmDialog } from '../state/confirmDialog';
import { openContextMenu, runMenuShortcut } from '../state/contextMenu';
import { settingsState } from '../state/settings';
import { openCollectionRequestTab } from '../state/tabs';
import TreeHost from '../theme/primitives/TreeHost.vue';
import CollectionRow from './CollectionRow.vue';
import { backgroundMenu, type CollectionMenuActions, menuForRow } from './menus';
import {
  beginRename,
  type CollectionRowVm,
  cancelRename,
  collapseRow,
  collectionsState,
  createCollection,
  createItem,
  deleteRow,
  duplicateRow,
  expandRow,
  exportCollection,
  fetchSavedRequest,
  importCollection,
  renameRow,
  selectRow,
  toggleRow,
  visibleRows,
} from './state/collections';
import { openDynamicValuesDialog } from './state/dynamicValues';
import { openEnvironmentsDialog, openVariablesDialog } from './state/variables';

// P4 D13: a real TreeHost consumer, with **not one line of tree mechanics** of its own —
// virtualization, the pinned ancestor band and reveal-scroll all live in the primitive P1 factored
// out for exactly this. If any of TreeHost's props turned out to need widening here, that would be
// a signal the row model was wrong; none did.
const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));
const treeHostRef = ref<{ revealKey: (key: string) => Promise<void> } | null>(null);

/** Called by the panel after a mutation adds a row worth scrolling to. */
async function reveal(key: string): Promise<void> {
  await treeHostRef.value?.revealKey(key);
}
defineExpose({ reveal });

function onSelect(row: CollectionRowVm): void {
  selectRow(row.key);
}

// The twisty always expands/collapses; unlike Studio's tree there is no adapter call behind it and
// no synthetic group row to special-case (F15) — the whole tree is already in memory.
function onToggle(row: CollectionRowVm): void {
  toggleRow(row);
}

// A collection and a folder toggle on double-click; a request opens into the existing
// 'http-request' tab kind (D14), reusing an already-open tab bound to the same row.
async function onOpen(row: CollectionRowVm): Promise<void> {
  if (row.kind !== 'request') {
    toggleRow(row);
    return;
  }
  const saved = await fetchSavedRequest(row.id);
  openCollectionRequestTab(row.id, row.name, saved);
}

// The menu is a description (menus.ts) and this is the one place that knows how to perform any of
// it — so the actions are injected rather than imported there, which also keeps that module free
// of both the store's mutation half and the tab-opening path.
const actions: CollectionMenuActions = {
  open: (row) => void onOpen(row),
  newRequest: (row) => void createItem(row.collectionId, folderTarget(row), 'request'),
  newFolder: (row) => void createItem(row.collectionId, folderTarget(row), 'folder'),
  newCollection: () => void createCollection(),
  rename: beginRename,
  duplicate: (row) => void duplicateRow(row),
  remove: (row) => void confirmAndDelete(row),
  copyUrl: (row) => void copyText(row.url),
  importCollection: () => void importCollection(),
  exportCollection: (row) => void exportCollection(row.id, row.name),
  variables: (row) => void openVariablesDialog('collection', row.id, `Variables — ${row.name}`),
  environments: () => openEnvironmentsDialog(),
  dynamicValues: () => openDynamicValuesDialog(),
};

/** Creating *into* a collection row means the root; into a folder row means that folder. */
function folderTarget(row: CollectionRowVm): string | null {
  return row.kind === 'collection' ? null : row.id;
}

async function confirmAndDelete(row: CollectionRowVm): Promise<void> {
  const what = row.kind === 'collection' ? 'collection' : row.kind;
  // A folder and a collection take their whole subtree with them (the migration's own cascade),
  // which the prompt says out loud rather than leaving to be discovered.
  const suffix = row.kind === 'request' ? '' : ' and everything inside it';
  if (!(await confirmDialog(`Delete ${what} "${row.name}"${suffix}?`))) return;
  await deleteRow(row);
}

function onContextMenu(row: CollectionRowVm, event: MouseEvent): void {
  selectRow(row.key);
  openContextMenu(event, menuForRow(row, actions));
}

function onBackgroundContextMenu(event: MouseEvent): void {
  openContextMenu(event, backgroundMenu(actions));
}

function onRename(row: CollectionRowVm, name: string): void {
  void renameRow(row, name);
}

// The same shape ProjectTree.vue has, over the existing tree.* shortcut ids (§3) — plus the
// arrow keys, which are collapse/expand rather than a menu action and so dispatch directly.
function onTreeKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, textarea, [contenteditable="true"]')) return;
  const row = visibleRows.value.find((r) => r.key === collectionsState.selected);
  if (!row) return;

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    expandRow(row);
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    collapseRow(row);
    return;
  }
  // Enter is the row's primary action, not a menu item — the same action double-click performs,
  // so it dispatches directly rather than through runMenuShortcut (ProjectTree.vue's own split).
  const id = shortcutFor(e, TREE_SHORTCUTS);
  if (!id) return;
  if (id === 'tree.open') {
    e.preventDefault();
    void onOpen(row);
    return;
  }
  // Everything else dispatches through the same menu builder a right-click would call, so the
  // printed shortcut and the executed action are the same object and `disabled` gating is
  // honoured for free (state/contextMenu.ts's own reasoning for runMenuShortcut).
  if (runMenuShortcut(menuForRow(row, actions), id)) e.preventDefault();
}

const TREE_SHORTCUTS = ['tree.open', 'tree.rename', 'tree.delete', 'tree.duplicate'] as const;
</script>

<template>
  <TreeHost
    ref="treeHostRef"
    class="collections-tree"
    :rows="visibleRows"
    :row-height="rowHeight"
    :selected-key="collectionsState.selected"
    @background-contextmenu="onBackgroundContextMenu"
    @keydown="onTreeKeydown"
  >
    <template #row="{ row, sticky, top }">
      <CollectionRow
        :class="{ 'sticky-row': sticky }"
        :style="sticky ? { top: `${top}px`, height: `${rowHeight}px` } : undefined"
        :row="row"
        :selected="collectionsState.selected === row.key"
        :sticky="sticky"
        @select="onSelect"
        @toggle="onToggle"
        @open="onOpen"
        @contextmenu="onContextMenu"
        @rename="onRename"
        @cancel-rename="cancelRename"
      />
    </template>
  </TreeHost>
</template>

<style scoped>
.collections-tree {
  height: 100%;
}

/* Positioned relative to VirtualList's own zero-height .virtual-list-sticky, exactly as
   ProjectTree.vue's own sticky row is — opaque and full-width so it fully occludes whatever real
   row has scrolled up behind it. */
.sticky-row {
  position: absolute;
  left: 0;
  right: 0;
  background: var(--kira-bg);
  z-index: 1;
}
</style>
