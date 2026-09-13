// C5 §9.3/§12: the tabId -> editor registry. Two jobs: (1) this phase's own model-lifecycle
// bookkeeping — a tab switch away unmounts the Vue component (MainView's `v-if`, the same as every
// other tab view in this app) but must not lose the loaded buffer, so the editor *widget* disposes
// on unmount while the model stays cached (monaco.ts's own modelCache) until the tab actually
// closes; (2) C6/C10's own reserved seam — the live IStandaloneCodeEditor instances,
// definition/hover providers and gutter decorations attach to.
import { disposeModel } from './monaco';

type StandaloneEditor = import('monaco-editor').editor.IStandaloneCodeEditor;

interface RepoFileEntry {
  uri: string;
  editor: StandaloneEditor | null;
}

const entries = new Map<string, RepoFileEntry>();

/** Called on mount (and on every remount after a tab-switch-away) — replaces any previous entry. */
export function registerEditor(tabId: string, uri: string, editor: StandaloneEditor): void {
  entries.set(tabId, { uri, editor });
}

/** Called on Vue unmount (a tab switch away, not a close) — disposes the widget, keeps the uri so
 *  dropResources can still find the model to dispose later if the tab is closed while unmounted. */
export function unmountEditor(tabId: string): void {
  const entry = entries.get(tabId);
  if (!entry) return;
  entry.editor?.dispose();
  entry.editor = null;
}

/** state/tabKinds.ts's own `dropResources(tabId)` hook — the tab is actually closing. Disposes
 *  whatever widget is still live plus the cached model, and forgets this tab entirely. */
export function dropRepoFileTab(tabId: string): void {
  const entry = entries.get(tabId);
  if (!entry) return;
  entry.editor?.dispose();
  disposeModel(entry.uri);
  entries.delete(tabId);
}

export function editorForTab(tabId: string): StandaloneEditor | undefined {
  return entries.get(tabId)?.editor ?? undefined;
}
