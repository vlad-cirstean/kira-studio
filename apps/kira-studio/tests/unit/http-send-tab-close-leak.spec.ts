// P108 F8: closing an HTTP tab mid-send leaked both the in-flight op and a history runtime entry.
// Unlike gRPC's own cleanup (views/grpcrequest/state.ts, stopOp before delete), HTTP's cleanup was
// only `delete runtime[tabId]` — the send kept running in Go and recording history, and on
// completion `rt.opId !== opId` still passed (rt is a captured reference cleanup never mutates),
// so noteSendRecorded ran for the closed tab, recreating a history runtime and seq entry
// (api/state/history.ts) nothing ever cleans up again. This pins both halves: the op is cancelled
// on close, and the post-await path is a no-op once the tab is gone.
import '@workbench/testing/unit/window';

import { beforeEach, describe, expect, test } from 'bun:test';
import type { HttpResponseWire } from '@shared/domain/http';
import { deferred } from '@workbench/testing/unit/async';
import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);
// P108 Part 12 F12: createTabsStore's saveIfChanged now serialises every save through one
// persistent chain — a real (never-settling in this harness) control.tabsSave triggered
// incidentally by opening a tab below would otherwise wedge every later spec's own tabsSave
// assertions for the rest of the process. This spec doesn't test persistence, so give it a
// benign default.
beforeEach(() => {
  (control as unknown as { tabsSave: typeof control.tabsSave }).tabsSave = () => Promise.resolve();
});
const { openApiRequestTab } = await import('../../frontend/src/api/tabs');
const { useTabsStore } = await import('../../frontend/src/state/tabs');
const { useHttpRequestViewStore } = await import('../../frontend/src/views/httprequest/state');
const { useHttpHistoryStore } = await import('../../frontend/src/views/httprequest/history');

function response(): HttpResponseWire {
  return {
    status: 200,
    statusText: 'OK',
    headers: [],
    body: '',
    bodyEncoding: 'utf8',
    bodyTruncated: false,
    durationMs: 0,
    sizeBytes: 0,
  } as unknown as HttpResponseWire;
}

describe('closing an HTTP tab mid-send stops the op and leaks no history runtime (P108 F8)', () => {
  test('cleanup cancels the op, and the send that was already in flight is a no-op on completion', async () => {
    const tabId = openApiRequestTab();
    const httpSend = deferred<HttpResponseWire>();
    let cancelledOpId: string | undefined;
    (control as unknown as { httpSend: typeof control.httpSend }).httpSend = () => httpSend.promise;
    (control as unknown as { opsCancel: typeof control.opsCancel }).opsCancel = async (
      opId: string,
    ) => {
      cancelledOpId = opId;
    };

    const httpRequestViewStore = useHttpRequestViewStore();
    const sendPromise = httpRequestViewStore.send(tabId);
    await Promise.resolve(); // let send() reach and issue the await

    const opId = httpRequestViewStore.runtime[tabId]?.opId ?? undefined;
    expect(opId).toBeTruthy();

    useTabsStore().closeTab(tabId);
    // Cleanup must cancel the in-flight op, not just drop the runtime silently.
    expect(cancelledOpId).toBe(opId);
    expect(httpRequestViewStore.runtime[tabId]).toBeUndefined();

    // The send's own IPC call resolves after the tab is already gone.
    httpSend.resolve(response());
    await sendPromise;

    // Neither runtime was resurrected by the post-await path.
    expect(httpRequestViewStore.runtime[tabId]).toBeUndefined();
    expect(useHttpHistoryStore().runtime[tabId]).toBeUndefined();
  });
});
