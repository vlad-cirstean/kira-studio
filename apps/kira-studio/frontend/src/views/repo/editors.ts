// C5 §9.3/§12: the tabId -> editor registry. Two jobs: (1) this phase's own model-lifecycle
// bookkeeping — a tab switch away unmounts the Vue component (MainView's `v-if`, the same as every
// other tab view in this app) but must not lose the loaded buffer, so the editor *widget* disposes
// on unmount while the model stays cached (monaco.ts's own modelCache) until the tab actually
// closes; (2) C6/C10's own reserved seam — the live IStandaloneCodeEditor instances,
// definition/hover providers and gutter decorations attach to.
//
// C6 §8.3: widened to one entry shape covering both a repo-file tab's single model/editor and a
// repo-diff tab's pair — one map, one lifecycle, rather than a second parallel map that would give
// closeTab's single dropResources call two places to forget. editorForTab keeps returning a
// standalone code editor only (its one caller, C10's future gutter work, means that one).
import { disposeModel } from './monaco';

type StandaloneEditor = import('monaco-editor').editor.IStandaloneCodeEditor;
type StandaloneDiffEditor = import('monaco-editor').editor.IStandaloneDiffEditor;

interface RepoEditorEntry {
  uris: string[];
  editor: StandaloneEditor | StandaloneDiffEditor | null;
}

const entries = new Map<string, RepoEditorEntry>();

/** Called on mount (and on every remount after a tab-switch-away) — replaces any previous entry. */
export function registerEditor(tabId: string, uri: string, editor: StandaloneEditor): void {
  entries.set(tabId, { uris: [uri], editor });
}

/** repo-diff's own counterpart to registerEditor — two model uris (HEAD, worktree), one diff
 *  editor widget. */
export function registerDiffEditor(
  tabId: string,
  uris: string[],
  editor: StandaloneDiffEditor,
): void {
  entries.set(tabId, { uris, editor });
}

/** Called on Vue unmount (a tab switch away, not a close) — disposes the widget, keeps the uris so
 *  dropResources can still find the model(s) to dispose later if the tab is closed while
 *  unmounted. Works for either a repo-file or a repo-diff entry. */
export function unmountEditor(tabId: string): void {
  const entry = entries.get(tabId);
  if (!entry) return;
  entry.editor?.dispose();
  entry.editor = null;
}

/** state/tabKinds.ts's own `dropResources(tabId)` hook — the tab is actually closing. Disposes
 *  whatever widget is still live plus the cached model(s), and forgets this tab entirely. */
export function dropRepoFileTab(tabId: string): void {
  const entry = entries.get(tabId);
  if (!entry) return;
  entry.editor?.dispose();
  for (const uri of entry.uris) disposeModel(uri);
  entries.delete(tabId);
}

/** repo-diff's own dropResources — deliberately named separately from dropRepoFileTab even though
 *  the body is identical (both dispose every cached model uri this entry owns): tabKinds.ts wires
 *  one name per kind, and a shared name would obscure that a diff tab's two models are unrelated
 *  to a file tab's one. */
export function dropRepoDiffTab(tabId: string): void {
  dropRepoFileTab(tabId);
}

export function editorForTab(tabId: string): StandaloneEditor | undefined {
  const entry = entries.get(tabId);
  if (!entry?.editor) return undefined;
  // A diff editor is never what editorForTab's one caller (C10's future gutter work) means.
  return 'getModifiedEditor' in entry.editor ? undefined : entry.editor;
}
