import { registerTabRuntimeCleanup } from '@workbench/state/tabRuntime';
import { reactive } from 'vue';

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
  //
  // P108 F1: this used one counter for both signals — "a newer load exists" and "marked stale
  // while in flight" — and had every retry re-bump it. Two overlapping loads each saw the other's
  // bump as "I was superseded", retried, and that retry's own bump made the other's in-flight
  // fetch look superseded too, forever (109 list calls in 300ms in the finding's harness, `loading`
  // stuck true). `latestSeq` now means only "a newer load() call exists" (a load discards quietly
  // — the newer load owns the result, no retry). `staleSeq` means only "noteRecorded marked stale
  // while a load was in flight" (that load retries once to pick it up). A retry bumps `latestSeq`
  // like any other load, but that no longer causes a loop: the older load it supersedes just
  // discards, and nothing keeps re-triggering `staleSeq` on its own.
  const latestSeq = new Map<string, number>();
  function bumpSeq(tabId: string): number {
    const next = (latestSeq.get(tabId) ?? 0) + 1;
    latestSeq.set(tabId, next);
    return next;
  }
  const staleSeq = new Map<string, number>();
  function bumpStale(tabId: string): void {
    staleSeq.set(tabId, (staleSeq.get(tabId) ?? 0) + 1);
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
    staleSeq.delete(tabId);
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
    const staleAtStart = staleSeq.get(tabId) ?? 0;
    rt.loading = true;
    rt.error = null;
    // P21 round 3 functional finding 4 / P108 F1: set below whenever this call's own `finally`
    // must not clear `loading` out from under someone else still owning it — either a retry this
    // call itself kicked off, or a newer load() call that started while this one was in flight.
    let skipLoadingClear = false;
    try {
      const { itemId, tabId: tid } = scopeIdsFor(tabId);
      const entries = await opts.list(itemId, tid);
      if (!opts.findTab(tabId)) return; // the tab closed while this was in flight
      if (latestSeq.get(tabId) !== mySeq) {
        // P108 F1: a newer load() call started while this fetch was in flight — that load owns
        // `loading`/`entries` and (if itself superseded) its own retry chain. This one's answer is
        // simply stale; discard quietly. Retrying here too was the bug: the retry's own bumpSeq
        // made the newer load look superseded in turn, and the pair kept re-superseding each other
        // forever (F1's 300ms/109-call harness).
        skipLoadingClear = true;
        return;
      }
      // Only commit if no noteRecorded marked this tab stale while the fetch was in flight —
      // otherwise this answer predates a send/call this fetch's own snapshot doesn't reflect.
      // `?? 0` matters here: an untouched tab's `staleSeq` entry is `undefined`, and `staleAtStart`
      // above already normalizes that same read to `0` — comparing this read bare against that
      // would spuriously mismatch (`undefined !== 0`) and force a retry on every ordinary load.
      if ((staleSeq.get(tabId) ?? 0) === staleAtStart) {
        rt.entries = entries;
        rt.stale = false;
      } else {
        // F8's own retry-side hole: a load superseded by noteRecorded's `stale = true` branch
        // used to be silently discarded here, leaving `stale` set with nothing left to ever clear
        // it. The just-sent response then never appeared in History until the user sent again or
        // deleted/cleared an entry. Retrying converges: `staleSeq` only advances on a genuine new
        // noteRecorded call, so this bottoms out once sends/calls stop arriving faster than a
        // fetch can complete — unlike the old shared counter, a retry does not itself re-trigger
        // this branch.
        skipLoadingClear = true;
        void load(tabId);
      }
    } catch (err) {
      if (!opts.findTab(tabId)) return;
      rt.error = err instanceof Error ? err.message : String(err);
    } finally {
      if (opts.findTab(tabId) && !skipLoadingClear) rt.loading = false;
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
      // Mark any in-flight load stale (F8) — one issued before this send/call completed must not
      // resolve afterward and clear the `stale` flag this line just set. P108 F1: this used to
      // share `latestSeq` with load()'s own "a newer load exists" signal, which made every retry
      // this triggered look like a newer load to any other in-flight load too. `staleSeq` is its
      // own counter now — it only tells an in-flight load "retry once", never "someone else owns
      // this now".
      bumpStale(tabId);
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
