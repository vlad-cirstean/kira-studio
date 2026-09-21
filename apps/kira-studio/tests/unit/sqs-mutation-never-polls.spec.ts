// P21 round 2 functional finding 1: README states, as a headline rule, that SQS never polls
// automatically — every ReceiveMessage hides messages from real consumers, so a read must only
// ever happen on an explicit Poll press. Three call paths reached stream/state.ts's reload()
// with no batch guard at all: an immediate mutation's own reload-self (createImmediateMutator,
// used by sendSqsMessage/deleteSqsMessage), that same mutation's fan-out to sibling tabs on the
// same queue (reloadTabsForTarget), and a project-tree double-click on an already-open tab
// (ProjectTree.vue's `reused` branch, which also calls reloadTab('stream', id)). All three funnel
// through stream/state.ts's exported `reload`, so this pins the fix at that one choke point and
// exercises it the same way each call site actually reaches it.
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { ConnectionState } from '@shared/domain/connection';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';
import { restoreAfterEach } from './support/restoreAfterEach';

setActivePinia(pinia);

const { data } = await import('../../frontend/src/bridge/data');
restoreAfterEach(data);
const { useConnectionsStore } = await import('../../frontend/src/state/connections');
const connectionsStore = useConnectionsStore();
const { useTabsStore } = await import('../../frontend/src/state/tabs');
const tabsStore = useTabsStore();
const { useStreamViewStore } = await import('../../frontend/src/views/stream/state');
const streamViewStore = useStreamViewStore();
const { reloadTabsForTarget } = await import('../../frontend/src/state/viewCommands');
const { registerTabRuntimeCleanup } = await import('../../frontend/src/state/tabRuntime');
void registerTabRuntimeCleanup;

type Caps = NonNullable<ConnectionState['caps']>;

const sqsCaps: Caps = {
  tabular: false,
  documents: false,
  keyValue: false,
  stream: true,
  keyBrowser: false,
  keyTypes: false,
  defaultPageKind: 'stream',
  sql: false,
  definition: true,
  describe: false,
  schemaColumns: false,
  projection: false,
  serverFilter: false,
  exactCount: false,
  pagination: 'batch',
  foreignKeys: false,
  canInsert: true,
  canUpdate: false,
  canDelete: true,
  writable: true,
  transactions: false,
  cancel: true,
  fileTransfer: false,
};

function markConnected(connectionId: string, caps: Caps): void {
  connectionsStore.states[connectionId] = {
    connectionId,
    status: 'connected',
    serverVersion: 'Amazon SQS',
    error: null,
    since: 0,
    caps,
  };
}

describe('SQS reload() never triggers a real ReceiveMessage (P21 round 2 functional finding 1)', () => {
  test('reload() on a batch-paginated (SQS) tab does not call data.read', async () => {
    const connectionId = 'sqs-conn-1';
    markConnected(connectionId, sqsCaps);
    const { id } = tabsStore.openStreamTab(connectionId, 'queue:orders', { newTab: true });
    streamViewStore.runtime[id] = {
      status: 'idle',
      error: null,
      actionError: null,
      opId: null,
      count: null,
      countOpId: null,
      rowCount: 3,
      hasMore: false,
      nextToken: null,
      visibilityTimeoutSeconds: 30,
      polled: true,
      searchOpen: false,
      selectedRow: 1,
    };

    let invalidated = false;
    let readCalled = false;
    // biome-ignore lint/suspicious/noExplicitAny: minimal fakes, not the real bridge/data
    (data as any).invalidate = () => {
      invalidated = true;
      return Promise.resolve();
    };
    // biome-ignore lint/suspicious/noExplicitAny: minimal fakes, not the real bridge/data
    (data as any).read = () => {
      readCalled = true;
      throw new Error('reload() must never issue a real read for a batch (SQS) tab');
    };

    await streamViewStore.reload(id);

    expect(invalidated).toBe(true); // the stale page is still dropped
    expect(readCalled).toBe(false); // but nothing re-reads it — no ReceiveMessage
    expect(streamViewStore.runtime[id]?.polled).toBe(false); // falls back to the "click Poll" placeholder
    expect(streamViewStore.runtime[id]?.rowCount).toBe(0);
    expect(streamViewStore.runtime[id]?.selectedRow).toBeNull();
  });

  test('reloadTabsForTarget fanning out to a sibling SQS stream tab does not poll it either', async () => {
    const connectionId = 'sqs-conn-2';
    markConnected(connectionId, sqsCaps);
    const mutatingTab = tabsStore.openStreamTab(connectionId, 'queue:events', { newTab: true });
    const siblingTab = tabsStore.openStreamTab(connectionId, 'queue:events', { newTab: true });
    streamViewStore.runtime[siblingTab.id] = {
      status: 'idle',
      error: null,
      actionError: null,
      opId: null,
      count: null,
      countOpId: null,
      rowCount: 5,
      hasMore: false,
      nextToken: null,
      visibilityTimeoutSeconds: 30,
      polled: true,
      searchOpen: false,
      selectedRow: null,
    };

    let readCalled = false;
    // biome-ignore lint/suspicious/noExplicitAny: minimal fakes, not the real bridge/data
    (data as any).invalidate = () => Promise.resolve();
    // biome-ignore lint/suspicious/noExplicitAny: minimal fakes, not the real bridge/data
    (data as any).read = () => {
      readCalled = true;
      throw new Error('a sibling-tab fan-out reload must never poll a batch (SQS) tab');
    };

    reloadTabsForTarget(connectionId, 'queue:events', mutatingTab.id);
    // reloadTab is fire-and-forget (void fn(tabId)) — flush the microtask queue.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(readCalled).toBe(false);
    expect(streamViewStore.runtime[siblingTab.id]?.polled).toBe(false);
  });

  test('a non-batch (Kafka) stream tab still reloads normally', async () => {
    const connectionId = 'kafka-conn-1';
    markConnected(connectionId, { ...sqsCaps, pagination: 'offsetWindow', canDelete: false });
    const { id } = tabsStore.openStreamTab(connectionId, 'topic:events', { newTab: true });
    streamViewStore.runtime[id] = {
      status: 'idle',
      error: null,
      actionError: null,
      opId: null,
      count: null,
      countOpId: null,
      rowCount: 0,
      hasMore: false,
      nextToken: null,
      visibilityTimeoutSeconds: null,
      polled: false,
      searchOpen: false,
      selectedRow: null,
    };

    let readCalled = false;
    // biome-ignore lint/suspicious/noExplicitAny: minimal fakes, not the real bridge/data
    (data as any).invalidate = () => Promise.resolve();
    // biome-ignore lint/suspicious/noExplicitAny: minimal fakes, not the real bridge/data
    (data as any).read = () => {
      readCalled = true;
      return Promise.resolve({
        page: {
          kind: 'stream',
          rowCount: 0,
          keys: null,
          headers: null,
          attrs: null,
          timestamps: null,
          bodies: null,
          position: { hasMore: false, nextToken: null },
          visibilityTimeoutSeconds: null,
        },
      });
    };

    await streamViewStore.reload(id);

    expect(readCalled).toBe(true);
    expect(streamViewStore.runtime[id]?.polled).toBe(true);
  });
});
