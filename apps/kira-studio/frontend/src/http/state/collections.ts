import {
  type CollectionItemKind,
  type CollectionItemSummary,
  type CollectionSummary,
  type HttpSavedRequest,
  httpSavedRequestSchema,
  type ImportReport,
} from '@shared/domain/collections';
import { computed, reactive } from 'vue';
import { control } from '../../bridge/control';
import { patchHttpRequestTabState, renameHttpRequestTabs } from '../../state/tabs';

// P4 D13: Http's own tree store. Studio's tree is lazy because its data is remote — expanding a
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
  matched: boolean;
}

/** TreeHost requires a unique string key per row, and the two id spaces are separate tables. */
export function collectionKey(id: string): string {
  return `c:${id}`;
}
export function itemKey(id: string): string {
  return `i:${id}`;
}

interface CollectionsState {
  collections: CollectionSummary[];
  items: CollectionItemSummary[];
  expanded: Set<string>;
  selected: string | null;
  search: string;
  /** The row key whose label is currently an inline rename input, if any. */
  renamingKey: string | null;
  /** Saved requests read on demand by GetRequest, keyed by item id — the dirty comparison's
   *  other half (D15) and the reason opening an already-open request costs no call. */
  requests: Record<string, HttpSavedRequest>;
  busy: boolean;
  report: ImportReport | null;
  loaded: boolean;
}

export const collectionsState = reactive<CollectionsState>({
  collections: [],
  items: [],
  expanded: new Set<string>(),
  selected: null,
  search: '',
  renamingKey: null,
  requests: {},
  busy: false,
  report: null,
  loaded: false,
});

/** Re-reads the whole tree. One call per panel mount (and after every mutation) — the tree is
 *  rows in a local table, so there is nothing to fetch lazily and nothing to be incomplete
 *  about. */
export async function loadCollections(): Promise<void> {
  const { collections, items } = await control.collectionsList();
  collectionsState.collections = collections;
  collectionsState.items = items as CollectionItemSummary[];
  collectionsState.loaded = true;
}

export function initCollections(): void {
  if (collectionsState.loaded) return;
  void loadCollections();
}

/** Reads a saved request, caching it by item id. The cache is the dirty comparison's other half
 *  (D15) as well as an open-cost saving: re-opening an already-open request costs no call. */
export async function fetchSavedRequest(itemId: string): Promise<HttpSavedRequest> {
  const cached = collectionsState.requests[itemId];
  if (cached) return cached;
  const saved = httpSavedRequestSchema.parse(await control.collectionsGetRequest(itemId));
  collectionsState.requests[itemId] = saved;
  return saved;
}

/** The saved side of the dirty comparison, or null when this tab's row has never been read (or no
 *  longer resolves — D14's orphan rule). */
export function savedRequestFor(itemId: string | null): HttpSavedRequest | null {
  if (!itemId) return null;
  return collectionsState.requests[itemId] ?? null;
}

// ---- the row model ----

function childrenOf(collectionId: string, parentId: string | null): CollectionItemSummary[] {
  return collectionsState.items
    .filter((item) => item.collectionId === collectionId && item.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Lower-cased once per render rather than per row. '' means "no search active". */
export const activeSearchQuery = computed(() => collectionsState.search.trim().toLowerCase());

function rowMatches(name: string, url: string, query: string): boolean {
  if (!query) return false;
  return name.toLowerCase().includes(query) || url.toLowerCase().includes(query);
}

/** True when this subtree contains a match, so an ancestor of a hit still renders. */
function subtreeMatches(item: CollectionItemSummary, query: string): boolean {
  if (rowMatches(item.name, item.url, query)) return true;
  return childrenOf(item.collectionId, item.id).some((child) => subtreeMatches(child, query));
}

export const visibleRows = computed<CollectionRowVm[]>(() => {
  const query = activeSearchQuery.value;
  const rows: CollectionRowVm[] = [];

  const pushItems = (collectionId: string, parentId: string | null, depth: number): void => {
    for (const item of childrenOf(collectionId, parentId)) {
      if (query && !subtreeMatches(item, query)) continue;
      const children = childrenOf(collectionId, item.id);
      // While a query is active every ancestor of a match renders expanded **without mutating
      // `expanded`**, so clearing the search restores exactly the shape the user had.
      const expanded = query ? true : collectionsState.expanded.has(itemKey(item.id));
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
        matched: rowMatches(item.name, item.url, query),
      });
      if (item.kind === 'folder' && expanded) pushItems(collectionId, item.id, depth + 1);
    }
  };

  for (const collection of collectionsState.collections) {
    const children = childrenOf(collection.id, null);
    const hasMatch = !query || children.some((child) => subtreeMatches(child, query));
    if (query && !hasMatch && !rowMatches(collection.name, '', query)) continue;
    const expanded = query ? true : collectionsState.expanded.has(collectionKey(collection.id));
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
      matched: rowMatches(collection.name, '', query),
    });
    if (expanded) pushItems(collection.id, null, 1);
  }
  return rows;
});

// ---- selection and expansion ----

export function selectRow(key: string): void {
  collectionsState.selected = key;
}

export function toggleRow(row: CollectionRowVm): void {
  if (!row.hasChildren) return;
  if (collectionsState.expanded.has(row.key)) collectionsState.expanded.delete(row.key);
  else collectionsState.expanded.add(row.key);
}

export function expandRow(row: CollectionRowVm): void {
  if (row.hasChildren) collectionsState.expanded.add(row.key);
}

export function collapseRow(row: CollectionRowVm): void {
  collectionsState.expanded.delete(row.key);
}

/** Every ancestor of an item, so a freshly created row is visible without the user expanding to
 *  it. Walks parent ids rather than the row model, which may not contain the row yet. */
export function revealItem(collectionId: string, itemId: string | null): void {
  collectionsState.expanded.add(collectionKey(collectionId));
  let cursor = itemId;
  while (cursor) {
    const item = collectionsState.items.find((row) => row.id === cursor);
    if (!item) return;
    collectionsState.expanded.add(itemKey(item.id));
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

export async function createCollection(): Promise<void> {
  const collection = await control.collectionsCreateCollection('New collection');
  await loadCollections();
  const key = collectionKey(collection.id);
  collectionsState.selected = key;
  collectionsState.renamingKey = key;
}

export async function createItem(
  collectionId: string,
  parentId: string | null,
  kind: CollectionItemKind,
): Promise<void> {
  const item = await control.collectionsCreateItem({
    collectionId,
    parentId,
    kind,
    name: kind === 'folder' ? 'New folder' : 'New request',
  });
  await loadCollections();
  revealItem(collectionId, parentId);
  const key = itemKey(item.id);
  collectionsState.selected = key;
  collectionsState.renamingKey = key;
}

export async function renameRow(row: CollectionRowVm, name: string): Promise<void> {
  collectionsState.renamingKey = null;
  const target = row.kind === 'collection' ? 'collection' : 'item';
  await control.collectionsRename(row.id, target, name);
  // Every tab bound to this row follows immediately, so the view header and the tab strip never
  // disagree with the tree (D14).
  if (row.kind === 'request') renameHttpRequestTabs(row.id, name);
  await loadCollections();
}

export async function deleteRow(row: CollectionRowVm): Promise<void> {
  const target = row.kind === 'collection' ? 'collection' : 'item';
  await control.collectionsDelete(row.id, target);
  // Deleting a request does **not** close its open tabs (D14's orphan rule): a tab is an editing
  // surface with its own persisted state, and silently closing one because a tree row went away
  // would lose work. Its cached saved request goes, though, so the tab reads as unsaved.
  delete collectionsState.requests[row.id];
  if (collectionsState.selected === row.key) collectionsState.selected = null;
  await loadCollections();
}

/** Duplicating a folder or a request copies the row itself, not its subtree — moving and
 *  reordering are D18/§8 OQ-9's, and a deep copy would need both. */
export async function duplicateRow(row: CollectionRowVm): Promise<void> {
  const name = `${row.name} copy`;
  if (row.kind === 'folder') {
    await control.collectionsCreateItem({
      collectionId: row.collectionId,
      parentId: row.parentId,
      kind: 'folder',
      name,
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
  await loadCollections();
}

export function beginRename(row: CollectionRowVm): void {
  collectionsState.selected = row.key;
  collectionsState.renamingKey = row.key;
}

export function cancelRename(): void {
  collectionsState.renamingKey = null;
}

// ---- saving a request into a collection (D15) ----

interface SaveDialogState {
  open: boolean;
  /** The tab being saved. */
  tabId: string | null;
  suggestedName: string;
  request: HttpSavedRequest | null;
}

export const saveDialogState = reactive<SaveDialogState>({
  open: false,
  tabId: null,
  suggestedName: '',
  request: null,
});

/** Save as… — the request view opens this without importing the dialog component. */
export function openSaveDialog(
  tabId: string,
  suggestedName: string,
  request: HttpSavedRequest,
): void {
  saveDialogState.tabId = tabId;
  saveDialogState.suggestedName = suggestedName;
  saveDialogState.request = request;
  saveDialogState.open = true;
}

export function closeSaveDialog(): void {
  saveDialogState.open = false;
  saveDialogState.request = null;
  saveDialogState.tabId = null;
}

/** Creates the row, caches it as the tab's saved side, and binds the tab to it. */
export async function submitSaveDialog(
  collectionId: string,
  parentId: string | null,
  name: string,
): Promise<void> {
  const { tabId, request } = saveDialogState;
  if (!tabId || !request) return;
  const item = await control.collectionsCreateItem({
    collectionId,
    parentId,
    kind: 'request',
    name,
    request,
  });
  collectionsState.requests[item.id] = request;
  // The tab is now bound to a real row, so its title becomes the saved name and Save stops
  // falling back to Save as…
  patchHttpRequestTabState(tabId, { itemId: item.id, name });
  await loadCollections();
  revealItem(collectionId, parentId);
  closeSaveDialog();
}

/** Save — writes an already-bound request back to its own row. */
export async function saveRequest(
  itemId: string,
  name: string,
  request: HttpSavedRequest,
): Promise<void> {
  await control.collectionsSaveRequest(itemId, name, request);
  // The cache is the dirty comparison's saved side, so it must move in step with the write or the
  // mark would stay lit after a successful save.
  collectionsState.requests[itemId] = request;
  await loadCollections();
}

// ---- import (D11/D12) ----

/** Opens the native file dialog and imports the chosen path. **Only the path crosses the bridge**
 *  — Go opens the file (F16: a 10-50 MB collection through the control plane is 20-100 serial
 *  round trips, and above 64 MiB an unattributable refusal). Returns false when cancelled. */
export async function importCollection(): Promise<boolean> {
  const chosen = await control.filesChooseOpen({
    title: 'Import Postman collection',
    filters: [{ name: 'Postman collection', extensions: ['json'] }],
  });
  if (chosen.canceled || !chosen.file) return false;

  // D11: the panel's header action is disabled with a spinner for the duration rather than joining
  // the op log — that machinery is per tab (ViewChrome + useRunState) and an import started from
  // the left panel has no tab, so a row there would buy nothing the user is looking at.
  collectionsState.busy = true;
  try {
    const report = await control.collectionsImport(chosen.file.path);
    collectionsState.report = { ...report, warnings: report.warnings ?? [] };
    await loadCollections();
    collectionsState.expanded.add(collectionKey(report.collectionId));
    collectionsState.selected = collectionKey(report.collectionId);
    return true;
  } finally {
    collectionsState.busy = false;
  }
}

export function dismissReport(): void {
  collectionsState.report = null;
}

// ---- lookups the panel, the menus and the request view all share ----

export function itemRecord(itemId: string): CollectionItemSummary | undefined {
  return collectionsState.items.find((item) => item.id === itemId);
}

export function collectionRecord(collectionId: string): CollectionSummary | undefined {
  return collectionsState.collections.find((c) => c.id === collectionId);
}

/** Every folder in a collection, in tree order, as `Folder / Subfolder` labels — the target
 *  picker's own list (D15). */
export function folderPaths(collectionId: string): { id: string; label: string }[] {
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

export type { CollectionItemKind };
