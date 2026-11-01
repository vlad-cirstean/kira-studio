// The tabId -> editor registry. Two jobs: (1) model-lifecycle
// bookkeeping — a tab switch away unmounts the Vue component (MainView's `v-if`, the same as every
// other tab view in this app) but must not lose the loaded buffer, so the editor *widget* disposes
// on unmount while the model stays cached (monaco.ts's own modelCache) until the tab closes;
// (2) the reserved seam — the live IStandaloneCodeEditor instances,
// definition/hover providers and gutter decorations attach to.
//
// Widened to one entry shape covering both a repo-file tab's single model/editor and a
// repo-diff tab's pair — one map, one lifecycle, rather than a second parallel map that would give
// closeTab's single dropResources call two places to forget. editorForTab keeps returning a
// standalone code editor only (its one caller, the future gutter work, means that one).
import { disposeModel } from './monaco';

type StandaloneEditor = import('monaco-editor').editor.IStandaloneCodeEditor;
type StandaloneDiffEditor = import('monaco-editor').editor.IStandaloneDiffEditor;

type CodeViewState = import('monaco-editor').editor.ICodeEditorViewState;
type DiffViewState = import('monaco-editor').editor.IDiffEditorViewState;

/** What a mount read from disk and the model versions that held it afterwards. A later mount asks
 *  the backend to skip a side that still matches, and only while the model is still unedited. */
export interface KnownRead {
  stat?: import('@shared/domain/repo').FileStat;
  headOid?: string;
  versionIds: number[];
}

interface RepoEditorEntry {
  uris: string[];
  editor: StandaloneEditor | StandaloneDiffEditor | null;
  /** Scroll, cursor and folds captured on unmount, so a remount reopens where the user left off. */
  viewState: CodeViewState | DiffViewState | null;
  known: KnownRead | null;
}

const entries = new Map<string, RepoEditorEntry>();

// openRepoCommitDiffTab/openRepoReviewDiffTab deliberately keep separate tabs open for what
// can be an identical (path, left, right) revision pair (e.g. a commit-diff tab and a review-diff
// tab over the same range, or two branches sharing a tip/base) — monaco.ts's
// repoRevisionDiffUris keys the underlying models by revision alone, so two such tabs share the
// exact same cached model objects. That sharing is harmless while both stay open (the content is
// immutable, read-only, identical either way) but disposeModel used to run unconditionally on
// close: closing one tab tore down models the other tab was still actively displaying. Tracked
// here as "which open tabs currently reference this uri" — a uri is only ever handed to
// disposeModel once its last referencing tab closes.
const tabIdsByUri = new Map<string, Set<string>>();

function addRefs(tabId: string, uris: readonly string[]): void {
  for (const uri of uris) {
    let tabIds = tabIdsByUri.get(uri);
    if (!tabIds) {
      tabIds = new Set();
      tabIdsByUri.set(uri, tabIds);
    }
    tabIds.add(tabId);
  }
}

/** Drops tabId's own reference to each of `uris`, returning only the ones now unreferenced by any
 *  open tab — the sole set actually safe to hand to disposeModel. */
function releaseRefs(tabId: string, uris: readonly string[]): string[] {
  const releasable: string[] = [];
  for (const uri of uris) {
    const tabIds = tabIdsByUri.get(uri);
    if (!tabIds) continue;
    tabIds.delete(tabId);
    if (tabIds.size === 0) {
      tabIdsByUri.delete(uri);
      releasable.push(uri);
    }
  }
  return releasable;
}

/** Called on mount (and on every remount after a tab-switch-away) — replaces any previous entry.
 *  Returns true when a view state saved by the last unmount was restored, so the caller skips its
 *  own persisted-line reveal. */
export function registerEditor(tabId: string, uri: string, editor: StandaloneEditor): boolean {
  const prior = entries.get(tabId);
  const viewState = prior?.viewState ?? null;
  releaseUnusedPriorRefs(tabId, [uri]);
  addRefs(tabId, [uri]);
  entries.set(tabId, { uris: [uri], editor, viewState, known: prior?.known ?? null });
  if (!viewState) return false;
  editor.restoreViewState(viewState as CodeViewState);
  return true;
}

/** repo-diff's own counterpart to registerEditor — two model uris (HEAD, worktree), one diff
 *  editor widget. */
export function registerDiffEditor(
  tabId: string,
  uris: string[],
  editor: StandaloneDiffEditor,
): void {
  const prior = entries.get(tabId);
  const viewState = prior?.viewState ?? null;
  releaseUnusedPriorRefs(tabId, uris);
  addRefs(tabId, uris);
  entries.set(tabId, { uris, editor, viewState, known: prior?.known ?? null });
  if (viewState) editor.restoreViewState(viewState as DiffViewState);
}

// A remount always recomputes the identical uris for the same tab (they're a pure function of the
// tab's own stable revision pair/path), so this is normally a no-op — defensive only, in case a
// future caller ever re-registers the same tabId against a different uri without an intervening
// close: without it, the stale uri's ref would never be released and could never be disposed.
function releaseUnusedPriorRefs(tabId: string, nextUris: readonly string[]): void {
  const prior = entries.get(tabId);
  if (!prior) return;
  const stale = prior.uris.filter((uri) => !nextUris.includes(uri));
  for (const uri of releaseRefs(tabId, stale)) disposeModel(uri);
}

/** Records what the current mount read, once its editor is registered. */
export function rememberRead(tabId: string, known: KnownRead): void {
  const entry = entries.get(tabId);
  if (entry) entry.known = known;
}

/** The last read, if every model that held it is still unedited. */
export function knownRead(tabId: string, currentVersionIds: readonly number[]): KnownRead | null {
  const known = entries.get(tabId)?.known;
  if (!known || known.versionIds.length !== currentVersionIds.length) return null;
  return known.versionIds.every((v, i) => v === currentVersionIds[i]) ? known : null;
}

/** Called on Vue unmount (a tab switch away, not a close) — disposes the widget, keeps the uris so
 *  dropResources can still find the model(s) to dispose later if the tab is closed while
 *  unmounted. Works for either a repo-file or a repo-diff entry. */
export function unmountEditor(tabId: string): void {
  const entry = entries.get(tabId);
  if (!entry) return;
  entry.viewState = entry.editor?.saveViewState() ?? entry.viewState;
  entry.editor?.dispose();
  entry.editor = null;
}

/** state/tabKinds.ts's own `dropResources(tabId)` hook — the tab is actually closing. Disposes
 *  whatever widget is still live plus the cached model(s) — C14-5: only the ones no other open tab
 *  still references (releaseRefs) — and forgets this tab entirely. */
export function dropRepoFileTab(tabId: string): void {
  const entry = entries.get(tabId);
  if (!entry) return;
  entry.editor?.dispose();
  for (const uri of releaseRefs(tabId, entry.uris)) disposeModel(uri);
  entries.delete(tabId);
}

/** local-file's own dropResources: same body as dropRepoFileTab, named per kind like the others. */
export function dropLocalFileTab(tabId: string): void {
  dropRepoFileTab(tabId);
}

/** repo-diff's own dropResources — deliberately named separately from dropRepoFileTab even though
 *  the body is identical (both dispose every cached model uri this entry owns): tabKinds.ts wires
 *  one name per kind, and a shared name would obscure that a diff tab's two models are unrelated
 *  to a file tab's one. */
export function dropRepoDiffTab(tabId: string): void {
  dropRepoFileTab(tabId);
}

/** repo-multi-diff's own dropResources — a multi-diff tab registers several diff
 *  editors under one tab id, each keyed `${tabId}:${path}` (useDiffEditor.ts's own editorKey,
 *  set once per expanded section), never the plain tabId itself. Every entry whose key belongs to
 *  this tab is found and dropped, not a single exact-key lookup like dropRepoFileTab's. */
export function dropRepoMultiDiffTab(tabId: string): void {
  const prefix = `${tabId}:`;
  for (const key of [...entries.keys()]) {
    if (key.startsWith(prefix)) dropRepoFileTab(key);
  }
}

export function editorForTab(tabId: string): StandaloneEditor | undefined {
  const entry = entries.get(tabId);
  if (!entry?.editor) return undefined;
  // A diff editor is never what editorForTab's one caller (C10's future gutter work) means.
  return 'getModifiedEditor' in entry.editor ? undefined : entry.editor;
}
