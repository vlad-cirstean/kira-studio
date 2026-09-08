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
import type { ReviewFileStatus } from '@kira/git-ipc';
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
  <div class="kv-review-files-pane">
    <p v-if="reviewFiles.loadError.value" class="kv-detail-pane-error">
      Couldn't load the file list — {{ reviewFiles.loadError.value }}
    </p>

    <template v-else>
      <!-- G12 D12/D16: which two revisions a click opens in VS Code's diff editor — the one real
           capability removing DiffView would otherwise have lost. -->
      <div class="kv-review-files-diff-mode">
        <div class="kv-review-files-diff-toggle" role="group" aria-label="What to compare">
          <button
            type="button"
            :aria-pressed="reviewFiles.diffMode.value === 'sinceReview'"
            :class="{ 'kv-mode-active': reviewFiles.diffMode.value === 'sinceReview' }"
            v-kui-tooltip="'Since review'"
            aria-label="Since review"
            @click="reviewFiles.setDiffMode('sinceReview')"
          >
            <span class="codicon" :class="ACTION_ICONS.diffSingle" aria-hidden="true"></span>
          </button>
          <button
            type="button"
            :aria-pressed="reviewFiles.diffMode.value === 'range'"
            :class="{ 'kv-mode-active': reviewFiles.diffMode.value === 'range' }"
            v-kui-tooltip="'Full range'"
            aria-label="Full range"
            @click="reviewFiles.setDiffMode('range')"
          >
            <span class="codicon" :class="ACTION_ICONS.diffMultiple" aria-hidden="true"></span>
          </button>
        </div>
        <span v-if="deltaStatusText" class="kv-review-files-delta-status">{{ deltaStatusText }}</span>
      </div>
      <p v-if="reviewFiles.diffError.value" class="kv-detail-pane-error">
        Couldn't open that file in the editor — {{ reviewFiles.diffError.value }}
      </p>

      <FileTree
        class="kv-detail-pane-tree kv-review-files-tree"
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
        review-styled
        @open-file="onOpenFileIndex"
        @toggle-reviewed="onToggleReviewed"
      />
      <p v-if="reviewFiles.loading.value && files.length === 0" class="kv-detail-pane-loading">
        Loading…
      </p>
    </template>
  </div>
</template>

<style>
.kv-review-files-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.kv-review-files-tree {
  border-top: none;
}

/* G12 D14/D16: the same .p-seg-shaped segmented group as ReviewView.vue's own toggles. */
.kv-review-files-diff-mode {
  display: flex;
  align-items: center;
  gap: var(--kv-s-3);
  padding: var(--kv-s-1) var(--kv-s-4);
  border-bottom: var(--kv-border-width) solid var(--kv-panel-border);
  font-family: var(--kv-font-ui);
}

.kv-review-files-diff-toggle {
  display: inline-flex;
  height: var(--kv-control-h);
  border: var(--kv-border-width) solid var(--kv-panel-border);
  border-radius: var(--kv-radius-sm);
  overflow: hidden;
}

.kv-review-files-diff-mode button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--kv-control-h);
  background: transparent;
  color: var(--kv-row-fg);
  border: none;
  cursor: pointer;
}

.kv-review-files-diff-mode button + button {
  border-left: var(--kv-border-width) solid var(--kv-panel-border);
}

.kv-review-files-diff-mode button.kv-mode-active {
  background: var(--kv-row-selected-bg);
  color: var(--kv-row-selected-fg);
}

.kv-review-files-delta-status {
  margin-left: auto;
  color: var(--kv-description-fg);
  font-size: var(--kv-t-sm);
}

/* `.kv-detail-pane-diff`/`.kv-detail-pane-tree`/`.kv-detail-pane-error`/`.kv-detail-pane-loading`
 * are `DetailPane.vue`'s own — reused, not redeclared (`StashDetailPane.vue`'s own precedent). */
</style>
