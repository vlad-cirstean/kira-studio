// P21 round 2 functional finding 4: Go's own delete genuinely cascades (repos/collections.go's
// own comment: "the cascade is genuine") — deleting a folder or a collection removes every
// descendant api_items row, not just the row clicked. deleteRow used to purge exactly one cache
// entry (collectionsState.requests[row.id] / grpcRequests[row.id]), leaving every *descendant*
// request's cached HttpSavedRequest/GrpcSavedRequest behind. D14's orphan rule
// (HttpRequestView.vue: canSave depends on savedRequestFor(itemId) !== null) then silently
// misbehaved for any tab open on one of those orphaned descendants: the stale cache entry made the
// tab look saveable when its row no longer existed at all.
//
// This test fails against the pre-fix deleteRow (only the folder's own id is purged, both
// descendant requests' cache entries survive) and passes once the whole subtree is purged.
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { CollectionItemSummary, CollectionSummary } from '@shared/domain/collections';

const { control } = await import('../../frontend/src/bridge/control');
const { collectionsState, deleteRow, fetchSavedRequest, savedRequestFor } = await import(
  '../../frontend/src/api/state/collections'
);

function collection(id: string, name: string): CollectionSummary {
  return { id, name, sortOrder: 0, createdAt: '', updatedAt: '' };
}

function folder(
  id: string,
  collectionId: string,
  parentId: string | null,
  name: string,
): CollectionItemSummary {
  return {
    id,
    collectionId,
    parentId,
    kind: 'folder',
    name,
    sortOrder: 0,
    method: '',
    url: '',
    protocol: 'http',
    createdAt: '',
    updatedAt: '',
  };
}

function request(
  id: string,
  collectionId: string,
  parentId: string | null,
  name: string,
): CollectionItemSummary {
  return {
    id,
    collectionId,
    parentId,
    kind: 'request',
    name,
    sortOrder: 0,
    method: 'GET',
    url: `https://api.example.com/${name}`,
    protocol: 'http',
    createdAt: '',
    updatedAt: '',
  };
}

// Only the fields httpSavedRequestSchema requires without a default matter here;
// fetchSavedRequest's own .parse() fills in the rest from the schema's defaults.
function savedRequest(name: string): Awaited<ReturnType<typeof control.collectionsGetRequest>> {
  return { method: 'GET', url: `https://api.example.com/${name}` } as Awaited<
    ReturnType<typeof control.collectionsGetRequest>
  >;
}

describe('deleteRow purges the whole deleted subtree from the request caches (finding 4)', () => {
  test('deleting a folder also drops its nested requests, not just the folder itself', async () => {
    // col-1
    //   folder-1 ("Auth")
    //     req-1 ("Login")           <- direct child
    //     folder-2 ("Nested")
    //       req-2 ("Refresh token") <- grandchild, via a nested folder
    //   req-3 ("Health check")      <- sibling, must survive
    collectionsState.collections = [collection('col-1', 'Orders API')];
    collectionsState.items = [
      folder('folder-1', 'col-1', null, 'Auth'),
      request('req-1', 'col-1', 'folder-1', 'Login'),
      folder('folder-2', 'col-1', 'folder-1', 'Nested'),
      request('req-2', 'col-1', 'folder-2', 'Refresh token'),
      request('req-3', 'col-1', null, 'Health check'),
    ];

    (
      control as unknown as { collectionsGetRequest: typeof control.collectionsGetRequest }
    ).collectionsGetRequest = async (id: string) => savedRequest(id);
    await fetchSavedRequest('req-1');
    await fetchSavedRequest('req-2');
    await fetchSavedRequest('req-3');
    expect(savedRequestFor('req-1')).not.toBeNull();
    expect(savedRequestFor('req-2')).not.toBeNull();
    expect(savedRequestFor('req-3')).not.toBeNull();

    const captured: { deletedId: string | null } = { deletedId: null };
    (
      control as unknown as { collectionsDelete: typeof control.collectionsDelete }
    ).collectionsDelete = async (id: string) => {
      captured.deletedId = id;
    };
    (control as unknown as { collectionsList: typeof control.collectionsList }).collectionsList =
      async () => ({
        collections: collectionsState.collections,
        // Mirrors the real cascade: folder-1, req-1, folder-2 and req-2 are all gone post-delete.
        items: collectionsState.items.filter((item) => item.id === 'req-3'),
      });

    await deleteRow({
      key: 'i:folder-1',
      depth: 1,
      hasChildren: true,
      expanded: true,
      kind: 'folder',
      id: 'folder-1',
      collectionId: 'col-1',
      parentId: null,
      name: 'Auth',
      method: '',
      url: '',
      protocol: 'http',
      matched: false,
    });

    expect(captured.deletedId).toBe('folder-1');
    // The direct child, the nested folder's own child, and the folder itself must all be purged —
    // this is the assertion that fails against the pre-fix code (only 'folder-1' was purged, which
    // has no cache entry of its own since it is a folder, so pre-fix this test would still find
    // req-1/req-2 cached).
    expect(savedRequestFor('req-1')).toBeNull();
    expect(savedRequestFor('req-2')).toBeNull();
    // The sibling outside the deleted subtree must survive.
    expect(savedRequestFor('req-3')).not.toBeNull();
  });

  test('deleting a whole collection purges every item in it, regardless of nesting depth', async () => {
    collectionsState.collections = [collection('col-2', 'Widgets API')];
    collectionsState.items = [
      folder('folder-3', 'col-2', null, 'Top'),
      request('req-4', 'col-2', 'folder-3', 'List widgets'),
    ];
    (
      control as unknown as { collectionsGetRequest: typeof control.collectionsGetRequest }
    ).collectionsGetRequest = async (id: string) => savedRequest(id);
    await fetchSavedRequest('req-4');
    expect(savedRequestFor('req-4')).not.toBeNull();

    (
      control as unknown as { collectionsDelete: typeof control.collectionsDelete }
    ).collectionsDelete = async () => {};
    (control as unknown as { collectionsList: typeof control.collectionsList }).collectionsList =
      async () => ({
        collections: [],
        items: [],
      });

    await deleteRow({
      key: 'c:col-2',
      depth: 0,
      hasChildren: true,
      expanded: true,
      kind: 'collection',
      id: 'col-2',
      collectionId: 'col-2',
      parentId: null,
      name: 'Widgets API',
      method: '',
      url: '',
      protocol: 'http',
      matched: false,
    });

    expect(savedRequestFor('req-4')).toBeNull();
  });
});
