<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
// P104 §3.4: EmptyState's ui/alert rewrite is a genuinely separate, non-mechanical piece of work --
// not attempted in this pass, same deferral as OperationsPanel.vue's own.
import EmptyState from '@theme/primitives/EmptyState.vue';
import { registerCommand } from '@workbench/shortcuts/commands';
import { onMounted, onUnmounted, ref } from 'vue';
import { gitRepoIdFor } from '../../repo/git/hostHandlers';
import { gitTransportFor } from '../../repo/git/transport';
// C6 §8.1: the diff editor mount, modelled on RepoFileView.vue line for line — same lazy Monaco
// bootstrap, same read-only posture, same navigation registration. The one real difference is the
// editor itself: a diff editor over two models (HEAD, worktree) instead of one.
//
// C10 §6.1/§6.2: extends this same tab kind for a *commit* diff (openRepoCommitDiffTab, S15)
// rather than forking a second one — repoDiffTabStateSchema's revision pair (S8) is null on both
// sides for C6's original HEAD-vs-worktree comparison (unchanged below) and non-null for a commit
// diff.
//
// P92 item 5: the content-resolution + editor-construction body now lives in useDiffEditor.ts,
// shared with RepoMultiDiffView.vue's own per-file sections — this view keeps only what stays
// single-active-view scoped: repoId resolution, the view.find/repo.goToFileFromDiff command
// registrations, and review-decorations wiring.
import type { RepoDiffTabRecord } from '../../state/tabDomain';
import { repoIdOfWorkspace, type WorkspaceKey } from '../../state/workspace';
import { loadMonaco } from './monaco';
import { attachReviewDecorations, type ReviewDecorationsHandle } from './reviewDecorations';
import { useDiffEditor } from './useDiffEditor';

const props = defineProps<{ tab: RepoDiffTabRecord }>();

const errorMessage = ref('');
const container = ref<HTMLElement | null>(null);
let unregisterFind: (() => void) | null = null;
let unregisterGoToFile: (() => void) | null = null;
let reviewDecorations: ReviewDecorationsHandle | null = null;

type ViewState = 'loading' | 'found' | 'binary' | 'tooLarge' | 'bothMissing' | 'error';
const state = ref<ViewState>('loading');
function onGoToFile(): void {
  diffEditor?.goToFile();
}

let diffEditor: ReturnType<typeof useDiffEditor> | null = null;

async function mount(): Promise<void> {
  const repoId = props.tab.workspaceId
    ? repoIdOfWorkspace(props.tab.workspaceId as WorkspaceKey)
    : null;
  if (!repoId) {
    state.value = 'error';
    errorMessage.value = 'This tab has no repository.';
    return;
  }

  const { left, right, review } = props.tab.state;
  diffEditor = useDiffEditor(container, {
    editorKey: props.tab.id,
    repoId,
    path: props.tab.path,
    left,
    right,
    review: review !== null,
  });
  await diffEditor.mount();
  state.value = diffEditor.state.value;
  errorMessage.value = diffEditor.errorMessage.value;
  if (state.value !== 'found') return;

  const editor = diffEditor.editor.value;
  if (!editor) return; // Unmounted while mount() awaited above — nothing left to wire.
  const mod = await loadMonaco();
  const gitRepoId = left === null ? undefined : gitRepoIdFor(repoId);

  // C7 D13/§6: the modified (worktree) pane, never the HEAD pane — the same reasoning
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
  diffEditor?.dispose();
  diffEditor = null;
});
</script>

<template>
  <div class="repo-diff-root">
    <!-- P92 item 7: the same action the repo.goToFileFromDiff palette command runs — P74 built the
         behaviour and gave it no other affordance. -->
    <div v-if="state === 'found'" class="diff-actions">
      <Button variant="toolbar" size="kira" data-testid="repo-diff-go-to-file" @click="onGoToFile">
        <CodiconIcon name="go-to-file" :size="13" />
        Go to file
      </Button>
    </div>
    <div
      v-if="state === 'loading' || state === 'found'"
      ref="container"
      class="monaco-host"
      data-testid="repo-diff-editor"
    />
    <EmptyState
      v-else-if="state === 'binary'"
      icon="file-binary"
      label="This file is binary and can't be compared."
    />
    <EmptyState
      v-else-if="state === 'tooLarge'"
      icon="warning"
      label="This file is too large to compare (over 8 MB)."
    />
    <EmptyState
      v-else-if="state === 'bothMissing'"
      icon="warning"
      label="This file no longer exists."
    />
    <EmptyState v-else icon="warning" :label="errorMessage || 'Could not open this diff.'" />
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.repo-diff-root {
  @apply h-full flex flex-col;
}

.diff-actions {
  @apply flex flex-none border-b border-border py-1 px-1.5;
}

.monaco-host {
  @apply flex-auto min-h-0 w-full;
}
</style>
