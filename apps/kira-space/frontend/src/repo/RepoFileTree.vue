<script setup lang="ts">
import TreeHost from '@theme/primitives/TreeHost.vue';
import { useDebounceFn } from '@vueuse/core';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useContextMenuStore } from '../state/contextMenu';
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
</script>

<template>
  <TreeHost class="repo-tree-body" :rows="rows" :row-height="rowHeight" :selected-key="selected">
    <template #row="{ row, sticky, top }">
      <RepoTreeRow
        :class="{ 'sticky-row': sticky }"
        :style="sticky ? { top: `${top}px`, height: `${rowHeight}px` } : undefined"
        :row="row"
        :selected="selected === row.key"
        :sticky="sticky"
        @select="onSelect"
        @toggle="onToggle"
        @open="onOpen"
        @contextmenu="onContextMenu"
      />
    </template>
  </TreeHost>
</template>

<style scoped>
@reference "@theme/base.css";

.repo-tree-body {
  @apply h-full;
}

.sticky-row {
  @apply absolute left-0 right-0 bg-bg z-1;
}
</style>
