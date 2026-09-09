<script setup lang="ts">
/**
 * `docs/plans/P5.md` W11: composes `CommitMeta.vue` (twice — see its own doc comment on why) and
 * `FileTree.vue` over one `DetailState`, replacing `App.vue`'s P4 placeholder block.
 *
 * G21 D12 (item 12): no longer also composes `DiffView.vue` — the graph panel opens VS Code's own
 * native diff editor now, exactly like the review panel already did since G12 D12. A file row's
 * `openFile` emit (D13: a click/arrow-key move previews, a double click/`Enter` pins) is wired
 * straight to `actions.openInEditor`; `DetailState` no longer owns a `mode`/`diff` to drive, so
 * this component no longer needs the breakpoint-aware "diff takes over the pane" layout its own
 * doc comment used to describe, nor the focus-return dance a mode flip used to need.
 *
 * Does not call `detailState.select` itself for a parent-commit pick (`CommitMeta.vue`'s own
 * `selectParentCommit` emit) — that emit only bubbles further up, to `App.vue`, which also owns
 * `SelectionState` and the grid ref neither this component nor `DetailState` has access to; a
 * parent commit whose row is already loaded needs the grid's own selection/scroll updated to
 * match, exactly as a normal row click would, and only `App.vue` can do that.
 */
import type { CommitStore } from '@kira/git-core';
import { computed } from 'vue';
import type { DetailState } from '../state/detail.ts';
import type { DetailActions } from '../state/detailActions.ts';
import type { PrState } from '../state/pr.ts';
import CommitMeta from './CommitMeta.vue';
// A .vue default export is a *value* — the component object the template instantiates. `import
// type` erases it, and Vue then renders <FileTree> as an unknown element with nothing inside it
// (G14 F1/F3).
import FileTree from './FileTree.vue';

const props = defineProps<{
  detailState: DetailState;
  store: CommitStore;
  actions: DetailActions;
  /** G24 D12: optional so a caller with nothing to show yet (mirrors `CommitGrid.vue`'s own `pr`
   *  prop) gets a detail pane with no "Pull request" row at all — `CommitMeta.vue`'s own
   *  `prDetail` computed already treats `undefined` the same as `disabled`. */
  pr?: PrState;
}>();

const emit = defineEmits<(e: 'selectParentCommit', sha: string) => void>();

const detail = computed(() => props.detailState.detail.value);

function onSelectParentCommit(sha: string): void {
  emit('selectParentCommit', sha);
}

/** G21 D12/D13: the tree's own `openFile` emit — `props.actions.openInEditor({ sha, path,
 *  originalPath, parentIndex })`, exactly the shape D12's own plan names. `pinned` comes straight
 *  from the emit: a click/arrow-key move is `false` (navigational), a double click/`Enter` is
 *  `true`. */
function onOpenFile(index: number, pinned: boolean): void {
  const file = detail.value?.files[index];
  if (!file) return;
  void props.actions.openInEditor({
    sha: props.detailState.sha.value ?? '',
    path: file.path,
    originalPath: file.originalPath,
    parentIndex: props.detailState.parentIndex.value,
    pinned,
  });
}
</script>

<template>
  <div class="kv-detail-pane">
    <p v-if="detailState.error.value" class="kv-detail-pane-error">
      Couldn't load this commit — {{ detailState.error.value }}
    </p>

    <template v-if="detail">
      <CommitMeta
        section="message"
        :detail="detail"
        :store="store"
        :actions="actions"
        @select-parent-commit="onSelectParentCommit"
      />
      <FileTree
        class="kv-detail-pane-tree"
        :files="detail.files"
        :selected-file="detailState.selectedFile.value"
        :list-mode="detailState.listMode.value"
        :filter="detailState.filter.value"
        :parents="detail.parents"
        :parent-index="detailState.parentIndex.value"
        :store="store"
        :actions="actions"
        @select-file="detailState.selectFile($event)"
        @open-file="onOpenFile"
        @update:list-mode="detailState.setListMode($event)"
        @update:filter="detailState.setFilter($event)"
        @update:parent-index="detailState.setParentIndex($event)"
      />
      <CommitMeta
        section="details"
        :detail="detail"
        :store="store"
        :actions="actions"
        :pr-result="pr?.selected.value"
        @select-parent-commit="onSelectParentCommit"
      />
    </template>

    <p v-else-if="!detailState.error.value" class="kv-detail-pane-loading">Loading…</p>
  </div>
</template>

<style>
.kv-detail-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.kv-detail-pane-tree {
  border-top: 1px solid var(--kv-panel-border);
  border-bottom: 1px solid var(--kv-panel-border);
}

.kv-detail-pane-error {
  margin: 0;
  padding: var(--kv-space-4);
  color: var(--kv-error-fg);
}

.kv-detail-pane-loading {
  margin: 0;
  padding: var(--kv-space-4);
  color: var(--kv-description-fg);
}
</style>
