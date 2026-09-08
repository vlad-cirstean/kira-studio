<script setup lang="ts">
/**
 * G11 D16 — the review sidebar's Files pane, and the only new component this phase adds to
 * `packages/git-ui` (which SPEC otherwise freezes). `DetailPane.vue`'s own shape — `DiffView` when
 * a file is open, `FileTree` otherwise — over `ReviewFilesState` instead of `DetailState`: the
 * rebase/squash/amend case SPEC wrote this phase for makes every commit in the Commits tab
 * unfamiliar, so a file-level view of the range is the surface that survives it (F10).
 *
 * `FileTree`'s merge-parent picker never renders here (`parents` is always `[]` — a branch review
 * has no single "commit" with parents to pick between); `store` is still required by that
 * component's own props, so `ReviewView.vue` passes its own `PackedStreamState.store` down, unused
 * by anything this pane actually shows.
 */
import type { CommitStore } from '@kira/git-core';
import type { ReviewFileStatus } from '@kira/git-ipc';
import { computed, ref } from 'vue';
import type { FileDiffResult, FileListMode } from '../../state/detail.ts';
import type { DetailActions } from '../../state/detailActions.ts';
import type { ReviewFilesState } from '../../state/reviewFiles.ts';
import DiffView, { type ReviewDiffAdornment } from '../DiffView.vue';
import FileTree from '../FileTree.vue';

const props = defineProps<{
  reviewFiles: ReviewFilesState;
  store: CommitStore;
  actions: DetailActions;
}>();

const listMode = ref<FileListMode>('tree');
const filter = ref('');

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

// "Open in editor"/"Go to file" are both commit-shaped (a single sha to diff against) and have no
// honest meaning against a branch-review delta, so this pane's own DiffView never offers them —
// an explicit, always-off override, never a stub: the buttons simply do not render here, the same
// way DiffView already omits them for a binary/tooLarge body.
const diffActions = computed<DetailActions>(() => ({
  ...props.actions,
  capabilities: { ...props.actions.capabilities, openInEditor: false, goToFile: false },
}));

const diffForView = computed<FileDiffResult | undefined>(() => {
  const rf = props.reviewFiles;
  const index = selectedIndex.value;
  const change = index >= 0 ? files.value[index] : undefined;
  if (!change || rf.body.value === undefined) return undefined;
  return { sha: '', parentIndex: 0, baseSha: null, change, body: rf.body.value };
});

const reviewAdornment = computed<ReviewDiffAdornment | undefined>(() => {
  const path = props.reviewFiles.selectedPath.value;
  if (path === null) return undefined;
  const rf = props.reviewFiles;
  return {
    reviewedRanges: rf.reviewedRanges.value,
    pending: rf.pending.value,
    mark: (ranges, reviewed) => {
      void rf.mark(path, reviewed, ranges);
    },
  };
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

function onSelectFileIndex(index: number): void {
  const file = files.value[index];
  if (file) props.reviewFiles.selectFile(file.path);
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

    <template v-else-if="reviewFiles.selectedPath.value !== null">
      <div class="kv-review-files-diff-mode" role="group" aria-label="What to show">
        <button
          type="button"
          :aria-pressed="reviewFiles.diffMode.value === 'sinceReview'"
          :class="{ 'kv-mode-active': reviewFiles.diffMode.value === 'sinceReview' }"
          @click="reviewFiles.setDiffMode('sinceReview')"
        >
          Since review
        </button>
        <button
          type="button"
          :aria-pressed="reviewFiles.diffMode.value === 'range'"
          :class="{ 'kv-mode-active': reviewFiles.diffMode.value === 'range' }"
          @click="reviewFiles.setDiffMode('range')"
        >
          Full range
        </button>
        <span v-if="deltaStatusText" class="kv-review-files-delta-status">{{ deltaStatusText }}</span>
      </div>
      <DiffView
        class="kv-detail-pane-diff"
        :diff="diffForView"
        :diff-error="reviewFiles.diffError.value"
        :file-index="Math.max(selectedIndex, 0)"
        :total-files="files.length"
        :actions="diffActions"
        :review="reviewAdornment"
        @select-file="onSelectFileIndex"
        @back="reviewFiles.showList()"
      />
    </template>

    <template v-else>
      <FileTree
        class="kv-detail-pane-tree kv-review-files-tree"
        :files="files"
        :selected-file="selectedIndex"
        :list-mode="listMode"
        :filter="filter"
        :parents="[]"
        :parent-index="0"
        :store="store"
        :actions="actions"
        :review-states="reviewStatesMap"
        @select-file="onSelectFileIndex"
        @update:list-mode="listMode = $event"
        @update:filter="filter = $event"
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

.kv-review-files-diff-mode {
  display: flex;
  align-items: center;
  gap: var(--kv-space-2);
  padding: var(--kv-space-1) var(--kv-space-4);
  border-bottom: 1px solid var(--kv-panel-border);
}

.kv-review-files-diff-mode button {
  background: transparent;
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-panel-border);
  cursor: pointer;
  padding: 0 var(--kv-space-2);
}

.kv-review-files-diff-mode button.kv-mode-active {
  background: var(--kv-row-selected-bg);
  color: var(--kv-row-selected-fg);
}

.kv-review-files-delta-status {
  margin-left: auto;
  color: var(--kv-description-fg);
  font-size: 0.85em;
}

/* `.kv-detail-pane-diff`/`.kv-detail-pane-tree`/`.kv-detail-pane-error`/`.kv-detail-pane-loading`
 * are `DetailPane.vue`'s own — reused, not redeclared (`StashDetailPane.vue`'s own precedent). */
</style>
