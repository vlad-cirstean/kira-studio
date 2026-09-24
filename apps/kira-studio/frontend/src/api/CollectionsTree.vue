<script setup lang="ts">
import { defaultGrpcSavedRequest, defaultHttpSavedRequest } from '@shared/domain/collections';
import { useEventListener } from '@vueuse/core';
import { shortcutFor } from '@workbench/shortcuts/keys';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { runMenuShortcut, useContextMenuStore } from '@workbench/state/contextMenu';
import { copyText } from '@workbench/util/clipboard';
import { useTreeVirtualRows } from '@workbench/util/treeVirtualRows';
import { computed, ref, useTemplateRef } from 'vue';
import { useSettingsStore } from '../state/settings';
import CollectionRow from './CollectionRow.vue';
import { backgroundMenu, type CollectionMenuActions, menuForRow } from './menus';
import { loadSavedGrpcRequest, loadSavedRequest } from './state/apiQueries';
import { type CollectionRowVm, useCollectionsStore } from './state/collections';
import { useImportCurlStore } from './state/curl';
import { useDynamicValuesStore } from './state/dynamicValues';
import { useVariablesStore } from './state/variables';
import { openCollectionGrpcRequestTab, openCollectionRequestTab, openVariableSetTab } from './tabs';

const confirmDialogStore = useConfirmDialogStore();
const contextMenuStore = useContextMenuStore();
const dynamicValuesStore = useDynamicValuesStore();
const collectionsStore = useCollectionsStore();
const importCurlStore = useImportCurlStore();
const variablesStore = useVariablesStore();
const settingsStore = useSettingsStore();

// P104 §3.4: TreeHost's own recipe (virtualization + the pinned ancestor band + reveal-scroll),
// inlined via the shared useTreeVirtualRows composable rather than kept as a wrapper component —
// the same swap ProjectTree.vue's own call site already made.
const rowHeight = computed(() => (settingsStore.appearance.rowDensity === 'compact' ? 22 : 28));
const scrollEl = ref<HTMLElement | null>(null);
const { virtualItems, totalSize, band, onScroll, revealKey } = useTreeVirtualRows({
  rows: () => collectionsStore.visibleRows,
  rowHeight: () => rowHeight.value,
  scrollElement: scrollEl,
});

/** Called by the panel after a mutation adds a row worth scrolling to. */
async function reveal(key: string): Promise<void> {
  await revealKey(key);
}
defineExpose({ reveal });

function onSelect(row: CollectionRowVm): void {
  collectionsStore.selectRow(row.key);
}

// The twisty always expands/collapses; unlike Studio's tree there is no adapter call behind it and
// no synthetic group row to special-case (F15) — the whole tree is already in memory.
function onToggle(row: CollectionRowVm): void {
  collectionsStore.toggleRow(row);
}

// A collection and a folder toggle on double-click; a request opens into the existing
// 'http-request' tab kind (D14), reusing an already-open tab bound to the same row.
async function onOpen(row: CollectionRowVm): Promise<void> {
  if (row.kind !== 'request') {
    collectionsStore.toggleRow(row);
    return;
  }
  // P11 D12: a gRPC row opens the 'grpc-request' kind, never 'http-request' — the tree's own
  // protocol column is what tells the two apart, since kind alone (D12's own reasoning) does not.
  // P112: loadSavedRequest/loadSavedGrpcRequest never throw — a row deleted between the tree
  // listing this open and the fetch landing (another window, or this one) answers `null` (D14's
  // orphan case), which opens the tab as if it were a brand-new saved row rather than failing the
  // open outright; the tab's own unresolved/orphan handling (HttpRequestView.vue/
  // GrpcRequestView.vue) takes it from there.
  if (row.protocol === 'grpc') {
    const saved = (await loadSavedGrpcRequest(row.id)) ?? defaultGrpcSavedRequest();
    openCollectionGrpcRequestTab(row.id, row.name, saved);
    return;
  }
  const saved = (await loadSavedRequest(row.id)) ?? defaultHttpSavedRequest();
  openCollectionRequestTab(row.id, row.name, saved);
}

// The menu is a description (menus.ts) and this is the one place that knows how to perform any of
// it — so the actions are injected rather than imported there, which also keeps that module free
// of both the store's mutation half and the tab-opening path.
const actions: CollectionMenuActions = {
  open: (row) => void onOpen(row),
  newRequest: (row) => void collectionsStore.createItem(row.collectionId, folderTarget(row), 'request'),
  newGrpcRequest: (row) => void collectionsStore.createGrpcItem(row.collectionId, folderTarget(row)),
  newFolder: (row) => void collectionsStore.createItem(row.collectionId, folderTarget(row), 'folder'),
  newCollection: () => void collectionsStore.createCollection(),
  rename: collectionsStore.beginRename,
  duplicate: (row) => void collectionsStore.duplicateRow(row),
  remove: (row) => void confirmAndDelete(row),
  copyUrl: (row) => void copyText(row.url),
  importCollection: () => void collectionsStore.importCollection(),
  importCurl: () => importCurlStore.openImportCurlDialog(),
  exportCollection: (row) => void collectionsStore.exportCollection(row.id, row.name),
  variables: (row) => openVariableSetTab('collection', row.id, row.name),
  environments: () => variablesStore.openEnvironments(),
  dynamicValues: () => dynamicValuesStore.openDynamicValuesDialog(),
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
  if (!(await confirmDialogStore.confirmDialog(`Delete ${what} "${row.name}"${suffix}?`))) return;
  await collectionsStore.deleteRow(row);
}

function onContextMenu(row: CollectionRowVm, event: MouseEvent): void {
  collectionsStore.selectRow(row.key);
  contextMenuStore.openContextMenu(event, menuForRow(row, actions));
}

function onBackgroundContextMenu(event: MouseEvent): void {
  event.preventDefault();
  contextMenuStore.openContextMenu(event, backgroundMenu(actions));
}

function onRename(row: CollectionRowVm, name: string): void {
  void collectionsStore.renameRow(row, name);
}

// The same shape ProjectTree.vue has, over the existing tree.* shortcut ids (§3) — plus the
// arrow keys, which are collapse/expand rather than a menu action and so dispatch directly.
function onTreeKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, textarea, [contenteditable="true"]')) return;
  const row = collectionsStore.visibleRows.find((r) => r.key === collectionsStore.selected);
  if (!row) return;

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    collectionsStore.expandRow(row);
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    collectionsStore.collapseRow(row);
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

// P105 §5.1: the tree background has no interactive role of its own -- both listeners bind here
// via VueUse rather than as raw template attributes on a non-interactive div.
const treeBodyEl = useTemplateRef<HTMLElement>('treeBodyEl');
useEventListener(treeBodyEl, 'contextmenu', onBackgroundContextMenu);
useEventListener(scrollEl, 'keydown', onTreeKeydown);
</script>

<template>
  <div class="collections-tree">
    <div ref="treeBodyEl" class="tree-body" data-testid="tree-background">
      <div
        ref="scrollEl"
        class="virtual-list h-full overflow-auto"
        data-testid="virtual-list"
        role="tree"
        aria-label="Collections tree"
        @scroll="onScroll"
      >
        <div class="virtual-list-sticky sticky top-0 z-2 h-0" data-testid="tree-sticky-band">
          <template v-for="slot in band" :key="slot.row.key">
            <CollectionRow
              class="sticky-row"
              :style="{ top: `${slot.top}px`, height: `${rowHeight}px` }"
              :row="slot.row"
              :selected="collectionsStore.selected === slot.row.key"
              :sticky="true"
              @select="onSelect"
              @toggle="onToggle"
              @open="onOpen"
              @contextmenu="onContextMenu"
              @rename="onRename"
              @cancel-rename="collectionsStore.cancelRename"
            />
          </template>
        </div>
        <div :style="{ height: `${totalSize}px`, position: 'relative' }">
          <template v-for="item in virtualItems" :key="String(item.key)">
            <CollectionRow
              class="virtual-row"
              :style="{ transform: `translateY(${item.start}px)`, height: `${item.size}px` }"
              :row="collectionsStore.visibleRows[item.index]"
              :selected="collectionsStore.selected === collectionsStore.visibleRows[item.index].key"
              :sticky="false"
              @select="onSelect"
              @toggle="onToggle"
              @open="onOpen"
              @contextmenu="onContextMenu"
              @rename="onRename"
              @cancel-rename="collectionsStore.cancelRename"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.collections-tree {
  @apply h-full flex flex-col min-h-0;
}

.tree-body {
  @apply flex-1 min-h-0;
}

/* Positioned relative to the zero-height .virtual-list-sticky (position: sticky) -- P110 B34:
   `.sticky-row`/`.virtual-row` moved to base.css's own `@utility` pair (shared duplicates across
   CollectionsTree/ProjectTree/RepoFileTree and 9 virtualized-row files respectively). */
</style>
