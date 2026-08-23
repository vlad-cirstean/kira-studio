import type { ConnectionColor, ConnectionStatus } from '@shared/domain/connection';
import type { ConnectionFilter, ConnectionFilterInput } from '@shared/domain/connection-filter';
import type { SavedFilterQuery } from '@shared/domain/queries';
import type { NodeKind, TreeNode } from '@shared/domain/tree';
import { computed, reactive } from 'vue';
import { control } from '../../bridge/control';
import { connectionsState } from '../../state/connections';
import { evaluate } from '../filter';

export interface TreeRowVm {
  key: string;
  depth: number;
  connectionId: string;
  path: string;
  kind: NodeKind | 'connection';
  name: string;
  hasChildren: boolean;
  detail?: string;
  badges?: string[];
  expanded: boolean;
  loading: boolean;
  error?: string;
  matched?: boolean;
  // Connection rows only.
  color?: ConnectionColor;
  status?: ConnectionStatus;
  statusDetail?: string | null;
}

// key: `${connectionId}|${encodedPath}` — '' encodes the connection's own root.
export const treeState = reactive({
  children: {} as Record<string, TreeNode[]>,
  expanded: new Set<string>(),
  loading: new Set<string>(),
  errors: {} as Record<string, string>,
  filters: {} as Record<string, ConnectionFilter[]>,
  search: '',
  selected: null as string | null,
  /** Set by revealPath(); ProjectTree.vue watches it to scroll the row into view (Step 7b). */
  pendingScrollKey: null as string | null,
  /** Populated on demand for the tree's "Saved filters ▸" submenu (Step 13). */
  savedQueries: {} as Record<string, SavedFilterQuery[]>,
});

export function selectRow(key: string): void {
  treeState.selected = key;
}

// Fetched right before opening a relation's context menu (never memoised — a saved filter can
// be added/renamed/deleted between two right-clicks, and this is a fast local IPC round-trip).
export async function loadSavedQueries(connectionId: string, path: string): Promise<void> {
  treeState.savedQueries[rowKey(connectionId, path)] = await control.queriesList(
    connectionId,
    path,
  );
}

export const filtersDialogState = reactive({
  open: false,
  connectionId: null as string | null,
});

export function openFiltersDialog(connectionId: string): void {
  filtersDialogState.open = true;
  filtersDialogState.connectionId = connectionId;
}

export function closeFiltersDialog(): void {
  filtersDialogState.open = false;
  filtersDialogState.connectionId = null;
}

export function rowKey(connectionId: string, path: string): string {
  return `${connectionId}|${path}`;
}

async function loadChildren(connectionId: string, path: string, refresh: boolean): Promise<void> {
  const k = rowKey(connectionId, path);
  treeState.loading.add(k);
  delete treeState.errors[k];
  try {
    const result = await control.treeChildren(connectionId, path, refresh);
    treeState.children[k] = result.nodes;
  } catch (err) {
    treeState.errors[k] = err instanceof Error ? err.message : String(err);
  } finally {
    treeState.loading.delete(k);
  }
}

export async function loadFilters(connectionId: string): Promise<void> {
  if (treeState.filters[connectionId]) return;
  treeState.filters[connectionId] = await control.filtersList(connectionId);
}

export async function saveFilters(
  connectionId: string,
  inputs: ConnectionFilterInput[],
): Promise<void> {
  treeState.filters[connectionId] = await control.filtersReplace(connectionId, inputs);
}

// D25: skips the round trip when treeState.children[k] is already populated. This is not the
// "being clever about whether main's L1 cache would be a hit" the comment used to warn against —
// it decides nothing of the sort. It returns data the renderer already holds and is already
// rendering. The tree's copy has exactly two real invalidation sources and both still run:
// onConnectionMetadataInvalidated -> refreshExpanded (`initTreeSync` below, which passes
// refresh: true and so bypasses this early return) and an explicit context-menu refresh. A
// collapse never discards treeState.children[k], so re-expanding it was already a pure re-render
// — this just makes that true in code, which is what the §2.1 tree-expand budget assumes.
export async function expand(connectionId: string, path: string): Promise<void> {
  await loadFilters(connectionId);
  const k = rowKey(connectionId, path);
  treeState.expanded.add(k);
  if (treeState.loading.has(k)) return;
  if (treeState.children[k]) return;
  await loadChildren(connectionId, path, false);
}

export function collapse(connectionId: string, path: string): void {
  treeState.expanded.delete(rowKey(connectionId, path));
}

export async function refresh(connectionId: string, path: string): Promise<void> {
  treeState.expanded.add(rowKey(connectionId, path));
  await loadChildren(connectionId, path, true);
}

// D11's handler: re-fetches every currently-expanded path for the reconnected connection,
// breadth-first, sequentially — never fans out N parallel engine calls on one client.
export async function refreshExpanded(connectionId: string): Promise<void> {
  const prefix = `${connectionId}|`;
  const paths = [...treeState.expanded]
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .sort((a, b) => a.split('/').length - b.split('/').length);
  for (const path of paths) {
    await loadChildren(connectionId, path, true);
  }
}

export function collapseAll(): void {
  treeState.expanded.clear();
}

// §8.10's "Reveal in project panel" (Step 7b): expands every ancestor in order — sequentially,
// the same discipline refreshExpanded already uses — then selects the row and asks the tree
// view to scroll it into view.
export async function revealPath(connectionId: string, path: string): Promise<void> {
  if (!treeState.expanded.has(rowKey(connectionId, ''))) {
    await expand(connectionId, '');
  }
  const segments = path.split('/').filter(Boolean);
  let ancestor = '';
  for (let i = 0; i < segments.length - 1; i++) {
    ancestor = ancestor ? `${ancestor}/${segments[i]}` : segments[i];
    if (!treeState.expanded.has(rowKey(connectionId, ancestor))) {
      await expand(connectionId, ancestor);
    }
  }
  const key = rowKey(connectionId, path);
  treeState.selected = key;
  treeState.pendingScrollKey = key;
}

export async function refreshAllConnections(): Promise<void> {
  for (const conn of connectionsState.records) {
    await refreshExpanded(conn.id);
  }
}

// D6: purges every collection this module keys by connection identity. Driven off
// onConnectionsChanged (below) rather than off deleteConnection() directly, so every deletion
// path is covered — the context menu, a direct IPC call, a future bulk delete — the same
// reasoning state/connections.ts:44-50 records for that channel.
export function dropConnectionState(connectionId: string): void {
  const prefix = `${connectionId}|`;
  for (const k of Object.keys(treeState.children)) {
    if (k.startsWith(prefix)) delete treeState.children[k];
  }
  for (const k of [...treeState.expanded]) {
    if (k.startsWith(prefix)) treeState.expanded.delete(k);
  }
  for (const k of [...treeState.loading]) {
    if (k.startsWith(prefix)) treeState.loading.delete(k);
  }
  for (const k of Object.keys(treeState.errors)) {
    if (k.startsWith(prefix)) delete treeState.errors[k];
  }
  delete treeState.filters[connectionId];
  for (const k of Object.keys(treeState.savedQueries)) {
    if (k.startsWith(prefix)) delete treeState.savedQueries[k];
  }
  if (treeState.selected?.startsWith(prefix)) treeState.selected = null;
  if (treeState.pendingScrollKey?.startsWith(prefix)) treeState.pendingScrollKey = null;
}

// Every connection id this module currently holds state for, gathered from the six collections'
// own keys — `filters` is keyed directly by connectionId, the rest by rowKey (D6). Exported
// only for the Playwright-only `window.__kiraTreeConnectionIds` hook (main.ts, D6's leak spec).
export function knownConnectionIds(): Set<string> {
  const ids = new Set<string>();
  const addFromKey = (k: string): void => {
    const i = k.indexOf('|');
    ids.add(i >= 0 ? k.slice(0, i) : k);
  };
  for (const k of Object.keys(treeState.children)) addFromKey(k);
  for (const k of treeState.expanded) addFromKey(k);
  for (const k of treeState.loading) addFromKey(k);
  for (const k of Object.keys(treeState.errors)) addFromKey(k);
  for (const k of Object.keys(treeState.filters)) addFromKey(k);
  for (const k of Object.keys(treeState.savedQueries)) addFromKey(k);
  return ids;
}

let unsubscribeInvalidated: (() => void) | null = null;
let unsubscribeConnectionsChanged: (() => void) | null = null;

export function initTreeSync(): void {
  unsubscribeInvalidated?.();
  unsubscribeInvalidated = control.onConnectionMetadataInvalidated((connectionId) => {
    void refreshExpanded(connectionId);
  });

  unsubscribeConnectionsChanged?.();
  unsubscribeConnectionsChanged = control.onConnectionsChanged((records) => {
    const liveIds = new Set(records.map((r) => r.id));
    for (const id of knownConnectionIds()) {
      if (!liveIds.has(id)) dropConnectionState(id);
    }
  });
}

interface SearchStats {
  incomplete: boolean;
}

function buildRows(
  connectionId: string,
  nodes: TreeNode[],
  depth: number,
  filters: ConnectionFilter[],
  query: string,
  out: TreeRowVm[],
  stats: SearchStats,
): boolean {
  let anyMatch = false;
  for (const node of nodes) {
    if (!evaluate(node, filters)) continue;

    const k = rowKey(connectionId, node.path);
    const selfMatches = query ? node.name.toLowerCase().includes(query) : false;
    const childNodes = treeState.children[k];
    const naturallyExpanded = treeState.expanded.has(k);

    if (query && node.hasChildren && !childNodes) stats.incomplete = true;

    const childOut: TreeRowVm[] = [];
    let descendantMatch = false;
    // Search looks inside anything already cached, regardless of expansion state (§8c:
    // "searching cached nodes only" — it never triggers a fetch).
    if (childNodes && (query ? true : naturallyExpanded)) {
      descendantMatch = buildRows(
        connectionId,
        childNodes,
        depth + 1,
        filters,
        query,
        childOut,
        stats,
      );
    }

    if (query && !selfMatches && !descendantMatch) continue;

    const rowExpanded = query ? naturallyExpanded || descendantMatch : naturallyExpanded;
    out.push({
      key: k,
      depth,
      connectionId,
      path: node.path,
      kind: node.kind,
      name: node.name,
      hasChildren: node.hasChildren,
      detail: node.detail,
      badges: node.badges,
      expanded: rowExpanded,
      loading: treeState.loading.has(k),
      error: treeState.errors[k],
      matched: query ? selfMatches : undefined,
    });
    if (rowExpanded) out.push(...childOut);
    anyMatch = anyMatch || selfMatches || descendantMatch;
  }
  return anyMatch;
}

const searchResult = computed(() => {
  const rows: TreeRowVm[] = [];
  const stats: SearchStats = { incomplete: false };
  const query = treeState.search.trim().toLowerCase();

  for (const conn of connectionsState.records) {
    const connKey = rowKey(conn.id, '');
    const state = connectionsState.states[conn.id];
    const naturallyExpanded = treeState.expanded.has(connKey);
    const childNodes = treeState.children[connKey];
    const filters = treeState.filters[conn.id] ?? [];

    if (query && !childNodes) stats.incomplete = true;

    const childOut: TreeRowVm[] = [];
    let descendantMatch = false;
    if (childNodes && (query ? true : naturallyExpanded)) {
      descendantMatch = buildRows(conn.id, childNodes, 1, filters, query, childOut, stats);
    }

    const selfMatches = query ? conn.name.toLowerCase().includes(query) : false;
    if (query && !selfMatches && !descendantMatch) continue;

    const rowExpanded = query ? naturallyExpanded || descendantMatch : naturallyExpanded;
    const status = state?.status ?? 'disconnected';
    rows.push({
      key: connKey,
      depth: 0,
      connectionId: conn.id,
      path: '',
      kind: 'connection',
      name: conn.name,
      hasChildren: true,
      expanded: rowExpanded,
      loading: treeState.loading.has(connKey),
      error: treeState.errors[connKey],
      matched: query ? selfMatches : undefined,
      color: conn.color,
      status,
      statusDetail: status === 'error' ? (state?.error ?? null) : (state?.serverVersion ?? null),
    });
    if (rowExpanded) rows.push(...childOut);
  }

  return { rows, incomplete: query ? stats.incomplete : false };
});

export const visibleRows = computed<TreeRowVm[]>(() => searchResult.value.rows);
export const searchIncomplete = computed<boolean>(() => searchResult.value.incomplete);
