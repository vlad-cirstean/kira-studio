import type { ConnectionColor, ConnectionStatus } from '@shared/domain/connection';
import type { SavedFilterQuery } from '@shared/domain/queries';
import { type NodeKind, pathTail, type TreeNode } from '@shared/domain/tree';
import { EMPTY_VISIBILITY, type TreeVisibility } from '@shared/domain/tree-filter';
import { computed, reactive, ref, shallowReactive, watch } from 'vue';
import { control } from '../../bridge/control';
import { connectConnection, connectionRecord, connectionsState } from '../../state/connections';
import { isVisible, toSets, type VisibilitySets } from '../filter';
import { isLeafKind, labelForGroup, partitionChildren } from '../grouping';

export interface TreeRowVm {
  key: string;
  depth: number;
  connectionId: string;
  path: string;
  kind: NodeKind | 'connection' | 'group';
  /** Group rows only (P19 D2): the NodeKind this folder collects, for the icon and the empty
   *  check — the row's own `kind` is always the literal `'group'`. */
  groupKind?: NodeKind;
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

// `database:kira_test/schema:app#function` — a real encoded path can never contain '#'
// (encodeURIComponent('#') is '%23', and every path segment is `${kind}:${name}`), so this
// collides with no node's path and no other group's (P19 D2/realities #8).
export function groupPath(parentPath: string, kind: NodeKind): string {
  return `${parentPath}#${kind}`;
}

// The parent path a group's own Refresh/menu actions target — the inverse of groupPath().
export function groupParentPath(path: string): string {
  return path.slice(0, path.lastIndexOf('#'));
}

// key: `${connectionId}|${encodedPath}` — '' encodes the connection's own root.
//
// P2 R1: `children` is nested as its own shallowReactive rather than the plain object literal it
// used to be. treeState as a whole stays a deep reactive() — expanded/loading are Sets mutated in
// place (.add()/.delete()/.clear()), which only stay tracked under deep reactivity — but the only
// two writers of `children` (loadChildren below, dropConnectionState) always replace or delete a
// whole rowKey entry, never mutate a cached TreeNode's own fields. A big schema or a Redis
// namespace can cache thousands of TreeNode objects (and their badges arrays) here; deep-wrapping
// every one of them in a reactivity Proxy bought nothing no writer ever used. Vue's reactive() get
// trap recognizes an already-reactive nested value (via its RAW flag) and returns it as-is instead
// of re-wrapping it, so nesting a shallowReactive object inside this outer reactive() works without
// double-proxying.
export const treeState = reactive({
  children: shallowReactive({} as Record<string, TreeNode[]>),
  expanded: new Set<string>(),
  loading: new Set<string>(),
  errors: {} as Record<string, string>,
  visibility: {} as Record<string, TreeVisibility>,
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
  /** P28 D20: the row the dialog was invoked from — its ancestors pre-expanded and the row
   *  itself scrolled into view, rather than opening with no relationship to what was clicked. */
  focusPath: null as string | null,
});

export function openFiltersDialog(connectionId: string, focusPath?: string): void {
  filtersDialogState.open = true;
  filtersDialogState.connectionId = connectionId;
  filtersDialogState.focusPath = focusPath || null;
}

export function closeFiltersDialog(): void {
  filtersDialogState.open = false;
  filtersDialogState.connectionId = null;
  filtersDialogState.focusPath = null;
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
    // P43 iter2 D23: `result.truncated` is deliberately unread here — no level the project tree
    // ever renders can truncate (every SQL/Mongo/Kafka/SQS catalog enumerates a bounded
    // set in one round trip, and Redis/S3 stop expanding at the database/bucket, P41 D5). Only
    // views/browse/state.ts's own levels can, and it's the only place that shows the strip.
    treeState.children[k] = result.nodes;
  } catch (err) {
    treeState.errors[k] = err instanceof Error ? err.message : String(err);
  } finally {
    treeState.loading.delete(k);
  }
}

async function loadVisibility(connectionId: string): Promise<void> {
  if (treeState.visibility[connectionId]) return;
  treeState.visibility[connectionId] = await control.filtersList(connectionId);
}

export async function saveVisibility(
  connectionId: string,
  visibility: TreeVisibility,
): Promise<void> {
  treeState.visibility[connectionId] = await control.filtersReplace(connectionId, visibility);
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
  const k = rowKey(connectionId, path);
  if (treeState.loading.has(k)) return;
  // Expanding a disconnected connection's node connects it first, rather than surfacing
  // E_DISCONNECTED — the twisty is the primary way users browse, so it shouldn't require a
  // separate explicit Connect click first.
  if (connectionsState.states[connectionId]?.status !== 'connected') {
    treeState.loading.add(k);
    try {
      await connectConnection(connectionId);
    } finally {
      treeState.loading.delete(k);
    }
  }
  if (connectionsState.states[connectionId]?.status !== 'connected') return;
  await loadVisibility(connectionId);
  treeState.expanded.add(k);
  if (treeState.children[k]) return;
  await loadChildren(connectionId, path, false);
}

export function collapse(connectionId: string, path: string): void {
  treeState.expanded.delete(rowKey(connectionId, path));
}

// P19 D4: a group row is a pure view over its parent's already-fetched children — there is no
// adapter path for it, so toggling flips treeState.expanded directly rather than going through
// expand()/collapse(), which would connect the connection and issue an IPC call for a synthetic
// path no adapter has ever heard of.
export function toggleGroup(connectionId: string, path: string): void {
  const k = rowKey(connectionId, path);
  if (treeState.expanded.has(k)) treeState.expanded.delete(k);
  else treeState.expanded.add(k);
}

export async function refresh(connectionId: string, path: string): Promise<void> {
  treeState.expanded.add(rowKey(connectionId, path));
  await loadChildren(connectionId, path, true);
}

// D11's handler: re-fetches every currently-expanded path for the reconnected connection,
// breadth-first, sequentially — never fans out N parallel engine calls on one client. An
// expanded group's synthetic '#'-path is skipped (P19 D2/D4): it has no adapter path of its own,
// and its members are already covered by re-fetching its real parent — issuing a `treeChildren`
// call for it would decode as a bogus node name and error for nothing.
export async function refreshExpanded(connectionId: string): Promise<void> {
  const prefix = `${connectionId}|`;
  const paths = [...treeState.expanded]
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .filter((path) => !path.includes('#'))
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
//
// P41 D9: a keyBrowser connection's database/bucket is a leaf here (F20) — nothing beneath it has
// a tree row to expand into or scroll to, so a path reaching into one truncates at that container:
// the deepest ancestor the tree actually renders is selected/scrolled instead of a row that will
// never exist. "Reveal in project panel" names the panel; revealing the container an item lives in
// is the honest answer once the panel stops holding the item itself.
export async function revealPath(connectionId: string, path: string): Promise<void> {
  if (!treeState.expanded.has(rowKey(connectionId, ''))) {
    await expand(connectionId, '');
  }
  const keyBrowser = connectionsState.states[connectionId]?.caps?.keyBrowser === true;
  const segments = path.split('/').filter(Boolean);
  let ancestor = '';
  for (let i = 0; i < segments.length - 1; i++) {
    ancestor = ancestor ? `${ancestor}/${segments[i]}` : segments[i];
    const kind = pathTail(ancestor)?.kind;
    if (keyBrowser && (kind === 'database' || kind === 'bucket')) {
      const key = rowKey(connectionId, ancestor);
      treeState.selected = key;
      treeState.pendingScrollKey = key;
      return;
    }
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
function dropConnectionState(connectionId: string): void {
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
  delete treeState.visibility[connectionId];
  for (const k of Object.keys(treeState.savedQueries)) {
    if (k.startsWith(prefix)) delete treeState.savedQueries[k];
  }
  if (treeState.selected?.startsWith(prefix)) treeState.selected = null;
  if (treeState.pendingScrollKey?.startsWith(prefix)) treeState.pendingScrollKey = null;
}

// Every connection id this module currently holds state for, gathered from the six collections'
// own keys — `visibility` is keyed directly by connectionId, the rest by rowKey (D6). Exported
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
  for (const k of Object.keys(treeState.visibility)) addFromKey(k);
  for (const k of Object.keys(treeState.savedQueries)) addFromKey(k);
  return ids;
}

let unsubscribeInvalidated: (() => void) | null = null;
let unsubscribeConnectionsChanged: (() => void) | null = null;
let unsubscribeConnectionState: (() => void) | null = null;

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

  // P5 D6/F9: a disconnected connection's tree copy is neither authoritative nor reused — L1
  // metadata is persisted server-side and refreshed on every reconnect regardless
  // (docs/ARCHITECTURE.md's Caching section) — so it is released the same way a deleted
  // connection's is (dropConnectionState, unchanged), just on a different signal. Reached through
  // control's own onConnectionState broadcast rather than by reaching into
  // state/connections.ts's disconnectConnection() directly (:249-251's own reasoning for why
  // dropConnectionState is driven off a canonical push, not a specific action function): this way
  // covers every path that can produce the transition — an explicit Disconnect click, main
  // reporting a lost connection — not just the renderer's own button. `connecting`/`error` are
  // deliberately left alone: a reconnect attempt in flight, or one that failed and might be
  // retried, is not "the user disconnected" — dropping the tree there would collapse/re-fetch a
  // still-expanded tree out from under a transient state.
  unsubscribeConnectionState?.();
  unsubscribeConnectionState = control.onConnectionState((state) => {
    if (state.status === 'disconnected') dropConnectionState(state.connectionId);
  });
}

interface SearchStats {
  incomplete: boolean;
}

// P41: `sets` (the checkbox filter, P28) and `keyBrowser` (whether database/bucket rows are leaves
// here, D7) are both per-connection facts computed once in searchResult below and threaded through
// unchanged — bundled together rather than as a further positional parameter, since buildRows/
// buildNodeRow already took six/seven of those each.
interface ConnectionView {
  sets: VisibilitySets;
  keyBrowser: boolean;
}

// One TreeNode's own row, plus its expanded subtree — shared by ungrouped nodes and group
// members alike (P19 D2: a group's members go through exactly this, one depth deeper, never a
// second grouping pass). Returns whether this node or anything under it matched the search query.
function buildNodeRow(
  connectionId: string,
  node: TreeNode,
  depth: number,
  view: ConnectionView,
  query: string,
  out: TreeRowVm[],
  stats: SearchStats,
): boolean {
  const k = rowKey(connectionId, node.path);
  const selfMatches = query ? node.name.toLowerCase().includes(query) : false;
  // P19 D5: a table/view/matview is a leaf regardless of what a cached node's own hasChildren
  // says — its columns moved into the definition view, but an L1 payload cached before this
  // phase can still carry `hasChildren: true` until the connection's next reconnect. P41 adds
  // database/bucket for a keyBrowser connection, same reasoning (F12).
  const leaf = isLeafKind(node.kind, view.keyBrowser);
  const childNodes = leaf ? undefined : treeState.children[k];
  const naturallyExpanded = !leaf && treeState.expanded.has(k);

  if (query && node.hasChildren && !leaf && !childNodes) stats.incomplete = true;

  const childOut: TreeRowVm[] = [];
  let descendantMatch = false;
  // Search looks inside anything already cached, regardless of expansion state (§8c:
  // "searching cached nodes only" — it never triggers a fetch).
  if (childNodes && (query ? true : naturallyExpanded)) {
    descendantMatch = buildRows(
      connectionId,
      node.path,
      childNodes,
      depth + 1,
      view,
      query,
      childOut,
      stats,
    );
  }

  if (query && !selfMatches && !descendantMatch) return false;

  const rowExpanded = query ? naturallyExpanded || descendantMatch : naturallyExpanded;
  out.push({
    key: k,
    depth,
    connectionId,
    path: node.path,
    kind: node.kind,
    name: node.name,
    hasChildren: leaf ? false : node.hasChildren,
    detail: node.detail,
    badges: node.badges,
    expanded: rowExpanded,
    loading: treeState.loading.has(k),
    error: treeState.errors[k],
    matched: query ? selfMatches : undefined,
  });
  if (rowExpanded) out.push(...childOut);
  return selfMatches || descendantMatch;
}

function buildRows(
  connectionId: string,
  parentPath: string,
  nodes: TreeNode[],
  depth: number,
  view: ConnectionView,
  query: string,
  out: TreeRowVm[],
  stats: SearchStats,
): boolean {
  let anyMatch = false;
  const visible = nodes.filter((node) => isVisible(node, view.sets));
  const { ungrouped, groups } = partitionChildren(visible);

  for (const node of ungrouped) {
    if (buildNodeRow(connectionId, node, depth, view, query, out, stats)) anyMatch = true;
  }

  if (groups.length === 0) return anyMatch;
  const connectionKind = connectionRecord(connectionId)?.kind;
  for (const group of groups) {
    const path = groupPath(parentPath, group.kind);
    const k = rowKey(connectionId, path);
    const childOut: TreeRowVm[] = [];
    let anyChildMatch = false;
    for (const member of group.nodes) {
      if (buildNodeRow(connectionId, member, depth + 1, view, query, childOut, stats)) {
        anyChildMatch = true;
      }
    }
    if (query && !anyChildMatch) continue;

    const naturallyExpanded = treeState.expanded.has(k);
    const rowExpanded = query ? naturallyExpanded || anyChildMatch : naturallyExpanded;
    out.push({
      key: k,
      depth,
      connectionId,
      path,
      kind: 'group',
      groupKind: group.kind,
      name: connectionKind ? labelForGroup(group.kind, connectionKind) : group.kind,
      hasChildren: true,
      expanded: rowExpanded,
      loading: false,
    });
    if (rowExpanded) out.push(...childOut);
    anyMatch = anyMatch || anyChildMatch;
  }
  return anyMatch;
}

// P2 R1: buildRows/buildNodeRow recurse over every currently-cached node for every connection —
// for a large expanded schema or key-browser namespace, that's a full traversal of thousands of
// nodes on every single keystroke SearchBox.vue/ProjectPanel.vue write into treeState.search
// directly (so the input itself stays instantly responsive). debouncedQuery only updates
// SEARCH_DEBOUNCE_MS after typing settles, and searchResult (plus TreeRow.vue's own highlight,
// via activeSearchQuery below) reads that instead, so a fast typist causes one recompute per pause
// rather than one per character.
const SEARCH_DEBOUNCE_MS = 150;
const debouncedQuery = ref('');
let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => treeState.search,
  (value) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      debouncedQuery.value = value.trim().toLowerCase();
    }, SEARCH_DEBOUNCE_MS);
  },
);

// TreeRow.vue's highlightParts() needs the exact query that produced row.matched, not the live
// (undebounced) treeState.search — otherwise the highlighted substring can briefly disagree with
// why a row is even showing as matched.
export const activeSearchQuery = computed(() => debouncedQuery.value);

const searchResult = computed(() => {
  const rows: TreeRowVm[] = [];
  const stats: SearchStats = { incomplete: false };
  const query = debouncedQuery.value;

  for (const conn of connectionsState.records) {
    const connKey = rowKey(conn.id, '');
    const state = connectionsState.states[conn.id];
    const naturallyExpanded = treeState.expanded.has(connKey);
    const childNodes = treeState.children[connKey];
    const view: ConnectionView = {
      sets: toSets(treeState.visibility[conn.id] ?? EMPTY_VISIBILITY),
      keyBrowser: state?.caps?.keyBrowser === true,
    };

    if (query && !childNodes) stats.incomplete = true;

    const childOut: TreeRowVm[] = [];
    let descendantMatch = false;
    if (childNodes && (query ? true : naturallyExpanded)) {
      descendantMatch = buildRows(conn.id, '', childNodes, 1, view, query, childOut, stats);
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
