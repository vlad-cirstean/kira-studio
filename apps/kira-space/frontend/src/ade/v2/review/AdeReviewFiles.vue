<script setup lang="ts">
import type { ReviewComment } from '@kira/git-ipc';
import type { MountHandle, ReviewApi } from '@kira/git-ui';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { useWindowFocus } from '@vueuse/core';
import { errorText } from '@workbench/bridge/codedError';
import { logError } from '@workbench/bridge/log';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { loadGitUi } from '../../../repo/git/gitUiModule';
import { gitTransportFor, notifyReviewRepaint } from '../../../repo/git/transport';
import { ensureRepoOpen } from '../../../state/repoOpenHold';
import { openRepoWorkingReviewTab } from '../../../state/repoTabs';
import { useReviewNavigationStore } from '../../../state/reviewNavigation';
import type { ReviewWindowTarget } from '../wire';
import { useReviewWorking, useReviewWorkingMark } from './useReviewWorking';

// The review window's left pane: git-ui's review view locked to this window's branch and base.
const props = defineProps<{ target: ReviewWindowTarget }>();

const errorMessage = ref('');
const container = ref<HTMLElement | null>(null);
let handle: MountHandle | null = null;
let api: ReviewApi | null = null;
let unregisterNavigator: (() => void) | null = null;
const navigation = useReviewNavigationStore();

// Opens a file's diff in the centre tabs, as a click in the file list does.
defineExpose({
  selectFile: (path: string, origin: ReviewComment['origin'] = 'commit') =>
    origin === 'working'
      ? openRepoWorkingReviewTab(props.target.codeRepoId, path, props.target.branchId, false)
      : api?.selectFile(path),
});

// A missed watcher event (sleep, dropped FS event) heals when the window regains focus.
const focused = useWindowFocus();
watch(focused, (now, was) => {
  if (now && !was) api?.refresh();
});

// The uncommitted section under the committed list; git-ui renders it, this window feeds it.
const working = useReviewWorking(() => props.target.branchId);
const mark = useReviewWorkingMark();

// Every open diff of these paths re-reads its working review.
function repaintWorking(paths: readonly string[]): void {
  notifyReviewRepaint({
    kind: 'mark',
    scope: 'working',
    repoId: props.target.gitRepoId,
    branch: props.target.branch,
    paths,
  });
}

async function toggleWorking(paths: readonly string[], reviewed: boolean): Promise<void> {
  try {
    await mark.mutateAsync({
      branchId: props.target.branchId,
      paths: [...paths],
      reviewed,
      ranges: null,
    });
  } catch (err) {
    logError('adeReviewFiles', 'uncommitted review mark failed', err);
    return;
  }
  repaintWorking(paths);
}

function pushWorking(): void {
  const data = working.data.value;
  handle?.setWorkingChanges?.(
    data && data.worktree !== '' && data.files.length > 0
      ? {
          files: data.files,
          reviewStates: new Map(Object.entries(data.reviews)),
          onOpen: (path, pinned) =>
            openRepoWorkingReviewTab(props.target.codeRepoId, path, props.target.branchId, pinned),
          onToggleReviewed: (path, reviewed) => void toggleWorking([path], reviewed),
          onToggleReviewedFolder: (paths, reviewed) => void toggleWorking(paths, reviewed),
        }
      : null,
  );
}
watch(() => working.data.value, pushWorking);

// A commit moved reviewed work onto the committed review: refresh its list and its open diffs.
watch(
  () => working.data.value?.promoted,
  (promoted) => {
    if (!promoted || promoted.length === 0) return;
    api?.refresh();
    notifyReviewRepaint({
      kind: 'mark',
      scope: 'commit',
      repoId: props.target.gitRepoId,
      branch: props.target.branch,
      paths: promoted,
    });
    notifyReviewRepaint({
      kind: 'comments',
      repoId: props.target.gitRepoId,
      branch: props.target.branch,
    });
    repaintWorking(promoted);
  },
);

onMounted(async () => {
  if (!container.value) return;
  try {
    // The review view only asks about a repo this connection already holds.
    const transport = gitTransportFor(props.target.codeRepoId);
    await ensureRepoOpen(transport, props.target.gitRepoId);
    const { mount, NullViewStateStore } = await loadGitUi();
    if (!container.value) return;
    handle = mount(container.value, {
      transport,
      viewState: new NullViewStateStore(),
      view: 'review',
      target: {
        repoId: props.target.gitRepoId,
        branch: props.target.branch,
        base: props.target.base,
        pane: 'files',
      },
      lockTarget: true,
      onReviewApi: (a) => {
        api = a;
        unregisterNavigator?.();
        unregisterNavigator = navigation.register(props.target.codeRepoId, a);
      },
    });
    pushWorking();
  } catch (err) {
    errorMessage.value = errorText(err);
  }
});

onUnmounted(() => {
  unregisterNavigator?.();
  unregisterNavigator = null;
  handle?.unmount();
  handle = null;
});
</script>

<template>
  <div v-if="!errorMessage" ref="container" class="h-full w-full" data-testid="ade-review-files" />
  <Alert v-else variant="info">
    <AlertDescription>{{ errorMessage }}</AlertDescription>
  </Alert>
</template>
