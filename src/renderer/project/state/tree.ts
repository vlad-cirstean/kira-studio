import type { ConnectionColor, ConnectionStatus } from '@shared/domain/connection';
import type { ConnectionFilter, ConnectionFilterInput } from '@shared/domain/connection-filter';
import type { SavedQuery } from '@shared/domain/queries';
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
  savedQueries: {} as Record<string, SavedQuery[]>,
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

// Every expand() round-trips through kira:tree:children regardless of local state — main's L1
// cache is what decides whether that is a real server call or a fast cache hit (D10). Trying
// to be clever about it here would just duplicate that cache-aside logic and risk disagreeing
// with it.
export async function expand(connectionId: string, path: string): Promise<void> {
  await loadFilters(connectionId);
  const k = rowKey(connectionId, path);
  treeState.expanded.add(k);
  if (treeState.loading.has(k)) return;
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

let unsubscribeInvalidated: (() => void) | null = null;

export function initTreeSync(): void {
  unsubscribeInvalidated?.();
  unsubscribeInvalidated = control.onConnectionMetadataInvalidated((connectionId) => {
    void refreshExpanded(connectionId);
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
