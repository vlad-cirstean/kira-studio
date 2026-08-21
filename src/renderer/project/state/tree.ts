import type { ConnectionFilter, ConnectionFilterInput } from '@shared/connection';
import type { TreeNode } from '@shared/tree';
import { computed, reactive } from 'vue';
import { control } from '../../bridge/control';
import { evaluate } from '../filter';
import { connectionsState } from './connections';

// Project tree state (Step 8b). Cached nodes keyed `${connectionId}|${encodedPath}`; the expansion
// set is session-only (P1 — §8.4's session restore is P2's `tabs` work). Filters are applied at
// render time over cached nodes (D13), never to what is fetched.

export interface TreeRowVm {
  connectionId: string;
  depth: number;
  node: TreeNode;
}

export const treeState = reactive({
  children: {} as Record<string, TreeNode[]>,
  expanded: new Set<string>(),
  loading: new Set<string>(),
  errors: {} as Record<string, string>,
  search: '',
  filters: {} as Record<string, ConnectionFilter[]>,
  selected: null as string | null,
});

export const key = (connectionId: string, path: string): string => `${connectionId}|${path}`;

async function loadChildren(connectionId: string, path: string, refresh = false): Promise<void> {
  const k = key(connectionId, path);
  treeState.loading.add(k);
  delete treeState.errors[k];
  try {
    const { nodes } = await control.treeChildren({ connectionId, path, refresh });
    treeState.children[k] = nodes;
  } catch (err) {
    treeState.errors[k] = err instanceof Error ? err.message : String(err);
  } finally {
    treeState.loading.delete(k);
  }
}

export async function expand(connectionId: string, path: string): Promise<void> {
  const k = key(connectionId, path);
  treeState.expanded.add(k);
  if (treeState.children[k] === undefined) {
    await loadChildren(connectionId, path);
  }
}

export function collapse(connectionId: string, path: string): void {
  treeState.expanded.delete(key(connectionId, path));
}

export function collapseAll(): void {
  treeState.expanded.clear();
}

export function toggle(connectionId: string, path: string): void {
  const k = key(connectionId, path);
  if (treeState.expanded.has(k)) collapse(connectionId, path);
  else void expand(connectionId, path);
}

export async function refresh(connectionId: string, path: string): Promise<void> {
  await loadChildren(connectionId, path, true);
}

export async function refreshExpanded(connectionId: string): Promise<void> {
  // D11: re-fetch every currently-expanded path, breadth-first and sequentially (no fan-out of
  // parallel engine calls on one client).
  const paths = [...treeState.expanded]
    .filter((k) => k.startsWith(`${connectionId}|`))
    .map((k) => k.slice(connectionId.length + 1))
    .sort((a, b) => a.length - b.length);
  for (const path of paths) {
    await loadChildren(connectionId, path, true);
  }
}

export async function loadFilters(connectionId: string): Promise<ConnectionFilter[]> {
  const filters = await control.filtersList({ id: connectionId });
  treeState.filters[connectionId] = filters;
  return filters;
}

export async function replaceFilters(
  connectionId: string,
  filters: ConnectionFilterInput[],
): Promise<void> {
  treeState.filters[connectionId] = await control.filtersReplace({ connectionId, filters });
}

// Filters dialog (Step 8g): an editable draft rule list + live preview over cached nodes.
export interface FilterRuleDraft {
  nodeKind: 'database' | 'schema' | 'table';
  action: 'hide' | 'show';
  pattern: string;
  isRegex: boolean;
}

export const filtersDialogState = reactive({
  open: false,
  connectionId: null as string | null,
  rules: [] as FilterRuleDraft[],
});

export async function openFiltersDialog(connectionId: string): Promise<void> {
  await loadFilters(connectionId);
  filtersDialogState.connectionId = connectionId;
  filtersDialogState.rules = (treeState.filters[connectionId] ?? []).map((f) => ({
    nodeKind: f.nodeKind,
    action: f.action,
    pattern: f.pattern,
    isRegex: f.isRegex,
  }));
  filtersDialogState.open = true;
}

export function closeFiltersDialog(): void {
  filtersDialogState.open = false;
}

export async function saveFilters(): Promise<void> {
  const connectionId = filtersDialogState.connectionId;
  if (!connectionId) return;
  await replaceFilters(connectionId, filtersDialogState.rules);
  filtersDialogState.open = false;
}

export function cachedNodesFor(connectionId: string): TreeNode[] {
  const out: TreeNode[] = [];
  const prefix = `${connectionId}|`;
  for (const [k, nodes] of Object.entries(treeState.children)) {
    if (k.startsWith(prefix)) out.push(...nodes);
  }
  return out;
}

export async function hydrateTree(): Promise<void> {
  for (const record of connectionsState.records) {
    treeState.filters[record.id] = await control.filtersList({ id: record.id });
  }
  control.onConnectionMetadataInvalidated(({ connectionId, path }) => {
    if (path === undefined) void refreshExpanded(connectionId);
    else void loadChildren(connectionId, path, true);
  });
}

export const searchQuery = computed(() => treeState.search.trim().toLowerCase());

// Flatten cached nodes into a depth-ordered row list (Step 8c): filters first, then search. Search
// force-expands cached nodes (a collapsed-but-cached descendant is still found); clearing the
// search restores the expansion set, which is never mutated here.
export const visibleRows = computed<TreeRowVm[]>(() => {
  const search = searchQuery.value;
  const searching = search !== '';

  const recurse = (
    connectionId: string,
    node: TreeNode,
    depth: number,
  ): { shown: boolean; match: boolean; rows: TreeRowVm[] } => {
    const k = key(connectionId, node.path);
    const cached = treeState.children[k] ?? [];
    const children = searching || treeState.expanded.has(k) ? cached : [];
    const rules = treeState.filters[connectionId] ?? [];

    let descendantMatch = false;
    const childRows: TreeRowVm[] = [];
    for (const child of children) {
      const r = recurse(connectionId, child, depth + 1);
      if (r.shown) {
        childRows.push(...r.rows);
        if (r.match) descendantMatch = true;
      }
    }

    const selfMatch = nameMatches(node, search);
    const filterPasses = evaluate(node, rules);
    const searchKeeps = !searching || selfMatch || descendantMatch;
    const shown = filterPasses && searchKeeps;

    return {
      shown,
      match: shown && (!searching || selfMatch || descendantMatch),
      rows: shown ? [{ connectionId, depth, node }, ...childRows] : [],
    };
  };

  const rows: TreeRowVm[] = [];
  for (const record of connectionsState.records) {
    const r = recurse(
      record.id,
      { kind: 'connection', name: record.name, path: '', hasChildren: true },
      0,
    );
    rows.push(...r.rows);
  }
  return rows;
});

function nameMatches(node: TreeNode, search: string): boolean {
  return search !== '' && node.name.toLowerCase().includes(search);
}

// §8.3: say so when search is scoped to cached nodes rather than under-reporting silently.
export const searchNotice = computed(() => {
  if (!searchQuery.value) return false;
  for (const record of connectionsState.records) {
    if (!treeState.expanded.has(key(record.id, ''))) return true;
  }
  for (const k of Object.keys(treeState.children)) {
    if (!treeState.expanded.has(k)) return true;
  }
  return false;
});
