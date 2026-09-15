<script setup lang="ts">
// C6 §8.1: the diff editor mount, modelled on RepoFileView.vue line for line — same lazy Monaco
// bootstrap, same read-only posture, same navigation registration. The one real difference is the
// editor itself: a diff editor over two models (HEAD, worktree) instead of one.
//
// C10 §6.1/§6.2: extends this same tab kind for a *commit* diff (openRepoCommitDiffTab, S15)
// rather than forking a second one — repoDiffTabStateSchema's revision pair (S8) is null on both
// sides for C6's original HEAD-vs-worktree comparison (unchanged below) and non-null for a commit
// diff, whose two sides are read via two file.read calls over the GIT transport instead of
// control.codeWorkspaceReadDiff, reshaped into the identical DiffSide classification so every
// branch below (binary/tooLarge/bothMissing, Monaco model creation) is one implementation for both.
import type { DiffSide } from '@shared/domain/repo';
import type { RepoDiffTabRecord } from '@shared/domain/tabs';
import { repoIdOfWorkspace, type WorkspaceKey } from '@shared/domain/workspace';
import { onMounted, onUnmounted, ref } from 'vue';
import { control } from '../../bridge/control';
import { gitRepoIdFor } from '../../repo/git/hostHandlers';
import { gitTransportFor } from '../../repo/git/transport';
import { registerCommand } from '../../shortcuts/commands';
import { settingsState } from '../../state/settings';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import { registerDiffEditor, unmountEditor } from './editors';
import { monacoLanguageFor } from './language';
import {
  getOrCreateModel,
  loadMonaco,
  REPO_THEME_NAME,
  repoDiffUris,
  repoRevisionDiffUris,
} from './monaco';
import { ensureNavigationRegistered } from './navigation';
import { attachReviewDecorations, type ReviewDecorationsHandle } from './reviewDecorations';

// C10 §6.1: file.read's own four-way result, reshaped into DiffSide — the same classification
// codeWorkspaceReadDiff's own two sides already use, so the binary/tooLarge/bothMissing branches
// below and the Monaco model creation stay one implementation for both kinds of diff.
function toDiffSide(result: {
  readonly kind: 'found' | 'missing' | 'binary' | 'tooLarge';
  readonly content?: string;
  readonly bytes?: number;
  readonly limitBytes?: number;
}): DiffSide {
  return {
    kind: result.kind,
    text: result.content ?? '',
    bytes: result.bytes ?? 0,
    limitBytes: result.limitBytes ?? 0,
  };
}

const props = defineProps<{ tab: RepoDiffTabRecord }>();

type ViewState = 'loading' | 'found' | 'binary' | 'tooLarge' | 'bothMissing' | 'error';
const state = ref<ViewState>('loading');
const errorMessage = ref('');
const container = ref<HTMLElement | null>(null);
let unregisterFind: (() => void) | null = null;
let reviewDecorations: ReviewDecorationsHandle | null = null;

// §11: read-only, unchanged from the file viewer — readOnly/domReadOnly block the keyboard and
// paste; renderMarginRevertIcon/renderGutterMenu are the second layer, hiding the revert/apply
// affordances that would otherwise let a user trigger a write from a widget built for the
// extension's read-write use (C6 §8.1, not cosmetic).
async function mount(): Promise<void> {
  const repoId = props.tab.workspaceId
    ? repoIdOfWorkspace(props.tab.workspaceId as WorkspaceKey)
    : null;
  if (!repoId) {
    state.value = 'error';
    errorMessage.value = 'This tab has no repository.';
    return;
  }

  // C10 §6.1/§6.2: repoDiffTabStateSchema's own revision pair — both null is C6's original
  // HEAD-vs-worktree comparison, byte-identical below; a commit diff (openRepoCommitDiffTab, S15)
  // always supplies both (a root commit's left is git's well-known empty-tree sha, never null).
  const { left, right, review } = props.tab.state;
  let gitRepoId: string | undefined;
  let diff: { head: DiffSide; worktree: DiffSide };
  if (left === null) {
    try {
      diff = await control.codeWorkspaceReadDiff(repoId, props.tab.path);
    } catch (err) {
      state.value = 'error';
      errorMessage.value = err instanceof Error ? err.message : String(err);
      return;
    }
  } else {
    gitRepoId = gitRepoIdFor(repoId);
    if (!gitRepoId || right === null) {
      state.value = 'error';
      errorMessage.value = 'This repository is not open.';
      return;
    }
    // 7d (P68 review): this lease is only ever used for the two requests below, so it is released
    // as soon as they settle rather than left to leak for the rest of the mount (unlike the
    // review-decorations lease further down, which reviewDecorations.ts's own dispose() now owns).
    const transport = gitTransportFor(repoId);
    try {
      const [leftResult, rightResult] = await Promise.all([
        transport.request('file.read', { repoId: gitRepoId, rev: left, path: props.tab.path }),
        transport.request('file.read', { repoId: gitRepoId, rev: right, path: props.tab.path }),
      ]);
      diff = { head: toDiffSide(leftResult), worktree: toDiffSide(rightResult) };
    } catch (err) {
      state.value = 'error';
      errorMessage.value = err instanceof Error ? err.message : String(err);
      return;
    } finally {
      transport.dispose();
    }
  }

  if (diff.head.kind === 'binary' || diff.worktree.kind === 'binary') {
    state.value = 'binary';
    return;
  }
  if (diff.head.kind === 'tooLarge' || diff.worktree.kind === 'tooLarge') {
    state.value = 'tooLarge';
    return;
  }
  if (diff.head.kind === 'missing' && diff.worktree.kind === 'missing') {
    state.value = 'bothMissing';
    return;
  }

  const mod = await loadMonaco();
  ensureNavigationRegistered(mod);
  // Unmounted (tab closed/switched away) while the read/import above was in flight.
  if (!container.value) return;

  let headUri: import('monaco-editor').Uri;
  let worktreeUri: import('monaco-editor').Uri;
  if (left === null) {
    ({ head: headUri, worktree: worktreeUri } = repoDiffUris(mod, repoId, props.tab.path));
  } else {
    ({ left: headUri, right: worktreeUri } = repoRevisionDiffUris(
      mod,
      repoId,
      props.tab.path,
      left,
      // biome-ignore lint/style/noNonNullAssertion: checked alongside left above — both null or both set.
      right!,
    ));
  }
  const language = monacoLanguageFor(props.tab.path);
  // D7: the HEAD side is deliberately never recorded as navigable — its content is a different
  // revision than the index describes, so answering a definition there would be a lie. The
  // worktree side is, since it's byte-identical to what the index parsed. C10: for a commit diff,
  // NEITHER side is on disk, so neither is registered — this extends D7's own rule rather than
  // special-casing it.
  const original = getOrCreateModel(mod, headUri.toString(), diff.head.text, language);
  const modified = getOrCreateModel(
    mod,
    worktreeUri.toString(),
    diff.worktree.text,
    language,
    left === null ? { repoId, path: props.tab.path } : undefined,
  );

  const editor = mod.editor.createDiffEditor(container.value, {
    theme: REPO_THEME_NAME,
    readOnly: true,
    domReadOnly: true,
    originalEditable: false,
    renderMarginRevertIcon: false,
    renderGutterMenu: false,
    automaticLayout: true,
    renderSideBySide: true,
    ignoreTrimWhitespace: false,
    // C11 §7.3 gotcha 2: 0.56.0 has no public API to expand one specific collapsed unchanged
    // region, so a comment anchored inside one would be invisible — only the review variant
    // disables this; C6/C10's plain diff keeps it enabled, byte-identical.
    hideUnchangedRegions: { enabled: review === null },
    // §7.3 gotcha 1: the registered option default and the .d.ts prose disagree — set explicitly
    // for the review variant rather than depend on either being right in a future Monaco bump.
    // The plain diff passes nothing, unchanged from before this phase.
    ...(review !== null ? { glyphMargin: true } : {}),
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    gotoLocation: { multipleDefinitions: 'goto' },
    fontFamily: settingsState.appearance.fontFamily,
    fontSize: settingsState.appearance.fontSize,
  });
  editor.setModel({ original, modified });
  registerDiffEditor(props.tab.id, [headUri.toString(), worktreeUri.toString()], editor);

  // C7 D13/§6: the modified (worktree) pane, never the HEAD pane — it's the side whose content
  // matches the file on disk (C6 D7's own reasoning for which side is navigable), and
  // IStandaloneDiffEditor itself has no getAction, so this has to reach through to one pane.
  const modifiedEditor = editor.getModifiedEditor();
  unregisterFind = registerCommand('view.find', () => {
    modifiedEditor.focus();
    void modifiedEditor.getAction('actions.find')?.run();
  });

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

  state.value = 'found';
}

onMounted(() => void mount());

// A mere tab switch away — the widget disposes, the models survive in editors.ts until an actual
// close calls TAB_KINDS['repo-diff'].dropResources.
onUnmounted(() => {
  unregisterFind?.();
  unregisterFind = null;
  reviewDecorations?.dispose();
  reviewDecorations = null;
  unmountEditor(props.tab.id);
});
</script>

<template>
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
</template>

<style scoped>
.monaco-host {
  height: 100%;
  width: 100%;
}
</style>
