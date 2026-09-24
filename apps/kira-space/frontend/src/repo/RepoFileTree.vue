<script setup lang="ts">
import { useDebounceFn, useEventListener } from '@vueuse/core';
import { useContextMenuStore } from '@workbench/state/contextMenu';
import { useTreeVirtualRows } from '@workbench/util/treeVirtualRows';
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { openRepoFileTab } from '../state/repoTabs';
import { useSettingsStore } from '../state/settings';
import { menuForRepoRow } from './menus';
import RepoTreeRow from './RepoTreeRow.vue';
import { type RepoTreeRowVm, useFileTreeStore } from './state/fileTree';

const contextMenuStore = useContextMenuStore();
const fileTreeStore = useFileTreeStore();
const settingsStore = useSettingsStore();

const props = defineProps<{ repoId: string; search: string }>();

const rowHeight = computed(() => (settingsStore.appearance.rowDensity === 'compact' ? 22 : 28));
const selected = ref<string | null>(null);

onMounted(() => fileTreeStore.ensureRepoTreeLoaded(props.repoId));
watch(
  () => props.repoId,
  (id) => fileTreeStore.ensureRepoTreeLoaded(id),
);

// C13-6d: project/state/tree.ts's own debounce for the Studio schema tree's identical shape of
// problem — the input itself (PanelShell's own model-value, bound above props.search) stays
// instantly responsive, only the expensive filter recompute (a full tree walk, §7.2) waits for
// typing to settle. 150ms matches that precedent. Measured (200k files, the cap): 538ms per
// keystroke reactive vs 200ms plain filter cost — debouncing turns "every keystroke pays this"
// into "one pause pays this", which is what actually fixes the perceived lag.
const SEARCH_DEBOUNCE_MS = 150;
const debouncedSearch = ref(props.search);
// SchemaDialog.vue's own useDebounceFn precedent (Part 2) — cancel() in onUnmounted/the repoId
// watch replaces the clearTimeout below.
const applySearchDebounced = useDebounceFn((value: string) => {
  debouncedSearch.value = value;
}, SEARCH_DEBOUNCE_MS);
watch(
  () => props.search,
  (value) => {
    void applySearchDebounced(value);
  },
);
// A workspace/repo switch must not show the new repo's tree filtered by a stale debounce timer
// still counting down from the previous one.
watch(
  () => props.repoId,
  () => {
    applySearchDebounced.cancel();
    debouncedSearch.value = props.search;
  },
);
onUnmounted(() => applySearchDebounced.cancel());

const rows = computed(() => fileTreeStore.visibleRepoRows(props.repoId, debouncedSearch.value));

const scrollEl = ref<HTMLElement | null>(null);
const { virtualItems, totalSize, band, onScroll } = useTreeVirtualRows({
  rows: () => rows.value,
  rowHeight: () => rowHeight.value,
  scrollElement: scrollEl,
});

function onSelect(row: RepoTreeRowVm): void {
  selected.value = row.key;
}

function onToggle(row: RepoTreeRowVm): void {
  fileTreeStore.toggleRepoDir(props.repoId, row.path);
}

// §7.2: single click (row's own onClick) opens a preview tab, double click/Enter a permanent one
// — RepoTreeRow.vue emits `open` with the `preview` flag already resolved.
function onOpen(row: RepoTreeRowVm, preview: boolean): void {
  if (row.isDir) return;
  void openRepoFileTab(props.repoId, row.path, { preview });
}

function onContextMenu(row: RepoTreeRowVm, event: MouseEvent): void {
  contextMenuStore.openContextMenu(event, menuForRepoRow(props.repoId, row));
}

// P105 §5.1: suppresses the browser context menu over the empty tree background (rows stop
// propagation on their own contextmenu handler) -- the tree background has no interactive role.
const treeBodyEl = useTemplateRef<HTMLElement>('treeBodyEl');
useEventListener(treeBodyEl, 'contextmenu', (e) => e.preventDefault());
</script>

<template>
  <div ref="treeBodyEl" class="repo-tree-body" data-testid="tree-background">
    <div
      ref="scrollEl"
      class="virtual-list h-full overflow-auto"
      data-testid="virtual-list"
      role="tree"
      aria-label="Repository files"
      @scroll="onScroll"
    >
      <div class="sticky top-0 z-2 h-0" data-testid="tree-sticky-band">
        <template v-for="slot in band" :key="slot.row.key">
          <RepoTreeRow
            class="sticky-row"
            :style="{ top: `${slot.top}px`, height: `${rowHeight}px` }"
            :row="slot.row"
            :selected="selected === slot.row.key"
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
          <RepoTreeRow
            class="virtual-row"
            :style="{ transform: `translateY(${item.start}px)`, height: `${item.size}px` }"
            :row="rows[item.index]"
            :selected="selected === rows[item.index].key"
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
</template>

<style scoped>
@reference "@theme/base.css";

.repo-tree-body {
  @apply h-full;
}

/* P110 B34: `.sticky-row`/`.virtual-row` moved to base.css's own `@utility` pair (shared
   duplicates across CollectionsTree/ProjectTree/RepoFileTree and 9 virtualized-row files
   respectively). */
</style>
