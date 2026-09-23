// P12 round 2 finding #3: run() captured its runtime record (`rt`) locally and only re-checked
// `rt.opId`/`rt.status` after the await — never whether the tab itself still existed. Closing a
// tab mid-run deletes `runtime[tabId]` (state/tabRuntime.ts's cleanup), but `rt` is still a live
// reference to that now-detached object, so the continuation ran anyway: dropResults() was a
// no-op (the runtime entry was already gone) and setPage() wrote the result page into
// resultPages.ts's module-level store under a key nothing can ever reach again (`nextSeq` never
// repeats) — a permanent leak. This drives run() end to end, triggering the exact runtime-cleanup
// hook `state/tabs.ts`'s real `closeTab` fires (`cleanupTabRuntime`, `state/tabRuntime.ts`) while
// the query is still in flight, and asserts nothing gets written once it resolves. Deliberately
// bypasses `closeTab` itself, which also debounces a real `control.tabsSave` IPC call through
// `bridge/port.ts`'s module-scope singleton — `bridge-port.spec.ts` drives that same singleton
// directly against its own fake socket, so triggering a real send from here would race it.
import '@workbench/testing/unit/window';

import { describe, expect, test } from 'bun:test';
import type { ExecuteResponse } from '@shared/protocol/data-ops';
import type { Page } from '@shared/protocol/page';
import { deferred } from '@workbench/testing/unit/async';
import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { data } = await import('../../frontend/src/bridge/data');
restoreAfterEach(data);
const { cleanupTabRuntime } = await import('@workbench/state/tabRuntime');
const { useTabsStore } = await import('../../frontend/src/state/tabs');
const tabsStore = useTabsStore();
const { useConsoleViewStore, resultPageKey } = await import(
  '../../frontend/src/views/console/state'
);
const consoleViewStore = useConsoleViewStore();
const { getPage } = await import('../../frontend/src/views/console/resultPages');

function fakePage(): Page {
  // biome-ignore lint/suspicious/noExplicitAny: minimal fake page, run() only reads kind/rowCount
  return { kind: 'tabular', rowCount: 0 } as any;
}

describe('console run() after the tab closes mid-run (P12 round 2 finding #3)', () => {
  test('the in-flight result is never written once the tab is gone', async () => {
    const tabId = tabsStore.openConsoleTab('conn-close-mid-run', 'db');
    const call = deferred<ExecuteResponse>();
    // biome-ignore lint/suspicious/noExplicitAny: a minimal stub, not the real data.execute
    (data as any).execute = (): Promise<ExecuteResponse> => call.promise;

    const running = consoleViewStore.run(tabId, ['SELECT 1']);
    await Promise.resolve(); // let run() reach the await inside data.execute

    cleanupTabRuntime(tabId); // the real closeTab-time signal — deletes runtime[tabId]
    expect(consoleViewStore.runtime[tabId]).toBeUndefined();

    call.resolve({ pages: [fakePage()] });
    await running;

    expect(consoleViewStore.runtime[tabId]).toBeUndefined();
    // The leaked key run() would otherwise have written under, had it ignored the closed tab.
    expect(getPage(resultPageKey(tabId, 0))).toBeNull();
  });
});
