// P2 R1: console/state.ts's `run()` used to push every run's result set(s) onto `rt.results`
// unconditionally, with nothing ever evicting an old one short of the user's own close/close-others
// action or closing the tab — a tab left open for a long session of many small queries in append
// mode (the default, consoleTabStateSchema's own `newResultSet: true`) retained every one of their
// full decoded pages forever. This file drives the real `run()` end to end (not just the pure
// eviction helper) — data.execute is overridden the same way view-state.spec.ts does for
// data.read/control.treeChildren, so the exercised code is state.ts's actual push+evict sequence,
// not a hand-rolled stand-in for it.
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { ExecuteResponse } from '@shared/protocol/data-ops';
import type { Page } from '@shared/protocol/page';

const { data } = await import('../../frontend/src/bridge/data');
const { openConsoleTab } = await import('../../frontend/src/state/tabs');
const { run, runtime } = await import('../../frontend/src/views/console/state');
const { getPage } = await import('../../frontend/src/views/console/resultPages');

// A minimal fake — state.ts's run() only reads page.kind and page.rowCount, never anything
// shape-specific to a real tabular/document page.
function fakePage(): Page {
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake page, see comment above
  return { kind: 'tabular', rowCount: 0 } as any;
}

describe('console result cap (P2 R1)', () => {
  test('1. append mode evicts the oldest results once a tab holds more than the cap', async () => {
    const tabId = openConsoleTab('conn-cap-1', 'db');
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real ExecuteResponse
    (data as any).execute = (): Promise<ExecuteResponse> =>
      Promise.resolve({ pages: [fakePage()] });

    for (let i = 0; i < 55; i++) await run(tabId, [`SELECT ${i}`]);

    const results = runtime[tabId]?.results ?? [];
    expect(results.length).toBeLessThanOrEqual(50);

    // The very first run's result must be gone from both the list and the underlying page store —
    // otherwise this is just testing that the array stopped growing while still leaking pages.
    const firstKey = `${tabId}:result:0`;
    expect(results.some((r) => r.key === firstKey)).toBe(false);
    expect(getPage(firstKey)).toBeNull();

    // The most recent run's result must still be there.
    const lastKey = results[results.length - 1]?.key;
    expect(lastKey).toBeDefined();
    expect(getPage(lastKey as string)).not.toBeNull();
  });

  test("2. a single run's own result set is never evicted, however many statements it produced", async () => {
    const tabId = openConsoleTab('conn-cap-2', 'db');
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real ExecuteResponse
    (data as any).execute = (): Promise<ExecuteResponse> =>
      Promise.resolve({ pages: [fakePage()] });
    for (let i = 0; i < 10; i++) await run(tabId, [`SELECT ${i}`]);
    expect(runtime[tabId]?.results.length).toBe(10);

    // One "Run all" producing more result sets in a single call than the cap itself.
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real ExecuteResponse
    (data as any).execute = (): Promise<ExecuteResponse> =>
      Promise.resolve({ pages: Array.from({ length: 60 }, () => fakePage()) });
    await run(
      tabId,
      Array.from({ length: 60 }, (_, i) => `SELECT ${i}`),
    );

    // All 10 pre-existing results are evicted to make room, but none of this run's own 60 are —
    // the cap only ever trims *earlier* runs, never truncates the run that just completed.
    expect(runtime[tabId]?.results.length).toBe(60);
  });
});
