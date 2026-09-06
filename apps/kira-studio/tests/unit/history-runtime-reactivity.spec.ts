// P18 D1/D2/D3: createHistoryStore's own guard. F2 found that `stale` (set by noteRecorded's lazy
// branch) had no reader anywhere in the tree, and no commit since P8 ever tested that branch — the
// six cases below are exactly the coverage gap that let the bug ship. F4 found a second, related
// hazard: ensure() returned the raw object (not the reactive proxy) on the call that creates a
// tab's runtime record, which this file's own first case fails against directly.
//
// tree-state.spec.ts's own precedent: `effect()` from vue, no DOM, no bridge — createHistoryStore
// imports only vue and state/tabRuntime.ts (a bare Set), so this needs neither './support/window'
// nor a mocked control.ts.

import { describe, expect, test } from 'bun:test';
import { effect } from 'vue';
import { createHistoryStore } from '../../frontend/src/api/state/history';

interface FakeEntry {
  id: string;
}
interface FakeSnapshot {
  id: string;
}

function makeStore(listImpl?: () => Promise<FakeEntry[]>) {
  let listCalls = 0;
  const tabs = new Map<string, { state: { itemId?: string | null; responsePane: string } }>();

  const store = createHistoryStore<FakeEntry, FakeSnapshot>({
    list: async (_itemId, _tabId) => {
      listCalls++;
      return listImpl ? await listImpl() : [{ id: 'e1' }];
    },
    get: async (id) => ({ id }),
    remove: async () => {},
    clear: async () => {},
    findTab: (tabId) => tabs.get(tabId) ?? null,
  });

  function registerTab(tabId: string, responsePane = 'body'): void {
    tabs.set(tabId, { state: { itemId: 'item-1', responsePane } });
  }

  function setPane(tabId: string, responsePane: string): void {
    const tab = tabs.get(tabId);
    if (tab) tab.state.responsePane = responsePane;
  }

  return { ...store, registerTab, setPane, listCallCount: () => listCalls };
}

/** A promise plus its own resolve, so a test can control exactly when an in-flight `list()` call
 *  settles relative to some other event. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createHistoryStore reactivity and refresh policy (P18 D1/D2/D3)', () => {
  test('1. a write through the FIRST-EVER ensure() call for a tab is tracked (D2)', () => {
    const { ensure, runtime } = makeStore();

    let seenStale: boolean | undefined;
    effect(() => {
      seenStale = runtime['tab-1']?.stale;
    });
    expect(seenStale).toBeUndefined();

    // The very first ensure() call for this tab id — the one F4 found returning the raw,
    // untracked object rather than runtime[tabId]. On the pre-D2 code, this write lands on
    // memory the effect above never reads, so `seenStale` stays undefined.
    const rt = ensure('tab-1');
    rt.stale = true;
    expect(seenStale).toBe(true);
  });

  test('2. noteRecorded with the pane not on History sets stale and makes no list call', async () => {
    const store = makeStore();
    store.registerTab('tab-1', 'body');

    store.noteRecorded('tab-1');
    // noteRecorded's lazy branch is synchronous (no await inside it before the flag write), but
    // give any accidental fire-and-forget load() a tick to prove it really didn't happen.
    await Promise.resolve();

    expect(store.runtime['tab-1'].stale).toBe(true);
    expect(store.listCallCount()).toBe(0);
  });

  test('3. ensureFresh on a stale, already-loaded runtime performs exactly one list call, and clears stale', async () => {
    const store = makeStore();
    store.registerTab('tab-1', 'history');

    // Load once (pane on History), then leave it and come back stale — the exact repro F3 names:
    // pane on History (send #1, eager) -> switch to Body -> send #2 (lazy, sets stale) -> switch
    // back to History, which is where ensureFresh is called from ResponseHistoryList's onMounted.
    await store.load('tab-1');
    expect(store.listCallCount()).toBe(1);
    store.setPane('tab-1', 'body');
    store.noteRecorded('tab-1'); // pane not on History -> stale = true, no list call
    expect(store.runtime['tab-1'].stale).toBe(true);
    expect(store.listCallCount()).toBe(1);

    store.setPane('tab-1', 'history');
    store.ensureFresh('tab-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(store.listCallCount()).toBe(2);
    expect(store.runtime['tab-1'].stale).toBe(false);
  });

  test('4. ensureFresh on a fresh, already-loaded runtime performs no call (P8 D11 laziness preserved)', async () => {
    const store = makeStore();
    store.registerTab('tab-1', 'history');

    await store.load('tab-1');
    expect(store.listCallCount()).toBe(1);

    store.ensureFresh('tab-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(store.listCallCount()).toBe(1);
  });

  test('5. two ensureFresh calls in the same tick perform exactly one list call (the loading guard)', async () => {
    const store = makeStore();
    store.registerTab('tab-1', 'history');

    store.ensureFresh('tab-1');
    store.ensureFresh('tab-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(store.listCallCount()).toBe(1);
  });

  test('6. noteRecorded clears the viewing pointer (D3)', () => {
    const store = makeStore();
    store.registerTab('tab-1', 'body');

    const rt = store.ensure('tab-1');
    rt.viewing = { id: 'stored-1', snapshot: { id: 'stored-1' } };
    expect(store.runtime['tab-1'].viewing).not.toBeNull();

    store.noteRecorded('tab-1');
    expect(store.runtime['tab-1'].viewing).toBeNull();
  });

  // F8/P21 round 1: a load() issued before a send/call completes, resolving after
  // noteRecorded ran, used to clear `stale` (and overwrite `entries`) with a list that predates
  // the recorded send — the exact repro this test drives end to end.
  test("7. a load() that resolves after a concurrent noteRecorded doesn't clobber the stale flag or the list", async () => {
    const first = deferred<FakeEntry[]>();
    let call = 0;
    const listResults = [first.promise, Promise.resolve([{ id: 'e1' }, { id: 'e-new' }])];
    const store = makeStore(() => listResults[call++] as Promise<FakeEntry[]>);
    store.registerTab('tab-1', 'body'); // pane not on History, so noteRecorded only sets stale

    const loadPromise = store.load('tab-1'); // T0: list() call #1 in flight, not yet resolved
    store.noteRecorded('tab-1'); // T1: a send completes while T0 is still in flight
    expect(store.runtime['tab-1'].stale).toBe(true);

    first.resolve([{ id: 'stale-e1' }]); // T2: T0's fetch (answering a question from before T1) resolves
    await loadPromise;

    // T0's own answer must not have been committed — stale must still be true, and entries must
    // not have been overwritten with the pre-send list.
    expect(store.runtime['tab-1'].stale).toBe(true);
    expect(store.runtime['tab-1'].entries).toBeNull();

    // The next real load (e.g. switching to History) fetches and commits normally.
    store.setPane('tab-1', 'history');
    store.ensureFresh('tab-1');
    await Promise.resolve();
    await Promise.resolve();
    expect(store.runtime['tab-1'].stale).toBe(false);
    expect(store.runtime['tab-1'].entries).toEqual([{ id: 'e1' }, { id: 'e-new' }]);
  });

  // P21 round 3 functional finding 4: F8 (round 1) fixed the *commit* side — a superseded load
  // must not overwrite `stale`/`entries` (test 7, above). It left the *retry* side open: nothing
  // ever re-fetched on the superseded load's behalf, so if nothing else was in flight to clear
  // `stale`, it latched true forever and the just-recorded entry never appeared in History until
  // the user sent again or deleted/cleared an entry. This is the exact repro: an in-flight load
  // (from the pane already being on History) is superseded by a send while the pane is elsewhere,
  // and `ensureFresh`'s own `!loading` gate blocks it from doing anything when the pane comes back
  // — the superseded load resolving is the *only* thing left that can ever fetch fresh data.
  test('8. a load superseded by a stale-only noteRecorded (no concurrent load in flight) retries itself, rather than latching stale forever', async () => {
    const first = deferred<FakeEntry[]>();
    let call = 0;
    const listResults = [first.promise, Promise.resolve([{ id: 'e1' }, { id: 'e-new' }])];
    const store = makeStore(() => listResults[call++] as Promise<FakeEntry[]>);
    store.registerTab('tab-1', 'history'); // the pane is already showing History

    const loadPromise = store.load('tab-1'); // seq 1: in flight against a "slow backend"
    expect(store.runtime['tab-1'].loading).toBe(true);

    store.setPane('tab-1', 'body'); // the user switches away
    store.noteRecorded('tab-1'); // a send completes: stale = true, seq bumped to 2 — no new load
    expect(store.runtime['tab-1'].stale).toBe(true);

    store.setPane('tab-1', 'history'); // the user switches back
    store.ensureFresh('tab-1'); // blocked by `loading` (seq 1 hasn't resolved yet) — must do nothing
    expect(store.listCallCount()).toBe(1);

    first.resolve([{ id: 'stale-e1' }]); // seq 1's answer to a question that predates the send
    await loadPromise;
    // Not committed (F8's own rule) — but must not leave `stale` stuck with nothing left to ever
    // clear it: this call must have retried itself instead of silently discarding.
    await Promise.resolve();
    await Promise.resolve();

    expect(store.runtime['tab-1'].stale).toBe(false);
    expect(store.runtime['tab-1'].entries).toEqual([{ id: 'e1' }, { id: 'e-new' }]);
    expect(store.runtime['tab-1'].loading).toBe(false);
  });
});
