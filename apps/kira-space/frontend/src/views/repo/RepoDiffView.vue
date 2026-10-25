<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/components/EmptyState.vue';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { registerCommand } from '@workbench/shortcuts/commands';
import { onMounted, onUnmounted, ref } from 'vue';
import { useAdeReviewWindowStore } from '../../ade/v2/state/adeReviewWindow';
import { gitRepoIdFor } from '../../repo/git/hostHandlers';
import { gitTransportFor } from '../../repo/git/transport';
// The diff editor mount, modelled on RepoFileView.vue line for line — same lazy Monaco
// bootstrap, same read-only posture, same navigation registration. The one real difference is the
// editor itself: a diff editor over two models (HEAD, worktree) instead of one.
//
// Extends this same tab kind for a *commit* diff (openRepoCommitDiffTab)
// rather than forking a second one — repoDiffTabStateSchema's revision pair is null on both
// sides for the original HEAD-vs-worktree comparison (unchanged below) and non-null for a commit
// diff.
//
// The content-resolution + editor-construction body now lives in useDiffEditor.ts,
// shared with RepoMultiDiffView.vue's own per-file sections — this view keeps only what stays
// single-active-view scoped: repoId resolution, the view.find/repo.goToFileFromDiff command
// registrations, and review-decorations wiring.
import type { RepoDiffTabRecord } from '../../state/tabDomain';
import { noRepositoryMessage, repoIdOfTab } from '../../state/workspace';
import { attachAskReviewAgent } from './askReviewAgent';
import { loadMonaco } from './monaco';
import { attachReviewDecorations, type ReviewDecorationsHandle } from './reviewDecorations';
import { useDiffEditor } from './useDiffEditor';

const props = defineProps<{ tab: RepoDiffTabRecord }>();

const errorMessage = ref('');
const container = ref<HTMLElement | null>(null);
let unregisterFind: (() => void) | null = null;
let unregisterGoToFile: (() => void) | null = null;
let reviewDecorations: ReviewDecorationsHandle | null = null;
let detachAsk: (() => void) | null = null;
const reviewWindow = useAdeReviewWindowStore();

type ViewState = 'loading' | 'found' | 'binary' | 'tooLarge' | 'bothMissing' | 'error';
const state = ref<ViewState>('loading');
function onGoToFile(): void {
  diffEditor?.goToFile();
}

let diffEditor: ReturnType<typeof useDiffEditor> | null = null;

async function mount(): Promise<void> {
  const repoId = repoIdOfTab(props.tab);
  if (!repoId) {
    state.value = 'error';
    errorMessage.value = noRepositoryMessage();
    return;
  }

  const { left, right, review } = props.tab.state;
  const handle = useDiffEditor(container, {
    editorKey: props.tab.id,
    repoId,
    path: props.tab.path,
    left,
    right,
    review: review !== null,
    reviewBranch: review?.branch,
  });
  diffEditor = handle;
  await handle.mount();
  if (diffEditor !== handle) return; // Unmounted while mount() awaited.
  state.value = handle.state.value;
  errorMessage.value = handle.errorMessage.value;
  if (state.value !== 'found') return;

  const editor = handle.editor.value;
  if (!editor) return;
  const mod = await loadMonaco();
  if (diffEditor !== handle) return;
  const gitRepoId = left === null ? undefined : gitRepoIdFor(repoId);

  // The modified (worktree) pane, never the HEAD pane — the same reasoning
  // useDiffEditor's own goToFile follows for which side is navigable. view.find is a global
  // command, so it must reach through to one editor pane rather than the diff editor as a whole
  // (IStandaloneDiffEditor itself has no getAction).
  const modifiedEditor = editor.getModifiedEditor();
  unregisterFind = registerCommand('view.find', () => {
    modifiedEditor.focus();
    void modifiedEditor.getAction('actions.find')?.run();
  });

  // P74 §7.4 item 1 / P92 item 7: the diff editor's own "go to file" — both the palette command
  // and the visible header button (template) run useDiffEditor's own goToFile().
  unregisterGoToFile = registerCommand('repo.goToFileFromDiff', () => diffEditor?.goToFile());

  // C11 §7.4/S11: the comment-thread/mark-reviewed layer, only for a review diff tab. `left` is
  // never null here — openRepoReviewDiffTab (S8) always supplies both revisions alongside `review`.
  if (review !== null && gitRepoId !== undefined && left !== null) {
    reviewDecorations = attachReviewDecorations(mod, editor, {
      transport: gitTransportFor(repoId),
      gitRepoId,
      path: props.tab.path,
      leftRev: left,
      review,
    });
    // A review window's questions panel quotes this diff's selection.
    if (reviewWindow.target) {
      detachAsk = attachAskReviewAgent(modifiedEditor, props.tab.path, reviewWindow);
    }
  }
}

onMounted(() => void mount());

// A mere tab switch away — the widget disposes, the models survive in editors.ts until an actual
// close calls TAB_KINDS['repo-diff'].dropResources.
onUnmounted(() => {
  unregisterFind?.();
  unregisterFind = null;
  unregisterGoToFile?.();
  unregisterGoToFile = null;
  reviewDecorations?.dispose();
  reviewDecorations = null;
  detachAsk?.();
  detachAsk = null;
  diffEditor?.dispose();
  diffEditor = null;
});
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- P92 item 7: the same action the repo.goToFileFromDiff palette command runs — P74 built the
         behaviour and gave it no other affordance. -->
    <ViewToolbar v-if="state === 'found'">
      <Button variant="toolbar" size="kira" data-testid="repo-diff-go-to-file" @click="onGoToFile">
        <CodiconIcon name="go-to-file" :size="13" />
        {{ t('common.goToFile.label') }}
      </Button>
    </ViewToolbar>
    <div
      v-if="state === 'loading' || state === 'found'"
      ref="container"
      class="monaco-host flex-auto min-h-0 w-full"
      data-testid="repo-diff-editor"
    />
    <EmptyState
      v-else-if="state === 'binary'"
      fill
      icon="file-binary"
      :title="t('space.repo.view.binaryCompare.empty')"
    />
    <EmptyState
      v-else-if="state === 'tooLarge'"
      fill
      icon="warning"
      :title="t('space.repo.view.tooLargeCompare.empty')"
    />
    <EmptyState
      v-else-if="state === 'bothMissing'"
      fill
      icon="warning"
      :title="t('space.repo.view.missing.empty')"
    />
    <EmptyState
      v-else
      fill
      icon="warning"
      :title="errorMessage || t('space.repo.view.openDiffFailed.error')"
    />
  </div>
</template>
