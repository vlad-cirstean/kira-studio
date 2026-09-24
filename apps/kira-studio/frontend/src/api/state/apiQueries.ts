// P112: the one module owning every API-client server-state cache — keys, query options, the
// imperative loaders non-component code uses, the one invalidation helper (refreshApiQuery,
// F2's successor) and the boot-time listener that turns a Go `kira:api:dataChanged` broadcast
// into cache invalidation (initApiDataSync). Precedents: state/schemas.ts (options object,
// staleTime: Infinity because Go pushes, broadcast → invalidateQueries) and state/maskRules.ts.
//
// Query keys follow P99 §5.5's flat `[domain, ...ids]` convention (workbench/state/queryClient.ts).
//
// ---- reactivity rule (§3.5) — two reader kinds ----
// notifyManager batches observer notifications with setTimeout(0), and vue-query never swaps the
// scheduler — a useQuery result's `.data` lags the cache by one macrotask after a fetch resolves.
//   - Reactive readers (computeds, templates, watches) read a useQuery result's `data`.
//   - Imperative code after an `await` (a mutation continuing on, send(), the reconcilers below)
//     reads `queryClient.getQueryData(key)` or awaits a `load*()` reader — never the observer ref.

import type {
  CollectionItemSummary,
  CollectionSummary,
  GrpcSavedRequest,
  HttpSavedRequest,
} from '@shared/domain/collections';
import { grpcSavedRequestSchema, httpSavedRequestSchema } from '@shared/domain/collections';
import type { ApiEnvironment, ApiVariable, VariableScope } from '@shared/domain/variables';
import type { ApiDataChange } from '@shared/protocol/events';
import type { QueryKey } from '@tanstack/vue-query';
import { useQuery } from '@tanstack/vue-query';
import { queryClient } from '@workbench/state/queryClient';
import type { MaybeRefOrGetter } from 'vue';
import { toValue } from 'vue';
import { control } from '../../bridge/control';

// ---- keys ----

export const apiCollectionsTreeKey = ['apiCollectionsTree'] as const;
export function apiSavedRequestKey(itemId: string) {
  return ['apiSavedRequest', itemId] as const;
}
export function apiSavedGrpcRequestKey(itemId: string) {
  return ['apiSavedGrpcRequest', itemId] as const;
}
export const apiEnvironmentsKey = ['apiEnvironments'] as const;
export function apiVariablesKey(scope: VariableScope, ownerId: string) {
  return ['apiVariables', scope, ownerId] as const;
}

// ---- query options ----

export interface ApiCollectionsTree {
  collections: CollectionSummary[];
  items: CollectionItemSummary[];
}

export function apiCollectionsTreeQueryOptions() {
  return {
    queryKey: apiCollectionsTreeKey,
    queryFn: async (): Promise<ApiCollectionsTree> => {
      const { collections, items } = await control.collectionsList();
      return { collections, items: items as CollectionItemSummary[] };
    },
    staleTime: Number.POSITIVE_INFINITY,
  };
}

// `null` means "confirmed orphan" (GetRequest threw — the row was deleted, in this window or
// another); `undefined` (no data) means "not loaded yet". Keeps P108 F4's orphan/not-loaded split
// exactly, without two parallel maps.
function apiSavedRequestQueryOptions(itemId: string) {
  return {
    queryKey: apiSavedRequestKey(itemId),
    queryFn: async (): Promise<HttpSavedRequest | null> => {
      try {
        return httpSavedRequestSchema.parse(await control.collectionsGetRequest(itemId));
      } catch {
        return null;
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
  };
}

/** apiSavedRequestQueryOptions' own gRPC sibling. */
function apiSavedGrpcRequestQueryOptions(itemId: string) {
  return {
    queryKey: apiSavedGrpcRequestKey(itemId),
    queryFn: async (): Promise<GrpcSavedRequest | null> => {
      try {
        return grpcSavedRequestSchema.parse(await control.collectionsGetGrpcRequest(itemId));
      } catch {
        return null;
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
  };
}

export function apiEnvironmentsQueryOptions() {
  return {
    queryKey: apiEnvironmentsKey,
    queryFn: (): Promise<ApiEnvironment[]> => control.variablesListEnvironments(),
    staleTime: Number.POSITIVE_INFINITY,
  };
}

function apiVariablesQueryOptions(scope: VariableScope, ownerId: string) {
  return {
    queryKey: apiVariablesKey(scope, ownerId),
    queryFn: (): Promise<ApiVariable[]> => control.variablesList(scope, ownerId),
    staleTime: Number.POSITIVE_INFINITY,
  };
}

// ---- imperative loaders (non-component code) ----
//
// Cache-first, refetch when invalidated — exactly queryClient.query's own contract with
// staleTime: Infinity. fetchQuery/ensureQueryData are deprecated in this app's TanStack Query
// version; query() is their replacement (query-core@5.103.2's own queryClient.js).

export function loadCollectionsTree(): Promise<ApiCollectionsTree> {
  return queryClient.query(apiCollectionsTreeQueryOptions());
}

export function loadEnvironments(): Promise<ApiEnvironment[]> {
  return queryClient.query(apiEnvironmentsQueryOptions());
}

/** Returns `[]` for `ownerId === ''` with no fetch — preserves ensureVariablesLoaded's own '' no-op
 *  (a scratch tab's collection, or no active environment). */
export function loadVariableRows(scope: VariableScope, ownerId: string): Promise<ApiVariable[]> {
  if (ownerId === '') return Promise.resolve([]);
  return queryClient.query(apiVariablesQueryOptions(scope, ownerId));
}

export function loadSavedRequest(itemId: string): Promise<HttpSavedRequest | null> {
  return queryClient.query(apiSavedRequestQueryOptions(itemId));
}

export function loadSavedGrpcRequest(itemId: string): Promise<GrpcSavedRequest | null> {
  return queryClient.query(apiSavedGrpcRequestQueryOptions(itemId));
}

// ---- refreshApiQuery — the one invalidation helper (F2's successor) ----
//
// Every invalidation goes through this: the event handler below and every mutation's onSuccess
// where a re-list is needed.
//
// The second invalidate is the F2 race, restated for TanStack: a fetch that was already running
// when a change landed is never trusted as the post-change answer (query.fetch joins an in-flight
// fetch with no data yet rather than cancelling it, and invalidateQueries only refetches an
// `active` query by default — an observer-less in-flight `queryClient.query` caller, e.g. send(),
// would otherwise have its own invalidation cleared by that in-flight fetch landing afterward).
// Worst case here is one extra local SQLite read.
export async function refreshApiQuery(queryKey: QueryKey): Promise<void> {
  const inFlight = queryClient.getQueryCache().find({ queryKey, exact: true })?.promise;
  await queryClient.invalidateQueries({ queryKey, exact: true });
  if (inFlight) {
    await inFlight.catch(() => {});
    await queryClient.invalidateQueries({ queryKey, exact: true });
  }
}

// ---- reconcilers — F9's successor: cross-window-aware cache eviction ----

/** After the tree refreshes: drop any cached saved-request query whose item no longer exists (the
 *  tab reads as orphan — D14's rule, now cross-window and cascade-aware for free), and evict any
 *  cached collection-scope variables query whose collection no longer exists. */
export function reconcileTree(): void {
  const tree = queryClient.getQueryData<ApiCollectionsTree>(apiCollectionsTreeKey);
  if (!tree) return;
  const itemIds = new Set(tree.items.map((item) => item.id));
  const collectionIds = new Set(tree.collections.map((c) => c.id));

  for (const query of queryClient.getQueryCache().findAll({ queryKey: ['apiSavedRequest'] })) {
    const itemId = query.queryKey[1] as string;
    if (!itemIds.has(itemId)) queryClient.setQueryData(query.queryKey, null);
  }
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ['apiSavedGrpcRequest'] })) {
    const itemId = query.queryKey[1] as string;
    if (!itemIds.has(itemId)) queryClient.setQueryData(query.queryKey, null);
  }
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: ['apiVariables', 'collection'] })) {
    const collectionId = query.queryKey[2] as string;
    if (!collectionIds.has(collectionId)) {
      queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  }
}

/** After the environments list refreshes: evict any cached environment-scope variables query
 *  whose environment no longer exists. */
export function reconcileEnvironments(): void {
  const list = queryClient.getQueryData<ApiEnvironment[]>(apiEnvironmentsKey);
  if (!list) return;
  const ids = new Set(list.map((e) => e.id));
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: ['apiVariables', 'environment'] })) {
    const environmentId = query.queryKey[2] as string;
    if (!ids.has(environmentId)) {
      queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  }
}

// ---- the listener ----

async function handleApiDataChange(change: ApiDataChange): Promise<void> {
  switch (change.kind) {
    case 'tree':
      await refreshApiQuery(apiCollectionsTreeKey);
      reconcileTree();
      return;
    case 'savedRequest':
      // Only one of the two exists for a given itemId; the other refresh is a no-op.
      await Promise.all([
        refreshApiQuery(apiSavedRequestKey(change.itemId)),
        refreshApiQuery(apiSavedGrpcRequestKey(change.itemId)),
      ]);
      return;
    case 'variables':
      await refreshApiQuery(apiVariablesKey(change.scope, change.ownerId));
      return;
    case 'environments':
      await refreshApiQuery(apiEnvironmentsKey);
      reconcileEnvironments();
      return;
  }
}

let unsubscribeApiDataChanged: (() => void) | null = null;

/** Called once in main.ts's bootstrap(), synchronously, before its Promise.all — it needs no data,
 *  and it must be live before any query exists, whether or not the Api panel ever mounts. Same
 *  unsubscribe?.() then resubscribe shape as state/schemas.ts's initSchemaSync. */
export function initApiDataSync(): void {
  unsubscribeApiDataChanged?.();
  unsubscribeApiDataChanged = control.onApiDataChanged((event) => {
    // A broadcast has no user action to attach an error strip to — state/collections.ts's own
    // console.warn precedent for an unattributable async failure.
    void Promise.all(event.changes.map(handleApiDataChange)).catch((err) => {
      console.warn('applying an api-data-changed event failed', err);
    });
  });
}

// ---- composables (components only — dynamic keys, so not observed from a store) ----

export function useVariableRows(scope: VariableScope, ownerId: MaybeRefOrGetter<string>) {
  return useQuery(
    () => ({
      ...apiVariablesQueryOptions(scope, toValue(ownerId)),
      enabled: toValue(ownerId) !== '',
    }),
    queryClient,
  );
}

export function useSavedRequest(itemId: MaybeRefOrGetter<string | null>) {
  return useQuery(
    () => ({
      ...apiSavedRequestQueryOptions(toValue(itemId) ?? ''),
      enabled: !!toValue(itemId),
    }),
    queryClient,
  );
}

/** useSavedRequest's own gRPC sibling. */
export function useSavedGrpcRequest(itemId: MaybeRefOrGetter<string | null>) {
  return useQuery(
    () => ({
      ...apiSavedGrpcRequestQueryOptions(toValue(itemId) ?? ''),
      enabled: !!toValue(itemId),
    }),
    queryClient,
  );
}
