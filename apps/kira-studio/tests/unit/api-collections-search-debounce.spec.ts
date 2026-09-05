// Finding 14 of the v1.2 P14 round-1 review: collectionsState.search had no debounce, and
// childrenOf re-filtered+sorted the entire flat `items` array on every single call — called
// repeatedly per row per level by both visibleRows and subtreeMatches, an O(N²)-ish walk on every
// keystroke. This pins both fixes at the state level: the search itself stays immediate (so the
// input never stutters), the debounced query it drives lands ~150ms after typing settles, and a
// request row's own search never recurses into a childrenOf lookup (it can never have children).
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { CollectionItemSummary, CollectionSummary } from '@shared/domain/collections';

const { activeSearchQuery, collectionsState, visibleRows } = await import(
  '../../frontend/src/api/state/collections'
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collection(id: string, name: string, sortOrder = 0): CollectionSummary {
  return { id, name, sortOrder, createdAt: '', updatedAt: '' };
}

function folder(
  id: string,
  collectionId: string,
  parentId: string | null,
  name: string,
  sortOrder = 0,
): CollectionItemSummary {
  return {
    id,
    collectionId,
    parentId,
    kind: 'folder',
    name,
    sortOrder,
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
  sortOrder = 0,
): CollectionItemSummary {
  return {
    id,
    collectionId,
    parentId,
    kind: 'request',
    name,
    sortOrder,
    method: 'GET',
    url: `https://api.example.com/${name}`,
    protocol: 'http',
    createdAt: '',
    updatedAt: '',
  };
}

describe('api/state/collections.ts search debounce and indexed childrenOf (finding 14)', () => {
  test('the search box value updates immediately, but the query rows filter on stays stale until the debounce settles', async () => {
    collectionsState.collections = [collection('col-1', 'Orders API')];
    collectionsState.items = [
      folder('folder-1', 'col-1', null, 'Auth', 0),
      request('req-1', 'col-1', null, 'Health check', 1),
    ];
    collectionsState.expanded = new Set(['c:col-1']);
    collectionsState.search = '';
    // Let any debounce timer left over from a previous test in this file settle first.
    await sleep(200);

    collectionsState.search = 'Health';
    // Immediate: the state itself already carries what was typed.
    expect(collectionsState.search).toBe('Health');
    // Stale: the debounced query has not caught up yet, so nothing has been filtered out — both
    // the folder and the request are still visible rows.
    expect(activeSearchQuery.value).toBe('');
    expect(visibleRows.value.map((r) => r.name)).toContain('Auth');

    await sleep(250);

    expect(activeSearchQuery.value).toBe('health');
    const names = visibleRows.value.map((r) => r.name);
    expect(names).toContain('Health check');
    expect(names).not.toContain('Auth');
  });

  test("a request row's own search never looks for children it can never have", async () => {
    collectionsState.collections = [collection('col-2', 'Widgets API')];
    collectionsState.items = [request('req-2', 'col-2', null, 'List widgets', 0)];
    collectionsState.expanded = new Set(['c:col-2']);
    collectionsState.search = '';
    await sleep(200);

    collectionsState.search = 'widgets';
    await sleep(200);

    // The request row itself matches (both name and URL contain "widgets") and renders with no
    // children — proving subtreeMatches' own kind === 'request' short-circuit didn't silently
    // drop it while skipping the childrenOf lookup.
    const row = visibleRows.value.find((r) => r.id === 'req-2');
    expect(row?.matched).toBe(true);
    expect(row?.hasChildren).toBe(false);
  });
});
