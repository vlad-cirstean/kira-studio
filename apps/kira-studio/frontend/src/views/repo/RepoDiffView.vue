<script setup lang="ts">
// C6 §8.1: the diff editor mount, modelled on RepoFileView.vue line for line — same lazy Monaco
// bootstrap, same read-only posture, same navigation registration. The one real difference is the
// editor itself: a diff editor over two models (HEAD, worktree) instead of one.
import type { RepoDiffTabRecord } from '@shared/domain/tabs';
import { repoIdOfWorkspace, type WorkspaceKey } from '@shared/domain/workspace';
import { onMounted, onUnmounted, ref } from 'vue';
import { control } from '../../bridge/control';
import { registerCommand } from '../../shortcuts/commands';
import { settingsState } from '../../state/settings';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import { registerDiffEditor, unmountEditor } from './editors';
import { monacoLanguageFor } from './language';
import { getOrCreateModel, loadMonaco, REPO_THEME_NAME, repoDiffUris } from './monaco';
import { ensureNavigationRegistered } from './navigation';

const props = defineProps<{ tab: RepoDiffTabRecord }>();

type ViewState = 'loading' | 'found' | 'binary' | 'tooLarge' | 'bothMissing' | 'error';
const state = ref<ViewState>('loading');
const errorMessage = ref('');
const container = ref<HTMLElement | null>(null);
let unregisterFind: (() => void) | null = null;

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

  let diff: Awaited<ReturnType<typeof control.codeWorkspaceReadDiff>>;
  try {
    diff = await control.codeWorkspaceReadDiff(repoId, props.tab.path);
  } catch (err) {
    state.value = 'error';
    errorMessage.value = err instanceof Error ? err.message : String(err);
    return;
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

  const { head: headUri, worktree: worktreeUri } = repoDiffUris(mod, repoId, props.tab.path);
  const language = monacoLanguageFor(props.tab.path);
  // D7: the HEAD side is deliberately never recorded as navigable — its content is a different
  // revision than the index describes, so answering a definition there would be a lie. The
  // worktree side is, since it's byte-identical to what the index parsed.
  const original = getOrCreateModel(mod, headUri.toString(), diff.head.text, language);
  const modified = getOrCreateModel(mod, worktreeUri.toString(), diff.worktree.text, language, {
    repoId,
    path: props.tab.path,
  });

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
    hideUnchangedRegions: { enabled: true },
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

  state.value = 'found';
}

onMounted(() => void mount());

// A mere tab switch away — the widget disposes, the models survive in editors.ts until an actual
// close calls TAB_KINDS['repo-diff'].dropResources.
onUnmounted(() => {
  unregisterFind?.();
  unregisterFind = null;
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
