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

function makeStore() {
  let listCalls = 0;
  const tabs = new Map<string, { state: { itemId?: string | null; responsePane: string } }>();

  const store = createHistoryStore<FakeEntry, FakeSnapshot>({
    list: async (_itemId, _tabId) => {
      listCalls++;
      return [{ id: 'e1' }];
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
});
