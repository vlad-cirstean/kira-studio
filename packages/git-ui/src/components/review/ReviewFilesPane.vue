<script setup lang="ts">
/**
 * G11 D16 — the review sidebar's Files pane, and the only new component this phase adds to
 * `packages/git-ui` (which SPEC otherwise freezes). `FileTree` over `ReviewFilesState` instead of
 * `DetailState`: the rebase/squash/amend case SPEC wrote this phase for makes every commit in the
 * Commits tab unfamiliar, so a file-level view of the range is the surface that survives it (F10).
 *
 * G12 D12: selecting a file no longer opens an in-webview `DiffView` — it opens the host's native
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
import CodiconIcon from '@theme/CodiconIcon.vue';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { computed, ref } from 'vue';
import { ACTION_ICONS, codiconName } from '../../icons/index.ts';
import type { FileListMode } from '../../state/detail.ts';
import type { DetailActions } from '../../state/detailActions.ts';
import type { ReviewFilesState } from '../../state/reviewFiles.ts';
import FileTree from '../FileTree.vue';

// P131 Part 3 §5.5: a local option shape for the ToggleGroup below — matches BranchPicker.vue's
// own PickerTabOption precedent, not a shared package export.
interface DiffModeOption {
  readonly id: ReviewDiffMode;
  readonly icon: string;
  readonly label: string;
}

const props = defineProps<{
  reviewFiles: ReviewFilesState;
  store: CommitStore;
  actions: DetailActions;
  // G12 D13: ReviewView.vue's one panel-level toolbar owns these; this pane's own FileTree
  // renders no toolbar of its own (show-toolbar="false") and so never emits an update to forward.
  listMode: FileListMode;
  filter: string;
  /** Set by a host that wants the `Needs review | All` toggle; its value is the initial choice. */
  reviewFilter?: 'all' | 'needsReview';
}>();

const showing = ref<'all' | 'needsReview'>(props.reviewFilter ?? 'all');
const hasFilter = computed(() => props.reviewFilter !== undefined);

function needsReview(status: ReviewFileStatus): boolean {
  return status.kind !== 'full' || status.changedSinceReview;
}

const needsReviewCount = computed(
  () => props.reviewFiles.files.value.filter((e) => needsReview(e.review)).length,
);

const diffModeOptions: readonly DiffModeOption[] = [
  { id: 'sinceReview', icon: ACTION_ICONS.diffSingle, label: 'Since review' },
  { id: 'range', icon: ACTION_ICONS.diffMultiple, label: 'Full range' },
];

const shown = computed(() =>
  hasFilter.value && showing.value === 'needsReview'
    ? props.reviewFiles.files.value.filter((e) => needsReview(e.review))
    : props.reviewFiles.files.value,
);
const files = computed(() => shown.value.map((entry) => entry.change));
const nothingToReview = computed(
  () =>
    hasFilter.value &&
    showing.value === 'needsReview' &&
    !props.reviewFiles.loading.value &&
    props.reviewFiles.files.value.length > 0 &&
    files.value.length === 0,
);

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
  <div class="flex flex-col min-h-0 h-full">
    <p v-if="reviewFiles.loadError.value" class="m-0 p-3 text-error">
      Couldn't load the file list — {{ reviewFiles.loadError.value }}
    </p>

    <template v-else>
      <!-- G12 D12/D16: which two revisions a click opens in the host's diff editor — the one real
           capability removing DiffView would otherwise have lost. -->
      <ViewToolbar class="font-ui">
        <ToggleGroup
          type="single"
          variant="outline"
          size="kira"
          :model-value="reviewFiles.diffMode.value"
          aria-label="What to compare"
          @update:model-value="(v) => v && reviewFiles.setDiffMode(v as ReviewDiffMode)"
        >
          <Tooltip v-for="o in diffModeOptions" :key="o.id">
            <TooltipTrigger as-child>
              <ToggleGroupItem :value="o.id" :aria-label="o.label">
                <CodiconIcon :name="codiconName(o.icon)" :size="13" />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>{{ o.label }}</TooltipContent>
          </Tooltip>
        </ToggleGroup>
        <span v-if="deltaStatusText" class="ml-auto text-muted-foreground text-graph-sm">{{ deltaStatusText }}</span>
      </ViewToolbar>
      <p v-if="reviewFiles.diffError.value" class="m-0 p-3 text-error">
        Couldn't open that file in the editor — {{ reviewFiles.diffError.value }}
      </p>
      <!-- G30 round-1 functional-correctness review, finding #7: a failed review.mark used to be
           an unhandled promise rejection with nothing shown here — the checkbox just silently
           reverted on the next render. Mirrors loadError/diffError's own pattern exactly. -->
      <p v-if="reviewFiles.markError.value" class="m-0 p-3 text-error">
        Couldn't update that file's review status — {{ reviewFiles.markError.value }}
      </p>

      <ViewToolbar v-if="hasFilter" class="font-ui">
        <ToggleGroup
          type="single"
          variant="outline"
          size="kira"
          :model-value="showing"
          aria-label="Which files to list"
          @update:model-value="(v) => v && (showing = v as 'all' | 'needsReview')"
        >
          <ToggleGroupItem value="needsReview">Needs review · {{ needsReviewCount }}</ToggleGroupItem>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
        </ToggleGroup>
      </ViewToolbar>
      <p v-if="nothingToReview" class="m-0 p-3 text-muted-foreground">
        Nothing changed since your last review.
      </p>

      <FileTree data-testid="review-files-tree"
        v-else
        class="flex-auto min-h-0 border-b border-border"
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
      <p v-if="reviewFiles.loading.value && files.length === 0" class="m-0 p-3 text-muted-foreground">
        Loading…
      </p>
    </template>
  </div>
</template>

