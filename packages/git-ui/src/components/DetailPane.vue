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
 * G-UX (items 6/7): the pane is subject + files now — `CommitMeta.vue`'s own `selectParentCommit`
 * emit (and this component's own forwarding of it) is gone along with the Parent row itself; the
 * graph's own edges are how you reach a parent. `CommitMeta` used to mount twice here (message
 * above the tree, a second "details" instance for Refs/Signature/PR below it, each with its own
 * scroll cap) — it is a single instance now, folding all of that behind one "Show more" region, so
 * nothing renders stranded below the file tree any more. The collapsed-state proportion is
 * enforced the same way as before: `CommitMeta.vue`'s own root is `kv:flex-none` with a `max-height`
 * cap (a bounded `%` of the pane's own height, not of the viewport — P110 A14 moved the cap and its
 * `expanded` variant fully into `CommitMeta.vue` itself, since only it knows that state), and
 * `<FileTree>` here is `kv:flex-auto` and takes the remainder.
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

const detail = computed(() => props.detailState.detail.value);

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
  <div class="kv-detail-pane kv:flex kv:flex-col kv:min-h-0 kv:h-full">
    <p v-if="detailState.error.value" class="kv:m-0 kv:p-3 kv:text-error">
      Couldn't load this commit — {{ detailState.error.value }}
    </p>

    <template v-if="detail">
      <CommitMeta
        :detail="detail"
        :actions="actions"
        :pr-result="pr?.selected.value"
        :pr-for-commit="pr?.prForCommit(detailState.sha.value ?? '')"
      />
      <FileTree
        class="kv-detail-pane-tree kv:flex-auto kv:min-h-0 kv:border-y kv:border-panel-border"
        :files="detail.files"
        :selected-file="detailState.selectedFile.value"
        :list-mode="detailState.listMode.value"
        :filter="detailState.filter.value"
        :parents="detail.parents"
        :parent-index="detailState.parentIndex.value"
        :store="store"
        :actions="actions"
        :sha="detailState.sha.value ?? undefined"
        @select-file="detailState.selectFile($event)"
        @open-file="onOpenFile"
        @update:list-mode="detailState.setListMode($event)"
        @update:filter="detailState.setFilter($event)"
        @update:parent-index="detailState.setParentIndex($event)"
      />
    </template>

    <p v-else-if="!detailState.error.value" class="kv:m-0 kv:p-3 kv:text-muted-foreground">Loading…</p>
  </div>
</template>
