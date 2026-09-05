import { reactive } from 'vue';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';

// P12 D12: the per-tab history runtime the two protocols shared byte-for-byte (F9) — same
// {entries, loading, stale, viewing, error} shape, same seven functions, differing only in the
// four `control` methods, the two snapshot types, the tab finder and HTTP's own extra
// `selected: string[]` compare list (carried through `Extra` rather than forcing gRPC to have
// one). Deliberately does not reuse views/shared/viewOp.ts's createRuntimeStore: that file lives
// under views/**, which api/** (D16 rule (a)) may not import — the five-line reactive-record
// pattern is small enough to own here rather than reach across that boundary for it.
export interface HistoryRuntime<Entry, Snapshot> {
  entries: Entry[] | null; // null = never loaded; [] = loaded and empty
  loading: boolean;
  stale: boolean; // a send/call happened while the pane was not showing
  viewing: { id: string; snapshot: Snapshot } | null;
  error: string | null;
}

interface HistoryStoreOptions<Entry, Snapshot, Extra extends object> {
  list: (itemId: string, tabId: string) => Promise<Entry[]>;
  get: (id: string) => Promise<Snapshot>;
  remove: (id: string) => Promise<void>;
  clear: (itemId: string, tabId: string) => Promise<void>;
  findTab: (tabId: string) => { state: { itemId?: string | null; responsePane: string } } | null;
  extra?: () => Extra;
}

export function createHistoryStore<Entry, Snapshot, Extra extends object = Record<string, never>>(
  opts: HistoryStoreOptions<Entry, Snapshot, Extra>,
) {
  type Runtime = HistoryRuntime<Entry, Snapshot> & Extra;

  const runtime = reactive({} as Record<string, Runtime>);

  function ensure(tabId: string): Runtime {
    let rt = runtime[tabId];
    if (!rt) {
      rt = {
        entries: null,
        loading: false,
        stale: false,
        viewing: null,
        error: null,
        ...(opts.extra ? opts.extra() : ({} as Extra)),
      };
      runtime[tabId] = rt;
    }
    return rt;
  }

  registerTabRuntimeCleanup((tabId) => {
    delete runtime[tabId];
  });

  function scopeIdsFor(tabId: string): { itemId: string; tabId: string } {
    const tab = opts.findTab(tabId);
    return { itemId: tab?.state.itemId ?? '', tabId };
  }

  /** Fetches (or re-fetches) the list for this tab's own scope — the saved request's history, or
   *  a scratch tab's own. */
  async function load(tabId: string): Promise<void> {
    const rt = ensure(tabId);
    rt.loading = true;
    rt.error = null;
    try {
      const { itemId, tabId: tid } = scopeIdsFor(tabId);
      const entries = await opts.list(itemId, tid);
      if (!opts.findTab(tabId)) return; // the tab closed while this was in flight
      rt.entries = entries;
      rt.stale = false;
    } catch (err) {
      if (!opts.findTab(tabId)) return;
      rt.error = err instanceof Error ? err.message : String(err);
    } finally {
      if (opts.findTab(tabId)) rt.loading = false;
    }
  }

  /** The one initial load a tab's history ever gets unprompted — called from the response pane's
   *  own mount, whether or not History is the currently-selected pane. Idempotent via the loading
   *  guard, so a second caller mounting first pays no double fetch. */
  function ensureLoaded(tabId: string): void {
    const rt = ensure(tabId);
    if (rt.entries === null && !rt.loading) void load(tabId);
  }

  /** Eager when the History pane is showing, lazy (just a `stale` flag) otherwise — a user who
   *  never opens the pane pays no IPC per send/call. */
  function noteRecorded(tabId: string): void {
    const tab = opts.findTab(tabId);
    const rt = ensure(tabId);
    if (tab?.state.responsePane === 'history') {
      void load(tabId);
    } else {
      rt.stale = true;
    }
  }

  /** Selects one entry to view — the full snapshot, not the list row alone. */
  async function view(tabId: string, id: string): Promise<void> {
    const rt = ensure(tabId);
    try {
      const snapshot = await opts.get(id);
      if (!opts.findTab(tabId)) return;
      rt.viewing = { id, snapshot };
    } catch (err) {
      if (!opts.findTab(tabId)) return;
      rt.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** The viewing band's "Back to latest" / "Close" action. */
  function backToLatest(tabId: string): void {
    const rt = runtime[tabId];
    if (rt) rt.viewing = null;
  }

  async function del(tabId: string, id: string): Promise<void> {
    await opts.remove(id);
    const rt = runtime[tabId];
    if (rt?.viewing?.id === id) rt.viewing = null;
    await load(tabId);
  }

  /** The destructive, unrecoverable action — the caller gates this behind confirmDialog(). */
  async function clearAll(tabId: string): Promise<void> {
    const { itemId, tabId: tid } = scopeIdsFor(tabId);
    await opts.clear(itemId, tid);
    const rt = runtime[tabId];
    if (rt) rt.viewing = null;
    await load(tabId);
  }

  return { runtime, ensure, load, ensureLoaded, noteRecorded, view, backToLatest, del, clearAll };
}
