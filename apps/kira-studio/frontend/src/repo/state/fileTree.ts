import type { FileStatusCode } from '@shared/domain/repo';
import { markRaw, reactive } from 'vue';
import { control } from '../../bridge/control';
import type { StickyRowLike } from '../../theme/primitives/stickyBand';

// C5 §7.2: the flat path list -> row model fold. No single-child directory compaction (VS Code's
// `a/b/c` collapsing) — deliberately declined: it complicates the fold, the expand set and reveal,
// for a cosmetic gain (§7.2's own note, so a later phase adds it on purpose rather than by
// accident).
interface FileNode {
  name: string;
  nameLower: string; // C13-6: precomputed once here rather than on every filter-pass visit
  path: string; // repository-relative, '' only for the synthetic root
  isDir: boolean;
  children: FileNode[];
}

function buildTree(paths: readonly string[]): FileNode[] {
  const root: FileNode = { name: '', nameLower: '', path: '', isDir: true, children: [] };
  const dirs = new Map<string, FileNode>([['', root]]);

  for (const p of paths) {
    const segments = p.split('/');
    let parent = root;
    let acc = '';
    for (let i = 0; i < segments.length - 1; i++) {
      acc = acc ? `${acc}/${segments[i]}` : segments[i];
      let node = dirs.get(acc);
      if (!node) {
        node = {
          name: segments[i],
          nameLower: segments[i].toLowerCase(),
          path: acc,
          isDir: true,
          children: [],
        };
        dirs.set(acc, node);
        parent.children.push(node);
      }
      parent = node;
    }
    const name = segments[segments.length - 1];
    parent.children.push({
      name,
      nameLower: name.toLowerCase(),
      path: p,
      isDir: false,
      children: [],
    });
  }

  sortChildren(root);
  // C13-6c: the tree is replaced wholesale on every refresh (never field-mutated afterward — the
  // only per-node state that changes live, `expanded`/`status`, lives separately on RepoTreeState)
  // — markRaw so assigning this into `state.tree` (inside this repo's reactive() state object)
  // doesn't deep-proxy every node, at every level, of what can be a 200,000-entry tree.
  return markRaw(root.children);
}

// C13-4: one shared collator instead of a fresh `localeCompare(..., { sensitivity: 'base' })` call
// per comparison — same options, so identical ordering, but measured 20x faster at scale (200k
// files, the MaxListedFiles cap: 3,760ms -> 322ms for one buildTree call), since Intl.Collator's
// constructor is the expensive part `localeCompare` redoes on every single comparison otherwise.
const nameCollator = new Intl.Collator(undefined, { sensitivity: 'base' });

// Directories before files, each collator-sorted case-insensitive (§7.2).
function sortChildren(node: FileNode): void {
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return nameCollator.compare(a.name, b.name);
  });
  for (const child of node.children) if (child.isDir) sortChildren(child);
}

function subtreeMatches(node: FileNode, query: string): boolean {
  if (node.nameLower.includes(query)) return true;
  return node.isDir && node.children.some((c) => subtreeMatches(c, query));
}

export interface RepoTreeRowVm extends StickyRowLike {
  key: string;
  name: string;
  path: string;
  isDir: boolean;
  status: FileStatusCode | undefined;
  matched: boolean;
}

function flatten(
  nodes: readonly FileNode[],
  depth: number,
  expanded: ReadonlySet<string>,
  status: Readonly<Record<string, string>>,
  query: string,
  out: RepoTreeRowVm[],
): void {
  for (const node of nodes) {
    const matched = query !== '' && node.nameLower.includes(query);
    // C13-6a: subtreeMatches is a full recursive subtree walk — computed once and reused for both
    // the skip guard and the expand check below, instead of calling it twice per directory node.
    const dirMatches = query !== '' && node.isDir && subtreeMatches(node, query);
    if (query !== '' && !matched && !dirMatches) continue;
    // §7.2: the search box force-expands matching ancestors.
    const isExpanded = node.isDir && (expanded.has(node.path) || dirMatches);
    out.push({
      key: node.path || '/',
      name: node.name,
      path: node.path,
      depth,
      hasChildren: node.isDir && node.children.length > 0,
      expanded: isExpanded,
      isDir: node.isDir,
      status: status[node.path] as FileStatusCode | undefined,
      matched,
    });
    if (node.isDir && isExpanded) flatten(node.children, depth + 1, expanded, status, query, out);
  }
}

interface RepoTreeState {
  paths: string[];
  status: Record<string, string>;
  truncated: boolean;
  tree: FileNode[];
  expanded: Set<string>;
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

function emptyTreeState(): RepoTreeState {
  return {
    paths: [],
    status: {},
    truncated: false,
    tree: [],
    expanded: new Set(),
    loaded: false,
    loading: false,
    error: null,
  };
}

// One entry per open repo workspace. The Map itself must be `reactive()`, not just each value —
// visibleRepoRows' first read (from RepoFileTree.vue's `rows` computed, evaluated on initial
// render before ensureRepoTreeLoaded's onMounted has run) hits `byRepo.get(repoId)` while the
// entry doesn't exist yet and returns `[]` early, without ever touching a `.tree` property to
// depend on. A plain (non-reactive) Map makes that `.get()` itself untracked, so Vue never
// reruns the computed once `stateFor` later creates the entry and `refreshRepoTree` populates it
// — the tree would silently never render. Wrapping the Map in `reactive()` makes `.get()` itself
// a tracked read (Vue 3's native Map/Set support), so the computed correctly reruns once the
// entry is set.
const byRepo = reactive(new Map<string, RepoTreeState>());

function stateFor(repoId: string): RepoTreeState {
  let state = byRepo.get(repoId);
  if (!state) {
    state = reactive(emptyTreeState()) as RepoTreeState;
    byRepo.set(repoId, state);
  }
  return state;
}

/** True once repoId's listing has loaded at least once — GitPanel.vue's own loading gate. */
export function isRepoTreeLoaded(repoId: string): boolean {
  return byRepo.get(repoId)?.loaded ?? false;
}

export function repoTreeTruncated(repoId: string): boolean {
  return byRepo.get(repoId)?.truncated ?? false;
}

// C9 D1: quick open's own candidate list — the same flat array the tree already holds, so quick
// open inherits its snapshot exactly rather than re-enumerating.
export function repoTreePaths(repoId: string): readonly string[] {
  return byRepo.get(repoId)?.paths ?? [];
}

export function repoTreeError(repoId: string): string | null {
  return byRepo.get(repoId)?.error ?? null;
}

// C5 §7.1: refresh on workspace open and on an explicit Refresh action — nothing live (recorded in
// docs/ARCHITECTURE.md's Known open items).
export async function refreshRepoTree(repoId: string): Promise<void> {
  const state = stateFor(repoId);
  state.loading = true;
  state.error = null;
  try {
    const listing = await control.codeWorkspaceListFiles(repoId);
    state.paths = listing.paths;
    state.status = listing.status;
    state.truncated = listing.truncated;
    state.tree = buildTree(listing.paths);
    // §7.2: "the repo root's own children expanded on first open" — only on the very first load,
    // so a later Refresh never re-expands whatever the user has since collapsed.
    if (!state.loaded) {
      for (const node of state.tree) if (node.isDir) state.expanded.add(node.path);
    }
    state.loaded = true;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
  }
}

export function ensureRepoTreeLoaded(repoId: string): void {
  const state = stateFor(repoId);
  if (state.loaded || state.loading) return;
  void refreshRepoTree(repoId);
}

export function toggleRepoDir(repoId: string, path: string): void {
  const state = byRepo.get(repoId);
  if (!state) return;
  if (state.expanded.has(path)) state.expanded.delete(path);
  else state.expanded.add(path);
}

export function visibleRepoRows(repoId: string, search: string): RepoTreeRowVm[] {
  const state = byRepo.get(repoId);
  if (!state) return [];
  const rows: RepoTreeRowVm[] = [];
  flatten(state.tree, 0, state.expanded, state.status, search.trim().toLowerCase(), rows);
  return rows;
}

/** Drops repoId's own cached tree — RemoveRepo's own cleanup (a removed repo's tree state must not
 *  outlive it, however briefly, in this module-level map). */
export function dropRepoTree(repoId: string): void {
  byRepo.delete(repoId);
}
