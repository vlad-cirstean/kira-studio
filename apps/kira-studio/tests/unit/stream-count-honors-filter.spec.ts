// P21 round 2 functional finding 7: load() encodes the partition/offset/timestamp filter a Kafka
// stream tab is browsing under and sends it with every data.read, but runCount used to hard-code
// `filter: null` — the toolbar's own "<N> total" therefore answered the high/low watermark summed
// across *every* partition, a different question than the "<n> rows on this page" printed beside
// it. This pins two things: runCount now sends the exact same encoded filter load() would send for
// the tab's current filter state, and applying a new filter clears the previous (now
// differently-scoped) count rather than leaving a stale total on screen under the new filter.
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { ConnectionState } from '@shared/domain/connection';
import { restoreAfterEach } from './support/restoreAfterEach';

const { data } = await import('../../frontend/src/bridge/data');
restoreAfterEach(data);
const { connectionsState } = await import('../../frontend/src/state/connections');
const { openStreamTab } = await import('../../frontend/src/state/tabs');
const { applyStreamFilter, runCount, runtime } = await import(
  '../../frontend/src/views/stream/state'
);

type Caps = NonNullable<ConnectionState['caps']>;

const kafkaCaps: Caps = {
  tabular: false,
  documents: false,
  keyValue: false,
  stream: true,
  keyBrowser: false,
  defaultPageKind: 'stream',
  sql: false,
  definition: true,
  describe: false,
  schemaColumns: false,
  projection: false,
  serverFilter: true,
  exactCount: true,
  pagination: 'cursor',
  foreignKeys: false,
  canInsert: true,
  canUpdate: false,
  canDelete: false,
  writable: true,
  transactions: false,
  cancel: true,
  fileTransfer: false,
};

function markConnected(connectionId: string, caps: Caps): void {
  connectionsState.states[connectionId] = {
    connectionId,
    status: 'connected',
    serverVersion: 'Kafka',
    error: null,
    since: 0,
    caps,
  };
}

describe('Kafka stream count honors the active filter (finding 7)', () => {
  test('runCount sends null filter when no partition/offset/timestamp filter is set', async () => {
    const connectionId = 'kafka-conn-1';
    markConnected(connectionId, kafkaCaps);
    const { id } = openStreamTab(connectionId, 'topic:orders', { newTab: true });

    let captured: { filter?: string | null } | undefined;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real CountResponse
    (data as any).count = (req: { filter?: string | null }) => {
      captured = req;
      return Promise.resolve({
        value: 6,
        exact: true,
        at: Date.now(),
        stale: false,
        source: 'server',
      });
    };

    await runCount(id);

    expect(captured?.filter).toBeNull();
  });

  test('runCount sends the same encoded filter the tab is browsing under, once one is applied', async () => {
    const connectionId = 'kafka-conn-2';
    markConnected(connectionId, kafkaCaps);
    const { id } = openStreamTab(connectionId, 'topic:orders', { newTab: true });

    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real ReadResponse
    (data as any).read = () =>
      Promise.resolve({
        page: {
          kind: 'stream',
          rowCount: 0,
          position: { hasMore: false, nextToken: null },
          visibilityTimeoutSeconds: null,
        },
      });

    await applyStreamFilter(id, { offset: null, partitions: [0, 1], timestamp: null });

    let captured: { filter?: string | null } | undefined;
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real CountResponse
    (data as any).count = (req: { filter?: string | null }) => {
      captured = req;
      return Promise.resolve({
        value: 2,
        exact: true,
        at: Date.now(),
        stale: false,
        source: 'server',
      });
    };

    await runCount(id);

    expect(captured?.filter).not.toBeNull();
    const parsed = JSON.parse(captured?.filter as string);
    expect(parsed.partitions).toEqual([0, 1]);
  });

  test('applying a new filter clears the previous count instead of leaving a stale total under it', async () => {
    const connectionId = 'kafka-conn-3';
    markConnected(connectionId, kafkaCaps);
    const { id } = openStreamTab(connectionId, 'topic:orders', { newTab: true });

    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real ReadResponse
    (data as any).read = () =>
      Promise.resolve({
        page: {
          kind: 'stream',
          rowCount: 0,
          position: { hasMore: false, nextToken: null },
          visibilityTimeoutSeconds: null,
        },
      });
    // biome-ignore lint/suspicious/noExplicitAny: a minimal fake, not the real CountResponse
    (data as any).count = () =>
      Promise.resolve({ value: 6, exact: true, at: Date.now(), stale: false, source: 'server' });

    await runCount(id);
    expect(runtime[id]?.count?.value).toBe(6);

    await applyStreamFilter(id, { offset: null, partitions: [0], timestamp: null });

    expect(runtime[id]?.count).toBeNull();
  });
});
