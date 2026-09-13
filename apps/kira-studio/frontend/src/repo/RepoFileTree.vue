<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { openContextMenu } from '../state/contextMenu';
import { openRepoFileTab } from '../state/repoTabs';
import { settingsState } from '../state/settings';
import TreeHost from '../theme/primitives/TreeHost.vue';
import { menuForRepoRow } from './menus';
import RepoTreeRow from './RepoTreeRow.vue';
import {
  ensureRepoTreeLoaded,
  type RepoTreeRowVm,
  toggleRepoDir,
  visibleRepoRows,
} from './state/fileTree';

const props = defineProps<{ repoId: string; search: string }>();

const rowHeight = computed(() => (settingsState.appearance.rowDensity === 'compact' ? 22 : 28));
const selected = ref<string | null>(null);

onMounted(() => ensureRepoTreeLoaded(props.repoId));
watch(
  () => props.repoId,
  (id) => ensureRepoTreeLoaded(id),
);

const rows = computed(() => visibleRepoRows(props.repoId, props.search));

function onSelect(row: RepoTreeRowVm): void {
  selected.value = row.key;
}

function onToggle(row: RepoTreeRowVm): void {
  toggleRepoDir(props.repoId, row.path);
}

// §7.2: single click (row's own onClick) opens a preview tab, double click/Enter a permanent one
// — RepoTreeRow.vue emits `open` with the `preview` flag already resolved.
function onOpen(row: RepoTreeRowVm, preview: boolean): void {
  if (row.isDir) return;
  void openRepoFileTab(props.repoId, row.path, { preview });
}

function onContextMenu(row: RepoTreeRowVm, event: MouseEvent): void {
  openContextMenu(event, menuForRepoRow(props.repoId, row));
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
.repo-tree-body {
  height: 100%;
}

.sticky-row {
  position: absolute;
  left: 0;
  right: 0;
  background: var(--kira-bg);
  z-index: 1;
}
</style>
