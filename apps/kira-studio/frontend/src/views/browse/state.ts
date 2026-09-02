import { pathParent, type TreeNode } from '@shared/domain/tree';
import { control } from '../../bridge/control';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findBrowseTab, patchBrowseTabState, unmarkHydrated } from '../../state/tabs';
import { registerBrowseInvalidate, registerTabReload } from '../../state/viewCommands';
import { classifyLoadError, createRuntimeStore } from '../shared/viewOp';

// P41 D12: one level at a time, loaded by a single `treeChildren` call — never a second tree.
// `nodes` holds exactly what `children(level)` returned; there is nothing to page (D16 — this is
// not a cancellable engine op, `kira:tree:children` never has been).
export interface BrowseViewRuntime {
  status: 'idle' | 'loading' | 'error';
  error: { code: string; message: string } | null;
  /** P43 F6/D7: the last *action* (a key/object delete from this level) that failed, verbatim
   *  from the server — sibling to `error` (a failed *load*), never a reuse of it. Cleared by the
   *  next successful action or load. */
  actionError: string | null;
  nodes: TreeNode[];
  /** P43 iter2 F16/D23: this level's own listing stopped at the adapter's own round budget —
   *  BrowseView.vue's own strip is the only surface that renders these levels (P41 D5 cut the
   *  tree at the container). Refresh is the only affordance that can try again. */
  truncated: boolean;
  /** Substring filter over `nodes` (D18), runtime-only — mirrors grid/state.ts's `searchOpen`. */
  filter: string;
  /** The row that holds the list's roving tab stop, by path. */
  selected: string | null;
  /** P43 iter3 D39: monotonic per tab. `load()` captures it before its own await and drops its
   *  result on all three exit paths if a newer load has started since — the same supersession
   *  guard grid/documents/keyvalue/stream all keep as `opId`, expressed as a counter because
   *  `kira:tree:children` is not a cancellable engine op and has no op id to compare (D16, above). */
  loadSeq: number;
}

function defaultRuntime(): BrowseViewRuntime {
  return {
    status: 'idle',
    error: null,
    actionError: null,
    nodes: [],
    truncated: false,
    filter: '',
    selected: null,
    loadSeq: 0,
  };
}

const { runtime, ensureRuntime, setActionError } =
  createRuntimeStore<BrowseViewRuntime>(defaultRuntime);

export { runtime };

registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

/** P43 F6/D7: written by browse/menu.ts's own catch around a row's Delete item. */
export { setActionError };

/** The level a tab is currently showing — `''` in session state means "the tab's own container
 *  path" (D14), so a freshly opened tab and one restored at its root agree. */
function currentLevel(tabId: string): string | null {
  const tab = findBrowseTab(tabId);
  if (!tab?.connectionId) return null;
  return tab.state.levelPath === '' ? tab.path : tab.state.levelPath;
}

export async function load(tabId: string, opts?: { refresh?: boolean }): Promise<void> {
  const tab = findBrowseTab(tabId);
  if (!tab?.connectionId) return;
  const level = currentLevel(tabId);
  if (level === null) return;
  const rt = ensureRuntime(tabId);
  const seq = ++rt.loadSeq;
  rt.status = 'loading';
  rt.error = null;
  rt.actionError = null;
  rt.truncated = false;
  try {
    const result = await control.treeChildren(tab.connectionId, level, opts?.refresh ?? false);
    if (rt.loadSeq !== seq) return; // superseded by a newer load
    rt.nodes = result.nodes;
    rt.truncated = result.truncated;
    rt.status = 'idle';
  } catch (err) {
    if (rt.loadSeq !== seq) return; // superseded by a newer load
    const failure = classifyLoadError(err);
    if (failure.kind === 'disconnected') {
      rt.status = 'idle';
      unmarkHydrated(tabId);
      return;
    }
    rt.status = 'error';
    rt.error = { code: failure.code, message: failure.message };
  }
}

export async function reload(tabId: string): Promise<void> {
  await load(tabId, { refresh: true });
}

// Normalizes `level` back to `''` when it equals the tab's own container path, so a tab that
// descends and returns to its root looks identical (in session state) to one that never left it.
async function setLevel(tabId: string, level: string): Promise<void> {
  const tab = findBrowseTab(tabId);
  if (!tab) return;
  patchBrowseTabState(tabId, { levelPath: level === tab.path ? '' : level });
  await load(tabId);
}

/** A container row's own path — one level deeper. */
export async function descend(tabId: string, path: string): Promise<void> {
  await setLevel(tabId, path);
}

/** Up — one level shallower. A no-op at the tab's own container (nothing shallower to show). */
export async function ascend(tabId: string): Promise<void> {
  const tab = findBrowseTab(tabId);
  const level = currentLevel(tabId);
  if (!tab || level === null || level === tab.path) return;
  const parent = pathParent(level);
  if (parent === null) return;
  await setLevel(tabId, parent);
}

/** The breadcrumb's own jump — to any ancestor level, not just the immediate parent. */
export async function goToLevel(tabId: string, path: string): Promise<void> {
  await setLevel(tabId, path);
}

export function setFilter(tabId: string, filter: string): void {
  const rt = runtime[tabId];
  if (rt) rt.filter = filter;
}

export function selectRow(tabId: string, path: string | null): void {
  const rt = runtime[tabId];
  if (rt) rt.selected = path;
}

// P41 D14: an S3 upload/delete lands in a level the project tree no longer renders (F22) — this
// is how UploadObjectDialog.vue (and any future Browse-panel mutation) tells a live Browse tab
// its own currently-shown level may be stale, without project/ importing views/ directly.
async function invalidateLevel(connectionId: string, path: string): Promise<void> {
  for (const tabId of Object.keys(runtime)) {
    const tab = findBrowseTab(tabId);
    if (!tab || tab.connectionId !== connectionId) continue;
    if (currentLevel(tabId) !== path) continue;
    await load(tabId, { refresh: true });
  }
}

registerTabReload('browse', reload);
registerBrowseInvalidate(invalidateLevel);
