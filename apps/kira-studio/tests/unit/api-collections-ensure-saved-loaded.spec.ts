// P108 F4: a restored tab (itemId set from persisted state, never opened through
// CollectionsTree.vue's own onOpen) never had its saved side fetched at all — savedRequestFor read
// null forever, indistinguishable from D14's genuine orphan case (a row deleted in this window or
// another). onSave's `saved() === null` check took the two as the same thing and routed Save into
// Save as…, silently creating a duplicate row and rebinding the tab to it. This pins
// ensureSavedRequestLoaded/ensureSavedGrpcRequestLoaded: fetch exactly once per itemId, cache a
// successful reply, and record a failed reply (the row genuinely gone) as a confirmed orphan
// distinct from "not yet fetched" — isOrphanRequest/isOrphanGrpcRequest read that distinction back.
import '@workbench/testing/unit/window';

import { describe, expect, test } from 'bun:test';
import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { control } = await import('../../frontend/src/bridge/control');
restoreAfterEach(control);
const { useCollectionsStore } = await import('../../frontend/src/api/state/collections');

const collectionsStore = useCollectionsStore();

// Only the fields httpSavedRequestSchema/grpcSavedRequestSchema require without a default matter
// here; fetchSavedRequest/fetchSavedGrpcRequest's own .parse() fills in the rest from defaults.
function savedRequest(url: string): Awaited<ReturnType<typeof control.collectionsGetRequest>> {
  return { method: 'GET', url } as Awaited<ReturnType<typeof control.collectionsGetRequest>>;
}

function savedGrpcRequest(
  target: string,
): Awaited<ReturnType<typeof control.collectionsGetGrpcRequest>> {
  return { target } as Awaited<ReturnType<typeof control.collectionsGetGrpcRequest>>;
}

describe('ensureSavedRequestLoaded fetches once and distinguishes orphan from unfetched (P108 F4)', () => {
  test('a restored tab whose row still resolves is fetched exactly once and cached', async () => {
    let calls = 0;
    (
      control as unknown as { collectionsGetRequest: typeof control.collectionsGetRequest }
    ).collectionsGetRequest = async (id: string) => {
      calls++;
      return savedRequest(`https://api.example.com/${id}`);
    };

    expect(collectionsStore.savedRequestFor('restored-1')).toBeNull();
    expect(collectionsStore.isOrphanRequest('restored-1')).toBe(false);

    await collectionsStore.ensureSavedRequestLoaded('restored-1');
    expect(calls).toBe(1);
    expect(collectionsStore.savedRequestFor('restored-1')).not.toBeNull();
    expect(collectionsStore.isOrphanRequest('restored-1')).toBe(false);

    // A second call (e.g. a watch firing again, or another view mounting the same tab) must not
    // re-fetch — the cache hit above already short-circuits it.
    await collectionsStore.ensureSavedRequestLoaded('restored-1');
    expect(calls).toBe(1);
  });

  test('a restored tab whose row no longer resolves is recorded as an orphan, not retried forever', async () => {
    let calls = 0;
    (
      control as unknown as { collectionsGetRequest: typeof control.collectionsGetRequest }
    ).collectionsGetRequest = async () => {
      calls++;
      throw new Error('not found');
    };

    expect(collectionsStore.isOrphanRequest('gone-1')).toBe(false);

    await collectionsStore.ensureSavedRequestLoaded('gone-1');
    expect(calls).toBe(1);
    expect(collectionsStore.savedRequestFor('gone-1')).toBeNull();
    expect(collectionsStore.isOrphanRequest('gone-1')).toBe(true);

    // Once confirmed orphaned, a later call (another view's watch, a re-mount) must not re-issue
    // the doomed GetRequest — that is exactly the "not yet fetched" vs. "confirmed gone" split F4
    // depends on to keep onSave's routing correct.
    await collectionsStore.ensureSavedRequestLoaded('gone-1');
    expect(calls).toBe(1);
  });
});

describe("ensureSavedGrpcRequestLoaded — ensureSavedRequestLoaded's own gRPC sibling (P108 F4)", () => {
  test('a restored gRPC tab whose row still resolves is fetched exactly once and cached', async () => {
    let calls = 0;
    (
      control as unknown as { collectionsGetGrpcRequest: typeof control.collectionsGetGrpcRequest }
    ).collectionsGetGrpcRequest = async (id: string) => {
      calls++;
      return savedGrpcRequest(`grpc.example.com/${id}`);
    };

    await collectionsStore.ensureSavedGrpcRequestLoaded('restored-grpc-1');
    expect(calls).toBe(1);
    expect(collectionsStore.savedGrpcRequestFor('restored-grpc-1')).not.toBeNull();
    expect(collectionsStore.isOrphanGrpcRequest('restored-grpc-1')).toBe(false);

    await collectionsStore.ensureSavedGrpcRequestLoaded('restored-grpc-1');
    expect(calls).toBe(1);
  });

  test('a restored gRPC tab whose row no longer resolves is recorded as an orphan, not retried forever', async () => {
    let calls = 0;
    (
      control as unknown as { collectionsGetGrpcRequest: typeof control.collectionsGetGrpcRequest }
    ).collectionsGetGrpcRequest = async () => {
      calls++;
      throw new Error('not found');
    };

    await collectionsStore.ensureSavedGrpcRequestLoaded('gone-grpc-1');
    expect(calls).toBe(1);
    expect(collectionsStore.savedGrpcRequestFor('gone-grpc-1')).toBeNull();
    expect(collectionsStore.isOrphanGrpcRequest('gone-grpc-1')).toBe(true);

    await collectionsStore.ensureSavedGrpcRequestLoaded('gone-grpc-1');
    expect(calls).toBe(1);
  });
});
