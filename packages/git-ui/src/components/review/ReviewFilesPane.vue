<script setup lang="ts">
/**
 * G11 D16 — the review sidebar's Files pane, and the only new component this phase adds to
 * `packages/git-ui` (which SPEC otherwise freezes). `FileTree` over `ReviewFilesState` instead of
 * `DetailState`: the rebase/squash/amend case SPEC wrote this phase for makes every commit in the
 * Commits tab unfamiliar, so a file-level view of the range is the surface that survives it (F10).
 *
 * G12 D12: selecting a file no longer opens an in-webview `DiffView` — it opens VS Code's native
 * diff editor (`ReviewFilesState.selectFile`'s own `editor.openRangeDiff` call). This component
 * keeps the file list on screen throughout and renders only the Since-review/Full-range toggle
 * and the delta status line as feedback, never a diff body.
 *
 * `FileTree`'s merge-parent picker never renders here (`parents` is always `[]` — a branch review
 * has no single "commit" with parents to pick between); `store` is still required by that
 * component's own props, so `ReviewView.vue` passes its own `PackedStreamState.store` down, unused
 * by anything this pane actually shows. `list-mode`/`filter` are props now (G12 D13) — `ReviewView`
 * owns one toolbar for both the Commits and Files panes, so this component's own toolbar is
 * disabled (`show-toolbar="false"`) rather than duplicated.
 */
import type { CommitStore } from '@kira/git-core';
import type { ReviewDiffMode, ReviewFileStatus } from '@kira/git-ipc';
import type { KuiSegmentedOption } from '@kira/kira-ui';
import { KuiSegmented } from '@kira/kira-ui';
import { computed } from 'vue';
import { ACTION_ICONS } from '../../icons/index.ts';
import type { FileListMode } from '../../state/detail.ts';
import type { DetailActions } from '../../state/detailActions.ts';
import type { ReviewFilesState } from '../../state/reviewFiles.ts';
import FileTree from '../FileTree.vue';

const props = defineProps<{
  reviewFiles: ReviewFilesState;
  store: CommitStore;
  actions: DetailActions;
  // G12 D13: ReviewView.vue's one panel-level toolbar owns these; this pane's own FileTree
  // renders no toolbar of its own (show-toolbar="false") and so never emits an update to forward.
  listMode: FileListMode;
  filter: string;
}>();

const diffModeOptions: readonly KuiSegmentedOption[] = [
  { id: 'sinceReview', icon: ACTION_ICONS.diffSingle, label: 'Since review' },
  { id: 'range', icon: ACTION_ICONS.diffMultiple, label: 'Full range' },
];

const files = computed(() => props.reviewFiles.files.value.map((entry) => entry.change));

const reviewStatesMap = computed<ReadonlyMap<string, ReviewFileStatus>>(() => {
  const map = new Map<string, ReviewFileStatus>();
  for (const entry of props.reviewFiles.files.value) map.set(entry.change.path, entry.review);
  return map;
});

const selectedIndex = computed(() => {
  const path = props.reviewFiles.selectedPath.value;
  if (path === null) return -1;
  return files.value.findIndex((f) => f.path === path);
});

const deltaStatusText = computed(() => {
  switch (props.reviewFiles.deltaSource.value) {
    case 'noSnapshot':
      return 'Never reviewed — showing the full range diff.';
    case 'unchanged':
      return 'Reviewed — nothing has changed since.';
    case 'fast':
    case 'slow':
      return 'Changed since you reviewed it.';
    case 'snapshotUnavailable':
      return "Reviewed, but what changed since can't be shown.";
    default:
      return undefined;
  }
});

// G21 D13: pinned comes straight from FileTree's own openFile emit — a click (or arrow-key move)
// is false, a double click/Enter is true.
function onOpenFileIndex(index: number, pinned: boolean): void {
  const file = files.value[index];
  if (file) props.reviewFiles.selectFile(file.path, { pinned });
}

function onToggleReviewed(path: string): void {
  const entry = props.reviewFiles.files.value.find((e) => e.change.path === path);
  const isReviewed = entry ? entry.review.kind !== 'none' : false;
  void props.reviewFiles.mark(path, !isReviewed);
}
</script>

<template>
  <div class="kv:flex kv:flex-col kv:min-h-0 kv:h-full">
    <p v-if="reviewFiles.loadError.value" class="kv:m-0 kv:p-3 kv:text-error">
      Couldn't load the file list — {{ reviewFiles.loadError.value }}
    </p>

    <template v-else>
      <!-- G12 D12/D16: which two revisions a click opens in VS Code's diff editor — the one real
           capability removing DiffView would otherwise have lost. -->
      <div class="kv:flex kv:items-center kv:gap-1.5 kv:py-0.5 kv:px-2 kv:border-b kv:border-panel-border kv:font-ui">
        <KuiSegmented
          :options="diffModeOptions"
          :model-value="reviewFiles.diffMode.value"
          ariaLabel="What to compare"
          @update:model-value="(value) => reviewFiles.setDiffMode(value as ReviewDiffMode)"
        />
        <span v-if="deltaStatusText" class="kv:ml-auto kv:text-muted kv:text-sm">{{ deltaStatusText }}</span>
      </div>
      <p v-if="reviewFiles.diffError.value" class="kv:m-0 kv:p-3 kv:text-error">
        Couldn't open that file in the editor — {{ reviewFiles.diffError.value }}
      </p>
      <!-- G30 round-1 functional-correctness review, finding #7: a failed review.mark used to be
           an unhandled promise rejection with nothing shown here — the checkbox just silently
           reverted on the next render. Mirrors loadError/diffError's own pattern exactly. -->
      <p v-if="reviewFiles.markError.value" class="kv:m-0 kv:p-3 kv:text-error">
        Couldn't update that file's review status — {{ reviewFiles.markError.value }}
      </p>

      <FileTree
        class="kv-review-files-tree kv:flex-auto kv:min-h-0 kv:border-b kv:border-panel-border"
        :files="files"
        :selected-file="selectedIndex"
        :list-mode="listMode"
        :filter="filter"
        :show-toolbar="false"
        :parents="[]"
        :parent-index="0"
        :store="store"
        :actions="actions"
        :review-states="reviewStatesMap"
        @open-file="onOpenFileIndex"
        @toggle-reviewed="onToggleReviewed"
      />
      <p v-if="reviewFiles.loading.value && files.length === 0" class="kv:m-0 kv:p-3 kv:text-muted">
        Loading…
      </p>
    </template>
  </div>
</template>

