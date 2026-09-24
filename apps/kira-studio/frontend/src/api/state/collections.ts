import {
  type CollectionItemKind,
  type CollectionItemProtocol,
  type CollectionItemSummary,
  type CollectionSummary,
  type GrpcSavedRequest,
  grpcSavedRequestSchema,
  type HttpSavedRequest,
  httpSavedRequestSchema,
  type ImportReport,
} from '@shared/domain/collections';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { refDebounced } from '@vueuse/core';
import { queryClient } from '@workbench/state/queryClient';
import { defineStore } from 'pinia';
import { computed, reactive, toRef, toRefs } from 'vue';
import { control } from '../../bridge/control';
import {
  closeVariableSetTabsForOwner,
  patchGrpcRequestTabState,
  patchHttpRequestTabState,
  renameApiRequestTabs,
  renameGrpcRequestTabs,
  renameVariableSetTabs,
} from '../tabs';
import {
  type ApiCollectionsTree,
  apiCollectionsTreeKey,
  apiCollectionsTreeQueryOptions,
  reconcileTree,
  refreshApiQuery,
} from './apiQueries';
import { useSaveRequestDialogStore } from './saveRequestDialog';

// P4 D13: Api's own tree store. Studio's tree is lazy because its data is remote — expanding a
// node connects a connection and issues an IPC call, which is what its children cache, loading
// set, 150 ms search debounce and "searching cached nodes only" note all exist for (F15). A
// collections tree has none of that: the whole tree is rows in a local SQLite table, listable in
// one call, so `visibleRows` below is a **pure computed** over one array. That is a genuine
// simplification rather than a shape to copy.

/** The row TreeHost renders. Four structural members (key/depth/hasChildren/expanded — TreeHost's
 *  own StickyRowLike contract) plus seven of its own, against TreeRowVm's fourteen: connectionId,
 *  color, status, statusDetail, groupKind, badges, loading and error have no meaning here. The
 *  mechanics generalize; the rows do not, which is exactly why P1 factored TreeHost out and left
 *  TreeRow where it was. */
export interface CollectionRowVm {
  key: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  kind: 'collection' | 'folder' | 'request';
  id: string;
  collectionId: string;
  parentId: string | null;
  name: string;
  /** Requests only — the row's leading chip. */
  method: string;
  /** Requests only — searched, never shown. */
  url: string;
  /** P11 D12: 'http' for every existing row (the column's own SQL default); meaningless for a
   *  folder or a collection row. */
  protocol: CollectionItemProtocol;
  matched: boolean;
}

/** TreeHost requires a unique string key per row, and the two id spaces are separate tables. */
function collectionKey(id: string): string {
  return `c:${id}`;
}
function itemKey(id: string): string {
  return `i:${id}`;
}

function rowMatches(name: string, url: string, query: string): boolean {
  if (!query) return false;
  return name.toLowerCase().includes(query) || url.toLowerCase().includes(query);
}

interface CollectionsState {
  expanded: Set<string>;
  selected: string | null;
  search: string;
  /** The row key whose label is currently an inline rename input, if any. */
  renamingKey: string | null;
  /** Saved requests read on demand by GetRequest, keyed by item id — the dirty comparison's
   *  other half (D15) and the reason opening an already-open request costs no call. */
  requests: Record<string, HttpSavedRequest>;
  /** P11 D12: GetGrpcRequest's own cache — grpcRequests' own sibling of `requests` above. */
  grpcRequests: Record<string, GrpcSavedRequest>;
  /** P108 F4: itemIds `ensureSavedRequestLoaded` has confirmed no longer resolve (GetRequest threw
   *  — the row was deleted, in this window or another) — distinct from an itemId simply not yet
   *  fetched, which `requests` alone cannot tell apart from a genuine orphan. */
  orphanRequests: Record<string, true>;
  /** `orphanRequests`' own gRPC sibling. */
  orphanGrpcRequests: Record<string, true>;
  busy: boolean;
  report: ImportReport | null;
  /** D16: "N secret values were not written to the file" — set after an export that stripped at
   *  least one, shown alongside the import report strip. */
  exportWarning: string | null;
  /** P108 F10: a tree mutation's (create/rename/delete/duplicate/save/import/export) own failure
   *  message — every one of them used to let this throw uncaught from a fire-and-forget `void`
   *  call in CollectionsPanel.vue/CollectionsTree.vue, so a failed write left the row exactly as it
   *  was with nothing telling the user why. Cleared on the next attempt that succeeds. */
  error: string | null;
}

// ---- saving a request into a collection (D15) ----
//
// The dialog's own open/tabId/suggestedName/payload UI state lives in useSaveRequestDialogStore
// (P108 F16 — one-store-one-concern). submitSaveDialog stays here: it reaches deep into the
// tree's own load/reveal/cache machinery below, so a full split would only trade one store for
// two stores calling each other for everything that matters.

export const useCollectionsStore = defineStore('collections', () => {
  const state = reactive<CollectionsState>({
    expanded: new Set<string>(),
    selected: null,
    search: '',
    renamingKey: null,
    requests: {},
    grpcRequests: {},
    orphanRequests: {},
    orphanGrpcRequests: {},
    busy: false,
    report: null,
    exportWarning: null,
    error: null,
  });

  function dismissError(): void {
    state.error = null;
  }

  // P112: the tree is now TanStack Query's cache, not a store field — this observer is
  // app-lifetime (created once, with the setup store's own effect scope owning it), so
  // invalidateQueries always has an active observer to refetch. queryClient is passed explicitly
  // (not injected): main.ts creates stores before app.use(VueQueryPlugin), and unit tests mount no
  // app at all — useBaseQuery.js falls back to inject() only when no explicit client is given.
  const treeQuery = useQuery(apiCollectionsTreeQueryOptions(), queryClient);

  const collections = computed<CollectionSummary[]>(() => treeQuery.data.value?.collections ?? []);
  const items = computed<CollectionItemSummary[]>(() => treeQuery.data.value?.items ?? []);
  const loaded = computed(() => treeQuery.data.value !== undefined);
  /** P108 F10's successor for the read side: a failed initial/refetch List used to reject into a
   *  void'd promise with nothing shown — this surfaces it the same way state.error does for a
   *  mutation's own failure (rendered in ImportReportStrip.vue). */
  const treeLoadError = computed(() => treeQuery.error.value?.message ?? null);

  /** Every tree mutation below refreshes this one key then reconciles — reconcileTree (F9's
   *  successor) drops any cached saved-request query whose item no longer exists and evicts any
   *  cached collection-scope variables query whose collection no longer exists, local mutation or
   *  remote push alike. */
  async function afterTreeListChange(): Promise<void> {
    await refreshApiQuery(apiCollectionsTreeKey);
    reconcileTree();
  }

  /** Reads a saved request, caching it by item id. The cache is the dirty comparison's other half
   *  (D15) as well as an open-cost saving: re-opening an already-open request costs no call. */
  async function fetchSavedRequest(itemId: string): Promise<HttpSavedRequest> {
    const cached = state.requests[itemId];
    if (cached) return cached;
    const saved = httpSavedRequestSchema.parse(await control.collectionsGetRequest(itemId));
    state.requests[itemId] = saved;
    return saved;
  }

  /** The saved side of the dirty comparison, or null when this tab's row has never been read (or no
   *  longer resolves — D14's orphan rule). */
  function savedRequestFor(itemId: string | null): HttpSavedRequest | null {
    if (!itemId) return null;
    return state.requests[itemId] ?? null;
  }

  /** fetchSavedRequest's own gRPC sibling. */
  async function fetchSavedGrpcRequest(itemId: string): Promise<GrpcSavedRequest> {
    const cached = state.grpcRequests[itemId];
    if (cached) return cached;
    const saved = grpcSavedRequestSchema.parse(await control.collectionsGetGrpcRequest(itemId));
    state.grpcRequests[itemId] = saved;
    return saved;
  }

  /** savedRequestFor's own gRPC sibling. */
  function savedGrpcRequestFor(itemId: string | null): GrpcSavedRequest | null {
    if (!itemId) return null;
    return state.grpcRequests[itemId] ?? null;
  }

  // P108 F4: a restored request/gRPC tab (itemId set from persisted state, never opened through
  // CollectionsTree.vue's own onOpen — the only call site that used to run fetchSavedRequest at
  // all) read `savedRequestFor` as null forever: not because the row was deleted, but because
  // nothing had ever fetched it. isDirty(state, null) reads that as "nothing to diff, not dirty",
  // and onSave's own `saved() === null` check reads it as "no saved row — Save as…", silently
  // creating a duplicate row and rebinding the tab to it on first Save. `orphanRequests`/
  // `orphanGrpcRequests` (above) distinguish a confirmed-gone row from one merely not fetched yet;
  // `isOrphanRequest`/`isOrphanGrpcRequest` below let the view disable Save (not reroute it) while
  // that's still unknown.

  function isOrphanRequest(itemId: string): boolean {
    return !!state.orphanRequests[itemId];
  }

  function isOrphanGrpcRequest(itemId: string): boolean {
    return !!state.orphanGrpcRequests[itemId];
  }

  /** Fetches a restored tab's saved side exactly once — a no-op once something has already
   *  resolved this itemId, whether a cache hit or a confirmed orphan. Safe to call on every mount
   *  and on every itemId change; idempotent regardless of how many views call it for the same id. */
  async function ensureSavedRequestLoaded(itemId: string): Promise<void> {
    if (state.requests[itemId] || state.orphanRequests[itemId]) return;
    try {
      await fetchSavedRequest(itemId);
    } catch {
      state.orphanRequests[itemId] = true;
    }
  }

  /** ensureSavedRequestLoaded's own gRPC sibling. */
  async function ensureSavedGrpcRequestLoaded(itemId: string): Promise<void> {
    if (state.grpcRequests[itemId] || state.orphanGrpcRequests[itemId]) return;
    try {
      await fetchSavedGrpcRequest(itemId);
    } catch {
      state.orphanGrpcRequests[itemId] = true;
    }
  }

  // ---- the row model ----

  /** Finding 14: childrenOf used to filter+sort the whole flat `items` array on every single call,
   *  and both visibleRows and subtreeMatches call it once per row per level — an O(N²)-ish walk on
   *  every keystroke for a collection of any real size. Built once per `items` change (a computed,
   *  not per childrenOf call), keyed by collectionId+parentId, each bucket pre-sorted once. */
  const childrenIndex = computed<Map<string, CollectionItemSummary[]>>(() => {
    const index = new Map<string, CollectionItemSummary[]>();
    for (const item of items.value) {
      const key = `${item.collectionId}\x00${item.parentId ?? ''}`;
      const bucket = index.get(key);
      if (bucket) bucket.push(item);
      else index.set(key, [item]);
    }
    for (const bucket of index.values()) bucket.sort((a, b) => a.sortOrder - b.sortOrder);
    return index;
  });

  function childrenOf(collectionId: string, parentId: string | null): CollectionItemSummary[] {
    return childrenIndex.value.get(`${collectionId}\x00${parentId ?? ''}`) ?? [];
  }

  // Finding 14: the same 150ms debounce this app already uses for a fast typist
  // (project/state/tree.ts's own SEARCH_DEBOUNCE_MS) — state.search itself stays immediate (so the
  // input never stutters), and activeSearchQuery/visibleRows read the debounced value instead, so a
  // fast typist causes one recompute per pause rather than one per character.
  const SEARCH_DEBOUNCE_MS = 150;
  // P99 §9.3: refDebounced replaces the watch+setTimeout pair this used to hand-roll.
  const debouncedSearch = refDebounced(toRef(state, 'search'), SEARCH_DEBOUNCE_MS);

  /** Lower-cased once per render rather than per row. '' means "no search active". */
  const activeSearchQuery = computed(() => debouncedSearch.value.trim().toLowerCase());

  /** True when this subtree contains a match, so an ancestor of a hit still renders. Finding 14: a
   *  request row can never have children (only a folder or collection can), so it skips the
   *  childrenOf lookup entirely rather than querying an index bucket that can only ever be empty. */
  function subtreeMatches(item: CollectionItemSummary, query: string): boolean {
    if (rowMatches(item.name, item.url, query)) return true;
    if (item.kind === 'request') return false;
    return childrenOf(item.collectionId, item.id).some((child) => subtreeMatches(child, query));
  }

  const visibleRows = computed<CollectionRowVm[]>(() => {
    const query = activeSearchQuery.value;
    const rows: CollectionRowVm[] = [];

    const pushItems = (collectionId: string, parentId: string | null, depth: number): void => {
      for (const item of childrenOf(collectionId, parentId)) {
        if (query && !subtreeMatches(item, query)) continue;
        const children = childrenOf(collectionId, item.id);
        // While a query is active every ancestor of a match renders expanded **without mutating
        // `expanded`**, so clearing the search restores exactly the shape the user had.
        const expanded = query ? true : state.expanded.has(itemKey(item.id));
        rows.push({
          key: itemKey(item.id),
          depth,
          hasChildren: item.kind === 'folder' && children.length > 0,
          expanded,
          kind: item.kind,
          id: item.id,
          collectionId,
          parentId,
          name: item.name,
          method: item.method,
          url: item.url,
          protocol: item.protocol,
          matched: rowMatches(item.name, item.url, query),
        });
        if (item.kind === 'folder' && expanded) pushItems(collectionId, item.id, depth + 1);
      }
    };

    for (const collection of collections.value) {
      const children = childrenOf(collection.id, null);
      const hasMatch = !query || children.some((child) => subtreeMatches(child, query));
      if (query && !hasMatch && !rowMatches(collection.name, '', query)) continue;
      const expanded = query ? true : state.expanded.has(collectionKey(collection.id));
      rows.push({
        key: collectionKey(collection.id),
        depth: 0,
        hasChildren: children.length > 0,
        expanded,
        kind: 'collection',
        id: collection.id,
        collectionId: collection.id,
        parentId: null,
        name: collection.name,
        method: '',
        url: '',
        protocol: 'http',
        matched: rowMatches(collection.name, '', query),
      });
      if (expanded) pushItems(collection.id, null, 1);
    }
    return rows;
  });

  // ---- selection and expansion ----

  function selectRow(key: string): void {
    state.selected = key;
  }

  function toggleRow(row: CollectionRowVm): void {
    if (!row.hasChildren) return;
    if (state.expanded.has(row.key)) state.expanded.delete(row.key);
    else state.expanded.add(row.key);
  }

  function expandRow(row: CollectionRowVm): void {
    if (row.hasChildren) state.expanded.add(row.key);
  }

  function collapseRow(row: CollectionRowVm): void {
    state.expanded.delete(row.key);
  }

  /** Every ancestor of an item, so a freshly created row is visible without the user expanding to
   *  it. Walks parent ids rather than the row model, which may not contain the row yet. Called
   *  right after a mutation's own mutateAsync resolves (§3.5: imperative code after an await) — the
   *  cache is already fresh at that point, but the reactive `items` computed may still lag one
   *  macrotask behind it (notifyManager's own batching), so this reads the cache directly rather
   *  than `items.value`. */
  function revealItem(collectionId: string, itemId: string | null): void {
    state.expanded.add(collectionKey(collectionId));
    const currentItems =
      queryClient.getQueryData<ApiCollectionsTree>(apiCollectionsTreeKey)?.items ?? [];
    let cursor = itemId;
    while (cursor) {
      const item = currentItems.find((row) => row.id === cursor);
      if (!item) return;
      state.expanded.add(itemKey(item.id));
      cursor = item.parentId;
    }
  }

  // ---- mutations ----
  //
  // Every one of them re-lists rather than patching the local arrays: the tree is one call and a
  // pure computed over it (F15), so a re-list is both simpler and impossible to get out of step
  // with what Go actually stored. D13's inline rename doubles as the naming step for all three
  // creation paths — one naming interaction instead of a prompt dialog this app does not have, and
  // VS Code's own explorer behaviour, which is the tree this panel is modelled on.

  const createCollectionMutation = useMutation(
    {
      mutationKey: ['apiCollectionsTree', 'createCollection'],
      mutationFn: () => control.collectionsCreateCollection('New collection'),
      onSuccess: afterTreeListChange,
    },
    queryClient,
  );

  async function createCollection(): Promise<void> {
    try {
      const collection = await createCollectionMutation.mutateAsync();
      const key = collectionKey(collection.id);
      state.selected = key;
      state.renamingKey = key;
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  const createItemMutation = useMutation(
    {
      mutationKey: ['apiCollectionsTree', 'createItem'],
      mutationFn: (args: {
        collectionId: string;
        parentId: string | null;
        kind: CollectionItemKind;
      }) =>
        control.collectionsCreateItem({
          collectionId: args.collectionId,
          parentId: args.parentId,
          kind: args.kind,
          name: args.kind === 'folder' ? 'New folder' : 'New request',
        }),
      onSuccess: afterTreeListChange,
    },
    queryClient,
  );

  async function createItem(
    collectionId: string,
    parentId: string | null,
    kind: CollectionItemKind,
  ): Promise<void> {
    try {
      const item = await createItemMutation.mutateAsync({ collectionId, parentId, kind });
      revealItem(collectionId, parentId);
      const key = itemKey(item.id);
      state.selected = key;
      state.renamingKey = key;
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  const createGrpcItemMutation = useMutation(
    {
      mutationKey: ['apiCollectionsTree', 'createGrpcItem'],
      mutationFn: (args: { collectionId: string; parentId: string | null }) =>
        control.collectionsCreateGrpcItem({
          collectionId: args.collectionId,
          parentId: args.parentId,
          name: 'New gRPC request',
        }),
      onSuccess: afterTreeListChange,
    },
    queryClient,
  );

  /** createItem's own gRPC sibling (P11 D12) — always a request, never a folder. */
  async function createGrpcItem(collectionId: string, parentId: string | null): Promise<void> {
    try {
      const item = await createGrpcItemMutation.mutateAsync({ collectionId, parentId });
      revealItem(collectionId, parentId);
      const key = itemKey(item.id);
      state.selected = key;
      state.renamingKey = key;
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  const renameRowMutation = useMutation(
    {
      mutationKey: ['apiCollectionsTree', 'rename'],
      mutationFn: (args: { id: string; target: 'collection' | 'item'; name: string }) =>
        control.collectionsRename(args.id, args.target, args.name),
      onSuccess: afterTreeListChange,
    },
    queryClient,
  );

  async function renameRow(row: CollectionRowVm, name: string): Promise<void> {
    state.renamingKey = null;
    try {
      const target = row.kind === 'collection' ? 'collection' : 'item';
      await renameRowMutation.mutateAsync({ id: row.id, target, name });
      // Every tab bound to this row follows immediately, so the view header and the tab strip
      // never disagree with the tree (D14).
      if (row.kind === 'request' && row.protocol === 'grpc') renameGrpcRequestTabs(row.id, name);
      else if (row.kind === 'request') renameApiRequestTabs(row.id, name);
      // P17 D16: a collection's own variable-set tab follows a rename too.
      else if (row.kind === 'collection') renameVariableSetTabs('collection', row.id, name);
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** P21 round 2 functional finding 4: Go's own delete genuinely cascades (repos/collections.go's
   *  own comment: "the cascade is genuine") — deleting a folder or a collection removes every
   *  descendant `api_items` row, not just the row itself. This walks the *pre-delete* tree
   *  (still valid — nothing has re-listed yet) to find every item id that the delete about to
   *  happen will also remove, so the caller can purge all of them from the renderer's own request
   *  caches, not just `row.id`. A request row's own subtree is itself.
   *
   *  §3.5: imperative, called before the delete mutation fires — reads the cache directly (the
   *  reactive `items` computed can lag it by one macrotask) rather than `childrenOf`'s own index,
   *  which is built from that same reactive computed. */
  function subtreeItemIds(row: CollectionRowVm): string[] {
    if (row.kind === 'request') return [row.id];
    const currentItems =
      queryClient.getQueryData<ApiCollectionsTree>(apiCollectionsTreeKey)?.items ?? [];
    if (row.kind === 'collection') {
      return currentItems.filter((item) => item.collectionId === row.id).map((item) => item.id);
    }
    // row.kind === 'folder': walk down from the folder itself, collecting every descendant
    // (folders and requests alike — a nested folder's own requests are still cascade-deleted).
    const ids: string[] = [row.id];
    const stack: string[] = [row.id];
    while (stack.length > 0) {
      const parentId = stack.pop() as string;
      for (const child of currentItems.filter(
        (item) => item.collectionId === row.collectionId && item.parentId === parentId,
      )) {
        ids.push(child.id);
        if (child.kind === 'folder') stack.push(child.id);
      }
    }
    return ids;
  }

  const deleteRowMutation = useMutation(
    {
      mutationKey: ['apiCollectionsTree', 'delete'],
      mutationFn: (args: { id: string; target: 'collection' | 'item' }) =>
        control.collectionsDelete(args.id, args.target),
      onSuccess: afterTreeListChange,
    },
    queryClient,
  );

  async function deleteRow(row: CollectionRowVm): Promise<void> {
    const target = row.kind === 'collection' ? 'collection' : 'item';
    const orphaned = subtreeItemIds(row);
    try {
      await deleteRowMutation.mutateAsync({ id: row.id, target });
      // Deleting a request does **not** close its open tabs (D14's orphan rule): a tab is an
      // editing surface with its own persisted state, and silently closing one because a tree row
      // went away would lose work. Its cached saved request goes, though, so the tab reads as
      // unsaved — and (finding 4) so does every *descendant* request's cache entry a
      // folder/collection delete just cascaded away, so `savedRequestFor` correctly reports null
      // for all of them instead of a stale entry that `onSave` would fail against with no visible
      // error.
      // P112: this local Record-based eviction moves onto the query cache (setQueryData(...,
      // null)) in this phase's own saved-request commit — left as-is here so this commit stays
      // self-contained and the file keeps compiling against the still-local requests/grpcRequests
      // caches until that later commit removes them.
      for (const id of orphaned) {
        delete state.requests[id];
        delete state.grpcRequests[id];
        // P108 F4: known-gone rather than merely uncached — spares any still-open tab's own
        // ensureSavedRequestLoaded a doomed GetRequest/GetGrpcRequest round trip that would only
        // reach the same conclusion via a caught error.
        state.orphanRequests[id] = true;
        state.orphanGrpcRequests[id] = true;
      }
      // P17 D16: unlike a request tab, a variable-set tab has no state of its own worth preserving
      // once its owner (the collection) is gone — deleting it closes any open tab for it.
      if (row.kind === 'collection') {
        closeVariableSetTabsForOwner('collection', row.id);
        // P108 F9's own listCache eviction is gone with listCache itself (P112) — afterTreeListChange
        // above (reconcileTree) now evicts the collection's own cached variables query, local
        // mutation or remote push alike.
      }
      if (state.selected === row.key) state.selected = null;
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Duplicating a folder or a request copies the row itself, not its subtree — moving and
   *  reordering are D18/§8 OQ-9's, and a deep copy would need both. */
  async function duplicateRow(row: CollectionRowVm): Promise<void> {
    const name = `${row.name} copy`;
    try {
      if (row.kind === 'folder') {
        await control.collectionsCreateItem({
          collectionId: row.collectionId,
          parentId: row.parentId,
          kind: 'folder',
          name,
        });
      } else if (row.protocol === 'grpc') {
        const saved = await fetchSavedGrpcRequest(row.id);
        await control.collectionsCreateGrpcItem({
          collectionId: row.collectionId,
          parentId: row.parentId,
          name,
          request: saved,
        });
      } else {
        const saved = await fetchSavedRequest(row.id);
        await control.collectionsCreateItem({
          collectionId: row.collectionId,
          parentId: row.parentId,
          kind: 'request',
          name,
          request: saved,
        });
      }
      await afterTreeListChange();
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  function beginRename(row: CollectionRowVm): void {
    state.selected = row.key;
    state.renamingKey = row.key;
  }

  function cancelRename(): void {
    state.renamingKey = null;
  }

  /** Creates the row, caches it as the tab's saved side, and binds the tab to it. */
  async function submitSaveDialog(
    collectionId: string,
    parentId: string | null,
    name: string,
  ): Promise<void> {
    const saveDialogStore = useSaveRequestDialogStore();
    const { tabId, payload } = saveDialogStore;
    if (!tabId || !payload) return;

    try {
      if (payload.protocol === 'grpc') {
        const item = await control.collectionsCreateGrpcItem({
          collectionId,
          parentId,
          name,
          request: payload.request,
        });
        state.grpcRequests[item.id] = payload.request;
        try {
          await control.grpcHistoryAdopt(tabId, item.id);
        } catch (err) {
          console.warn('adopting grpc call history into the saved request failed', err);
        }
        patchGrpcRequestTabState(tabId, { itemId: item.id, name });
        await afterTreeListChange();
        revealItem(collectionId, parentId);
        saveDialogStore.closeSaveDialog();
        state.error = null;
        return;
      }

      const item = await control.collectionsCreateItem({
        collectionId,
        parentId,
        kind: 'request',
        name,
        request: payload.request,
      });
      state.requests[item.id] = payload.request;
      // P8 D14: a scratch tab's response history follows it into the collection, before the tab's
      // itemId is patched below. Best-effort, the same posture D2's own Go-side Record call takes
      // — Save as… itself must succeed regardless of whether adopting its history did.
      // ResponsePane.vue's own watch on tab.state.itemId is what refetches the list under the new
      // scope once the patch below actually lands (http/** may not import views/**, so the
      // refetch can't be triggered from here).
      try {
        await control.historyAdopt(tabId, item.id);
      } catch (err) {
        console.warn('adopting response history into the saved request failed', err);
      }
      // The tab is now bound to a real row, so its title becomes the saved name and Save stops
      // falling back to Save as…
      patchHttpRequestTabState(tabId, { itemId: item.id, name });
      await afterTreeListChange();
      revealItem(collectionId, parentId);
      saveDialogStore.closeSaveDialog();
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** Save — writes an already-bound request back to its own row. */
  async function saveRequest(
    itemId: string,
    name: string,
    request: HttpSavedRequest,
  ): Promise<void> {
    try {
      await control.collectionsSaveRequest(itemId, name, request);
      // The cache is the dirty comparison's saved side, so it must move in step with the write or
      // the mark would stay lit after a successful save.
      state.requests[itemId] = request;
      await afterTreeListChange();
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  /** saveRequest's own gRPC sibling. */
  async function saveGrpcRequest(
    itemId: string,
    name: string,
    request: GrpcSavedRequest,
  ): Promise<void> {
    try {
      await control.collectionsSaveGrpcRequest(itemId, name, request);
      state.grpcRequests[itemId] = request;
      await afterTreeListChange();
      state.error = null;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  // ---- import (D11/D12) ----

  /** Opens the native file dialog and imports the chosen path. **Only the path crosses the bridge**
   *  — Go opens the file (F16: a 10-50 MB collection through the control plane is 20-100 serial
   *  round trips, and above 64 MiB an unattributable refusal). Returns false when cancelled. */
  async function importCollection(): Promise<boolean> {
    // P28 D18: a real re-entry guard. Until this, the only thing stopping a second concurrent
    // import was the panel button disabling itself while `busy` — and that button has moved to the
    // menu bar, which has no such state. Two overlapping imports would interleave their
    // afterTreeListChange()/report writes.
    if (state.busy) return false;
    const chosen = await control.filesChooseOpen({
      title: 'Import Postman collection',
      filters: [{ name: 'Postman collection', extensions: ['json'] }],
    });
    if (chosen.canceled || !chosen.file) return false;

    // D11: the panel's header action is disabled with a spinner for the duration rather than joining
    // the op log — that machinery is per tab (ViewChrome + useRunState) and an import started from
    // the left panel has no tab, so a row there would buy nothing the user is looking at.
    state.busy = true;
    state.error = null;
    try {
      const report = await control.collectionsImport(chosen.file.path);
      state.report = { ...report, warnings: report.warnings ?? [] };
      state.expanded.add(collectionKey(report.collectionId));
      state.selected = collectionKey(report.collectionId);
      return true;
    } catch (err) {
      // P108 F10: this used to let the error propagate uncaught, and (since it ran only in the
      // try's success path) never reloaded the tree on failure either — a partially-applied import
      // (Go's own import is not one transaction; some rows can land before a later one fails) left
      // the panel showing the pre-import tree until something else happened to reload it.
      state.error = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      // Always reloads, success or failure (P108 F10), before clearing `busy` — a partial import's
      // rows must be visible immediately, not just after the next unrelated refresh.
      await afterTreeListChange();
      state.busy = false;
    }
  }

  function dismissReport(): void {
    state.report = null;
  }

  function dismissExportWarning(): void {
    state.exportWarning = null;
  }

  // ---- export (D10/D11/D16) ----

  /** Opens the native save dialog and writes the collection there as Collection v2.1 JSON. As with
   *  import, only the path crosses the bridge — Go writes the file. Returns false when cancelled.
   *  D16: a secret exports valueless, and ExportReport.secretCount is what surfaces that once,
   *  rather than it being a fact only discoverable by opening the file. P108 F11: Postman
   *  Collection v2.1 has no representation for a gRPC request (P11 D12/F22), so Go's own Export
   *  skips every protocol='grpc' item and reports the count in ExportReport.skippedGrpc — this used
   *  to read secretCount only, silently dropping the skipped-request half of the same report the
   *  Go side already produces. */
  async function exportCollection(collectionId: string, name: string): Promise<boolean> {
    // The extension Postman's own exporter writes, so the file is recognisable on disk and
    // re-importable without renaming.
    const chosen = await control.filesChooseSave(`${name}.postman_collection.json`);
    if (chosen.canceled || !chosen.filePath) return false;
    state.busy = true;
    state.error = null;
    try {
      const report = await control.collectionsExport(collectionId, chosen.filePath);
      const notes: string[] = [];
      if (report.secretCount > 0) {
        notes.push(
          `${report.secretCount} secret value${report.secretCount === 1 ? ' was' : 's were'} not written to the file.`,
        );
      }
      if (report.skippedGrpc > 0) {
        notes.push(
          `${report.skippedGrpc} gRPC request${report.skippedGrpc === 1 ? '' : 's'} ${report.skippedGrpc === 1 ? 'was' : 'were'} skipped — Postman collections cannot represent gRPC requests.`,
        );
      }
      state.exportWarning = notes.length > 0 ? notes.join(' ') : null;
      return true;
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      state.busy = false;
    }
  }

  // ---- lookups the panel, the menus and the request view all share ----

  function itemRecord(itemId: string): CollectionItemSummary | undefined {
    return items.value.find((item) => item.id === itemId);
  }

  /** The collection a tab's own saved row belongs to, or '' for a scratch tab (D6). Shared by both
   *  protocols (P12 D9/F10) — both HttpRequestTabState and GrpcRequestTabState carry an `itemId`,
   *  which is the only field this reads. */
  function collectionIdFor(tabState: { itemId: string | null }): string {
    if (!tabState.itemId) return '';
    return itemRecord(tabState.itemId)?.collectionId ?? '';
  }

  function collectionRecord(collectionId: string): CollectionSummary | undefined {
    return collections.value.find((c) => c.id === collectionId);
  }

  /** Every folder in a collection, in tree order, as `Folder / Subfolder` labels — the target
   *  picker's own list (D15). */
  function folderPaths(collectionId: string): { id: string; label: string }[] {
    const out: { id: string; label: string }[] = [];
    const walk = (parentId: string | null, prefix: string): void => {
      for (const item of childrenOf(collectionId, parentId)) {
        if (item.kind !== 'folder') continue;
        const label = prefix ? `${prefix} / ${item.name}` : item.name;
        out.push({ id: item.id, label });
        walk(item.id, label);
      }
    };
    walk(null, '');
    return out;
  }

  return {
    ...toRefs(state),
    collections,
    items,
    loaded,
    treeLoadError,
    activeSearchQuery,
    visibleRows,
    fetchSavedRequest,
    savedRequestFor,
    fetchSavedGrpcRequest,
    savedGrpcRequestFor,
    isOrphanRequest,
    isOrphanGrpcRequest,
    ensureSavedRequestLoaded,
    ensureSavedGrpcRequestLoaded,
    selectRow,
    toggleRow,
    expandRow,
    collapseRow,
    createCollection,
    createItem,
    createGrpcItem,
    renameRow,
    deleteRow,
    duplicateRow,
    beginRename,
    cancelRename,
    submitSaveDialog,
    saveRequest,
    saveGrpcRequest,
    importCollection,
    dismissReport,
    dismissExportWarning,
    dismissError,
    exportCollection,
    itemRecord,
    collectionIdFor,
    collectionRecord,
    folderPaths,
  };
});

export type { CollectionItemKind };
