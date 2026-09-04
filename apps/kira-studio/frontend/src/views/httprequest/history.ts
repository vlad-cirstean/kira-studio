import type {
  ResponseHistoryEntry,
  ResponseHistorySnapshot,
} from '@shared/domain/response-history';
import { control } from '../../bridge/control';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { findHttpRequestTab } from '../../state/tabs';
import { createRuntimeStore } from '../shared/viewOp';

// P8 D11: the per-tab history runtime — never persisted (P2 D6's rule applied consistently: the
// response is runtime-only, and a pointer at a stored response is not either). What *does*
// persist is tab.state.responsePane === 'history', a pane choice like the two that persist today.
export interface HttpHistoryRuntime {
  entries: ResponseHistoryEntry[] | null; // null = never loaded; [] = loaded and empty
  loading: boolean;
  stale: boolean; // a send happened while the pane was not showing
  viewing: { id: string; snapshot: ResponseHistorySnapshot } | null;
  selected: string[]; // compare selection (D12), at most two
  error: string | null;
}

function defaultRuntime(): HttpHistoryRuntime {
  return { entries: null, loading: false, stale: false, viewing: null, selected: [], error: null };
}

const { runtime, ensureRuntime } = createRuntimeStore<HttpHistoryRuntime>(defaultRuntime);

export { runtime as historyRuntime };

registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

function scopeIdsFor(tabId: string): { itemId: string; tabId: string } {
  const tab = findHttpRequestTab(tabId);
  return { itemId: tab?.state.itemId ?? '', tabId };
}

/** Fetches (or re-fetches) the list for this tab's own scope — the saved request's history, or a
 *  scratch tab's own (D15's empty state names the difference in lifetime between the two). */
export async function loadHistory(tabId: string): Promise<void> {
  const rt = ensureRuntime(tabId);
  rt.loading = true;
  rt.error = null;
  try {
    const { itemId, tabId: tid } = scopeIdsFor(tabId);
    const entries = await control.historyList(itemId, tid);
    if (!findHttpRequestTab(tabId)) return; // the tab closed while this was in flight
    rt.entries = entries;
    rt.stale = false;
  } catch (err) {
    if (!findHttpRequestTab(tabId)) return;
    rt.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (findHttpRequestTab(tabId)) rt.loading = false;
  }
}

/** The one initial load a tab's history ever gets unprompted — called from ResponsePane.vue's own
 *  mount (whether or not the History pane is the one currently selected, and whether or not a
 *  live response exists), mirroring collectionsList's/variablesListEnvironments's own "fetch once
 *  on mount, uncaught" shape (F9's sibling reasoning — mockRuntime.ts's `historyList: '[]'`
 *  wildcard exists for exactly this). Idempotent via the loading guard, so ResponseHistoryList.vue
 *  can call it too (when it mounts before ResponsePane's own onMounted has run) without a double
 *  fetch. This is what lets a *restored* tab with no live response still say "N past responses"
 *  (D10) — without it entries would stay null until the user happened to open the History pane. */
export function ensureHistoryLoaded(tabId: string): void {
  const rt = ensureRuntime(tabId);
  if (rt.entries === null && !rt.loading) void loadHistory(tabId);
}

/** D11's refresh policy: eager when the History pane is showing, lazy (just a `stale` flag)
 *  otherwise — a user who never opens the pane pays no IPC per send. Called once, from state.ts's
 *  send(), right after a response is recorded. */
export function noteSendRecorded(tabId: string): void {
  const tab = findHttpRequestTab(tabId);
  const rt = ensureRuntime(tabId);
  if (tab?.state.responsePane === 'history') {
    void loadHistory(tabId);
  } else {
    rt.stale = true;
  }
}

/** Selects one entry to view (D10's source swap) — control.historyGet's full snapshot, not the
 *  list row alone, since the response pane needs the whole request/response, not just the
 *  summary. */
export async function viewHistoryEntry(tabId: string, id: string): Promise<void> {
  const rt = ensureRuntime(tabId);
  try {
    const snapshot = await control.historyGet(id);
    if (!findHttpRequestTab(tabId)) return;
    rt.viewing = { id, snapshot };
  } catch (err) {
    if (!findHttpRequestTab(tabId)) return;
    rt.error = err instanceof Error ? err.message : String(err);
  }
}

/** The viewing band's "Back to latest" / "Close" action. */
export function backToLatest(tabId: string): void {
  const rt = runtime[tabId];
  if (rt) rt.viewing = null;
}

export async function deleteHistoryEntry(tabId: string, id: string): Promise<void> {
  await control.historyDelete(id);
  const rt = runtime[tabId];
  if (rt?.viewing?.id === id) rt.viewing = null;
  if (rt) rt.selected = rt.selected.filter((s) => s !== id);
  await loadHistory(tabId);
}

/** D15's destructive, unrecoverable action — the caller gates this behind confirmDialog(). */
export async function clearHistory(tabId: string): Promise<void> {
  const { itemId, tabId: tid } = scopeIdsFor(tabId);
  await control.historyClear(itemId, tid);
  const rt = runtime[tabId];
  if (rt) {
    rt.viewing = null;
    rt.selected = [];
  }
  await loadHistory(tabId);
}

/** D12: a checkbox per row, capped at two — toggling a third selected row is a no-op rather than
 *  silently evicting the first (the caller disables an unchecked row's checkbox once two are
 *  already selected, so this is reached only for a check/uncheck of an eligible row). */
export function toggleSelected(tabId: string, id: string): void {
  const rt = ensureRuntime(tabId);
  const i = rt.selected.indexOf(id);
  if (i !== -1) {
    rt.selected.splice(i, 1);
    return;
  }
  if (rt.selected.length >= 2) return;
  rt.selected.push(id);
}
