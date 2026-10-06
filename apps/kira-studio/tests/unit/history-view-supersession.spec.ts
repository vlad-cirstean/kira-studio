// P168 Part 10 F2/F3: view() commits only the latest selection, and del()/clearAll() never resurrect
// a tab closed during their await.
import { describe, expect, test } from 'bun:test';
import { deferred } from '@workbench/testing/unit/async';
import { createHistoryStore } from '../../frontend/src/api/state/history';

interface Item {
  id: string;
}

function makeStore(overrides: {
  get?: (id: string) => Promise<Item>;
  remove?: () => Promise<void>;
}) {
  const tabs = new Map<string, { state: { itemId: string; responsePane: string } }>();
  let listCalls = 0;
  const store = createHistoryStore<Item, Item>({
    list: async () => {
      listCalls++;
      return [];
    },
    get: overrides.get ?? (async (id) => ({ id })),
    remove: overrides.remove ?? (async () => {}),
    clear: async () => {},
    findTab: (tabId) => tabs.get(tabId) ?? null,
  });
  tabs.set('t', { state: { itemId: 'i', responsePane: 'history' } });
  return { ...store, tabs, listCalls: () => listCalls };
}

describe('history view supersession (F2)', () => {
  test('a slower earlier selection never lands over a later one', async () => {
    const gates = new Map<string, ReturnType<typeof deferred<Item>>>();
    const { view, runtime } = makeStore({
      get: (id) => {
        const d = deferred<Item>();
        gates.set(id, d);
        return d.promise;
      },
    });
    const a = view('t', 'A');
    const b = view('t', 'B');
    gates.get('B')?.resolve({ id: 'B' });
    await b;
    gates.get('A')?.resolve({ id: 'A' });
    await a;
    expect(runtime.t?.viewing?.id).toBe('B');
  });

  test('a snapshot resolving after a fresh send does not re-show the old entry', async () => {
    const gate = deferred<Item>();
    const { view, noteRecorded, runtime } = makeStore({ get: () => gate.promise });
    const pending = view('t', 'A');
    noteRecorded('t');
    gate.resolve({ id: 'A' });
    await pending;
    expect(runtime.t?.viewing).toBeNull();
  });
});

describe('history delete after tab close (F3)', () => {
  test('a tab closed during remove gets no runtime recreated', async () => {
    const gate = deferred<void>();
    const { del, tabs, runtime, listCalls } = makeStore({ remove: () => gate.promise });
    const pending = del('t', 'A');
    tabs.delete('t');
    gate.resolve();
    await pending;
    expect(runtime.t).toBeUndefined();
    expect(listCalls()).toBe(0);
  });

  test('a failed remove lands in rt.error instead of rejecting', async () => {
    const { del, runtime } = makeStore({
      remove: async () => {
        throw new Error('disk full');
      },
    });
    await del('t', 'A');
    expect(runtime.t?.error).toBe('disk full');
  });
});
