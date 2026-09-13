<script setup lang="ts">
// C5 §12: the real Monaco mount — lands together with monaco.ts's lazy init (S10's own note: no
// separate stand-in file view ever ships in between).
import type { RepoFileTabRecord } from '@shared/domain/tabs';
import { repoIdOfWorkspace, type WorkspaceKey } from '@shared/domain/workspace';
import { onMounted, onUnmounted, ref } from 'vue';
import { control } from '../../bridge/control';
import { settingsState } from '../../state/settings';
import { patchRepoFileTabState } from '../../state/tabs';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import { registerEditor, unmountEditor } from './editors';
import { monacoLanguageFor } from './language';
import { getOrCreateModel, loadMonaco, REPO_THEME_NAME, repoFileUri } from './monaco';
import { ensureNavigationRegistered } from './navigation';

const props = defineProps<{ tab: RepoFileTabRecord }>();

type ViewState = 'loading' | 'found' | 'binary' | 'tooLarge' | 'missing' | 'error';
const state = ref<ViewState>('loading');
const errorMessage = ref('');
const container = ref<HTMLElement | null>(null);

let disposeCursorSub: (() => void) | null = null;

// §11: every Monaco instance is readOnly/domReadOnly — neither the keyboard nor a paste can
// mutate a model. The rest of the option set mirrors §9.3 verbatim (no minimap/suggestions/
// codeLens/validation decorations — this is a viewer, not an editing surface).
async function mount(): Promise<void> {
  const repoId = props.tab.workspaceId
    ? repoIdOfWorkspace(props.tab.workspaceId as WorkspaceKey)
    : null;
  if (!repoId) {
    state.value = 'error';
    errorMessage.value = 'This tab has no repository.';
    return;
  }

  let content: Awaited<ReturnType<typeof control.codeWorkspaceReadFile>>;
  try {
    content = await control.codeWorkspaceReadFile(repoId, props.tab.path);
  } catch (err) {
    state.value = 'error';
    errorMessage.value = err instanceof Error ? err.message : String(err);
    return;
  }
  if (content.kind !== 'found') {
    state.value = content.kind;
    return;
  }

  const mod = await loadMonaco();
  ensureNavigationRegistered(mod);
  // Unmounted (tab closed/switched away) while the read/import above was in flight.
  if (!container.value) return;

  const uri = repoFileUri(mod, repoId, props.tab.path);
  const language = monacoLanguageFor(props.tab.path);
  const model = getOrCreateModel(mod, uri, content.text, language, {
    repoId,
    path: props.tab.path,
  });

  const editor = mod.editor.create(container.value, {
    model,
    theme: REPO_THEME_NAME,
    readOnly: true,
    domReadOnly: true,
    automaticLayout: true,
    minimap: { enabled: false },
    quickSuggestions: false,
    wordBasedSuggestions: 'off',
    parameterHints: { enabled: false },
    codeLens: false,
    renderValidationDecorations: 'off',
    scrollBeyondLastLine: false,
    // C6 D4: never Monaco's own peek widget for a multi-candidate result — standalone Monaco's
    // peek preview resolves each candidate through ITextModelService, which in the standalone
    // build only finds already-created models, so a cross-file candidate with no open tab would
    // render an empty preview pane. 'goto' jumps to the first (best-ranked) candidate through the
    // editor opener instead, which needs no model at all. Honesty is preserved by the hover, which
    // lists every candidate with its own rule/confidence.
    gotoLocation: { multipleDefinitions: 'goto' },
    fontFamily: settingsState.appearance.fontFamily,
    fontSize: settingsState.appearance.fontSize,
  });
  registerEditor(props.tab.id, uri, editor);

  // §9.3/§12: revealLine restore — the line the tab was last showing (a restored session, or a
  // reused tab a search/quick-open match jumped into, §5.2).
  const revealLine = props.tab.state.revealLine;
  if (revealLine !== null) {
    editor.revealLineInCenter(revealLine);
    editor.setPosition({ lineNumber: revealLine, column: 1 });
  }

  // Debounced patch (patchRepoFileTabState's own skipUnchanged) — re-persists revealLine as the
  // user scrolls/navigates, so a restored session reopens roughly where it was left.
  const sub = editor.onDidChangeCursorPosition((e) => {
    patchRepoFileTabState(props.tab.id, { revealLine: e.position.lineNumber });
  });
  disposeCursorSub = () => sub.dispose();

  state.value = 'found';
}

onMounted(() => void mount());

// A mere tab switch away (MainView's own `v-if`, every tab view in this app) — the widget
// disposes, the model (and the tabId -> uri mapping) survives in editors.ts until an actual close
// calls TAB_KINDS['repo-file'].dropResources.
onUnmounted(() => {
  disposeCursorSub?.();
  disposeCursorSub = null;
  unmountEditor(props.tab.id);
});

// Remounting into the same tab (switching back) re-runs mount(), which reuses the cached model —
// the widget is what unmounted, not the data behind it.
</script>

<template>
  <div
    v-if="state === 'loading' || state === 'found'"
    ref="container"
    class="monaco-host"
    data-testid="repo-file-editor"
  />
  <EmptyState
    v-else-if="state === 'binary'"
    icon="file-binary"
    label="This file is binary and can't be previewed."
  />
  <EmptyState
    v-else-if="state === 'tooLarge'"
    icon="warning"
    label="This file is too large to preview (over 8 MB)."
  />
  <EmptyState v-else-if="state === 'missing'" icon="warning" label="This file no longer exists." />
  <EmptyState v-else icon="warning" :label="errorMessage || 'Could not open this file.'" />
</template>

<style scoped>
.monaco-host {
  height: 100%;
  width: 100%;
}
</style>
