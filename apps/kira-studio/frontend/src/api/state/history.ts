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

  // F8/P21 round 1: load() had no sequencing against noteRecorded()/del()/clearAll() — a load
  // issued before a send/call completed, but resolving after noteRecorded ran, cleared `stale`
  // (and wrote the pre-send list) as if it were the freshest answer, leaving the just-recorded
  // entry permanently missing from the list until the next send or an explicit delete/clear (the
  // same failure P18 S1/S2 root-caused for the read side). Each tab's own monotonic counter: a
  // load only commits its result if nothing newer (another load, or a noteRecorded marking stale)
  // has started since — the same opId-supersession shape the view stores already use elsewhere.
  const latestSeq = new Map<string, number>();
  function bumpSeq(tabId: string): number {
    const next = (latestSeq.get(tabId) ?? 0) + 1;
    latestSeq.set(tabId, next);
    return next;
  }

  function ensure(tabId: string): Runtime {
    // D2: always hand back runtime[tabId] — never the freshly-built literal. `runtime` is a deep
    // reactive(); reading the indexed property returns the tracked proxy, but returning the local
    // object on the creating call hands out the untracked target instead, so a write through it
    // (e.g. noteRecorded's own `rt.stale = true` on a tab's first-ever call) mutates the right
    // memory but triggers no effect. One extra lookup, permanently closes that class of bug (F4).
    if (!runtime[tabId]) {
      runtime[tabId] = {
        entries: null,
        loading: false,
        stale: false,
        viewing: null,
        error: null,
        ...(opts.extra ? opts.extra() : ({} as Extra)),
      };
    }
    return runtime[tabId] as Runtime;
  }

  registerTabRuntimeCleanup((tabId) => {
    delete runtime[tabId];
    latestSeq.delete(tabId);
  });

  function scopeIdsFor(tabId: string): { itemId: string; tabId: string } {
    const tab = opts.findTab(tabId);
    return { itemId: tab?.state.itemId ?? '', tabId };
  }

  /** Fetches (or re-fetches) the list for this tab's own scope — the saved request's history, or
   *  a scratch tab's own. */
  async function load(tabId: string): Promise<void> {
    const rt = ensure(tabId);
    const mySeq = bumpSeq(tabId);
    rt.loading = true;
    rt.error = null;
    // P21 round 3 functional finding 4: set below only on the "superseded while in flight, so a
    // retry now owns `loading`" branch — this call's own `finally` must not clear `loading` out
    // from under that retry.
    let retried = false;
    try {
      const { itemId, tabId: tid } = scopeIdsFor(tabId);
      const entries = await opts.list(itemId, tid);
      if (!opts.findTab(tabId)) return; // the tab closed while this was in flight
      // Only commit if nothing newer started while this fetch was in flight — otherwise this is
      // an answer to a question already superseded (a fresher load, or a noteRecorded that this
      // fetch's own snapshot predates).
      if (latestSeq.get(tabId) === mySeq) {
        rt.entries = entries;
        rt.stale = false;
      } else {
        // F8's own retry-side hole: a load superseded by noteRecorded's `stale = true` branch
        // (which only bumps the sequence counter — it never itself starts a new load) used to be
        // silently discarded here, leaving `stale` set with nothing left to ever clear it. The
        // just-sent response then never appeared in History until the user sent again or deleted/
        // cleared an entry. Retrying converges: either nothing supersedes the retry and it commits
        // normally, or it is itself superseded and retries again, until sends/calls stop arriving
        // faster than a fetch can complete.
        retried = true;
        void load(tabId);
      }
    } catch (err) {
      if (!opts.findTab(tabId)) return;
      rt.error = err instanceof Error ? err.message : String(err);
    } finally {
      if (opts.findTab(tabId) && !retried) rt.loading = false;
    }
  }

  /** The one refetch a tab's history ever gets unprompted: on the pane's own mount, and whenever
   *  the pane becomes visible again. Fetches when the list has never loaded (entries === null) OR
   *  when a send/call happened while this pane was not showing (stale, D1). Idempotent via the
   *  loading guard, so two callers mounting in the same tick pay one fetch. */
  function ensureFresh(tabId: string): void {
    const rt = ensure(tabId);
    if ((rt.entries === null || rt.stale) && !rt.loading) void load(tabId);
  }

  /** Eager when the History pane is showing, lazy (just a `stale` flag) otherwise — a user who
   *  never opens the pane pays no IPC per send/call. D3: a send/call always asks for *this*
   *  response, so it also clears any stored entry currently being viewed — leaving one on screen
   *  after a fresh send is the same complaint as a stale list. */
  function noteRecorded(tabId: string): void {
    const tab = opts.findTab(tabId);
    const rt = ensure(tabId);
    rt.viewing = null;
    if (tab?.state.responsePane === 'history') {
      void load(tabId);
    } else {
      rt.stale = true;
      // Supersede any in-flight load (F8) — one issued before this send/call completed must not
      // resolve afterward and clear the `stale` flag this line just set.
      bumpSeq(tabId);
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

  return { runtime, ensure, load, ensureFresh, noteRecorded, view, backToLatest, del, clearAll };
}
