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

// C14-5: openRepoCommitDiffTab/openRepoReviewDiffTab deliberately keep separate tabs open for what
// can be an identical (path, left, right) revision pair (e.g. a commit-diff tab and a review-diff
// tab over the same range, or two branches sharing a tip/base per C13-1) — monaco.ts's
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

/** Called on mount (and on every remount after a tab-switch-away) — replaces any previous entry. */
export function registerEditor(tabId: string, uri: string, editor: StandaloneEditor): void {
  releaseUnusedPriorRefs(tabId, [uri]);
  addRefs(tabId, [uri]);
  entries.set(tabId, { uris: [uri], editor });
}

/** repo-diff's own counterpart to registerEditor — two model uris (HEAD, worktree), one diff
 *  editor widget. */
export function registerDiffEditor(
  tabId: string,
  uris: string[],
  editor: StandaloneDiffEditor,
): void {
  releaseUnusedPriorRefs(tabId, uris);
  addRefs(tabId, uris);
  entries.set(tabId, { uris, editor });
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
 *  whatever widget is still live plus the cached model(s) — C14-5: only the ones no other open tab
 *  still references (releaseRefs) — and forgets this tab entirely. */
export function dropRepoFileTab(tabId: string): void {
  const entry = entries.get(tabId);
  if (!entry) return;
  entry.editor?.dispose();
  for (const uri of releaseRefs(tabId, entry.uris)) disposeModel(uri);
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
