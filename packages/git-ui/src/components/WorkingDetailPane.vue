<script setup lang="ts">
/**
 * P7 (item 2): the uncommitted-changes strip's own click-through target — `DetailPane.vue`'s
 * sibling for the one case that pane can never represent (the working tree is not a commit: no
 * sha, no author, no parents). Deliberately NOT a mode of `DetailPane.vue` itself — that pane's
 * other half, `CommitMeta.vue`, has nothing to show here (every field it renders is commit-only),
 * so bolting an `undefined`-heavy commit shape onto it would cost more than this small, dedicated
 * pane does. `store`/`actions` are threaded straight through from whatever mounts this (`App.vue`),
 * the exact same instances `DetailPane.vue`/`StashDetailPane.vue` already use — `FileTree.vue`
 * only ever reads `actions.copy`/`actions.announce`/`actions.capabilities` from them (never
 * `openInEditor`/`openAllChanges`, both commit-shaped), so sharing the instance costs nothing and
 * keeps "copy path"/announcements consistent across every pane in the app.
 */
import type { CommitStore, FileChangeKind } from '@kira/git-core';
import { computed } from 'vue';
import type { DetailActions } from '../state/detailActions.ts';
import type { WorkingDetailState } from '../state/working.ts';
import FileTree from './FileTree.vue';

const props = defineProps<{
  workingState: WorkingDetailState;
  store: CommitStore;
  actions: DetailActions;
  /** Calls `editor.openWorkingDiff` — kept as a narrow callback prop, not a widening of
   *  `DetailActions` (whose `openInEditor` is shaped for a commit's sha/parentIndex, neither of
   *  which the working tree has). */
  openFile: (params: {
    path: string;
    originalPath: string | undefined;
    status: FileChangeKind;
    pinned: boolean;
  }) => Promise<void>;
}>();

const files = computed(() => props.workingState.files.value);

function onOpenFile(index: number, pinned: boolean): void {
  const file = files.value[index];
  if (!file) return;
  void props.openFile({
    path: file.path,
    originalPath: file.originalPath,
    status: file.kind,
    pinned,
  });
}
</script>

<template>
  <div class="kv-working-detail-pane">
    <div class="kv-working-detail-pane-header">Uncommitted Changes</div>
    <p v-if="workingState.error.value" class="kv-working-detail-pane-error">
      Couldn't load uncommitted changes — {{ workingState.error.value }}
    </p>
    <FileTree
      v-else
      class="kv-working-detail-pane-tree"
      :files="files"
      :selected-file="workingState.selectedFile.value"
      :list-mode="workingState.listMode.value"
      :filter="workingState.filter.value"
      :parents="[]"
      :parent-index="0"
      :store="store"
      :actions="actions"
      @select-file="workingState.selectFile($event)"
      @open-file="onOpenFile"
      @update:list-mode="workingState.setListMode($event)"
      @update:filter="workingState.setFilter($event)"
    />
  </div>
</template>

<style>
.kv-working-detail-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.kv-working-detail-pane-header {
  flex: 0 0 auto;
  padding: var(--kv-s-5);
  font-weight: 600;
  border-bottom: 1px solid var(--kv-panel-border);
}

.kv-working-detail-pane-tree {
  flex: 1 1 auto;
  min-height: 0;
}

.kv-working-detail-pane-error {
  margin: 0;
  padding: var(--kv-s-5);
  color: var(--kv-error-fg);
}
</style>
