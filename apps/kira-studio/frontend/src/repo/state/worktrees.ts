import type { Transport, WorktreeEntry } from '@kira/git-ipc';
import { reactive, watch } from 'vue';
import { useCodeReposStore } from '../../state/coderepos';
import { pinia } from '../../state/pinia';
import { ensureRepoOpen } from '../../state/repoOpenHold';
import { useWorkspaceStore } from '../../state/workspace';
import { disposeGitTransport, gitTransportFor } from '../git/transport';
import { noteWorktreeLink, worktreeParentId } from './repoLinks';

// Module-level `watch()` below runs at import time, before `app.use(pinia)` — the explicit
// instance is required here (state/pinia.ts's own header comment).
const codeReposStore = useCodeReposStore(pinia);
const workspaceStore = useWorkspaceStore(pinia);

// P82 §6: per-repo worktree disclosure state, session-scoped and module-level — same shape and
// reasoning as fileTree.ts's byRepo/search.ts's repoSearchView. Not persisted (§0/§10): a future
// phase that wants that needs a new settings key or DB column.
interface RepoWorktreeState {
  expanded: boolean;
  loading: boolean;
  error: string | null;
  entries: readonly WorktreeEntry[];
}

// reactive() on the Map itself, not just each value — fileTree.ts:144-152's own reasoning: the
// template reads byRepo.get(id) before any entry exists, and a plain Map makes that read untracked.
const byRepo = reactive(new Map<string, RepoWorktreeState>());

function stateFor(codeRepoId: string): RepoWorktreeState {
  let state = byRepo.get(codeRepoId);
  if (!state) {
    state = reactive({
      expanded: false,
      loading: false,
      error: null,
      entries: [],
    }) as RepoWorktreeState;
    byRepo.set(codeRepoId, state);
  }
  return state;
}

// Leases are not reactive state (§6.1) — a real Stream('git') client plus its repo.changed
// subscription, kept alive for exactly as long as a row is expanded (§6.3's invariant).
const leases = new Map<string, { transport: Transport; off: () => void }>();

export function isWorktreesExpanded(codeRepoId: string): boolean {
  return byRepo.get(codeRepoId)?.expanded ?? false;
}

export function worktreeEntries(codeRepoId: string): readonly WorktreeEntry[] {
  const entries = byRepo.get(codeRepoId)?.entries ?? [];
  // P83 plan §13.2: the main worktree first, always. `git worktree list` already emits it first
  // (the property gitsession/worktree.go:92's `IsMain: i == 0` itself relies on) — this makes the
  // rendered order a guarantee of this function rather than an inherited one. Stable otherwise:
  // every non-main entry keeps the server's order. A copy before sorting, since `sort` mutates in
  // place and `entries` is the store's own array.
  return [...entries].sort((a, b) => Number(b.isMain) - Number(a.isMain));
}

export function worktreesLoading(codeRepoId: string): boolean {
  return byRepo.get(codeRepoId)?.loading ?? false;
}

export function worktreesError(codeRepoId: string): string | null {
  return byRepo.get(codeRepoId)?.error ?? null;
}

/** §6.2: `blameLine.ts:158`'s own fetch shape, verbatim — same transport, same `ensureRepoOpen`
 *  hold, same request. Always refetches (worktree.list is never cached server-side); the previous
 *  entries stay visible while loading, replaced only on success. */
async function refresh(codeRepoId: string): Promise<void> {
  const state = stateFor(codeRepoId);
  const record = codeReposStore.codeRepoRecord(codeRepoId);
  if (!record) return;
  const transport = leases.get(codeRepoId)?.transport;
  if (!transport) return;
  state.loading = true;
  try {
    await ensureRepoOpen(transport, record.repoId);
    const { worktrees } = await transport.request('worktree.list', { repoId: record.repoId });
    // A refetch that resolves for a row since collapsed (or removed) must not write — the same
    // stale-reply guard WorktreeState.reload makes.
    if (!byRepo.get(codeRepoId)?.expanded) return;
    state.entries = worktrees;
    state.error = null;
  } catch (err) {
    if (!byRepo.get(codeRepoId)?.expanded) return;
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (byRepo.get(codeRepoId)?.expanded) state.loading = false;
  }
}

/** §6.3: releases this row's lease — the shared client this expansion created, plus its
 *  repo.changed subscription. Invariant: a lease exists exactly while a row is expanded. */
function release(codeRepoId: string): void {
  const held = leases.get(codeRepoId);
  if (!held) return;
  leases.delete(codeRepoId);
  held.off();
  held.transport.dispose();
  // Nothing else holds a client for a repo with no open workspace — no tabs exist for one — so
  // this expansion is what opened the socket and the repo hold, and must be what ends them.
  if (!workspaceStore.openRepos.includes(codeRepoId)) disposeGitTransport(codeRepoId);
}

export function toggleRepoWorktrees(codeRepoId: string): void {
  const state = stateFor(codeRepoId);
  if (state.expanded) {
    collapseRepoWorktrees(codeRepoId);
    return;
  }
  state.expanded = true;
  state.error = null;
  const transport = gitTransportFor(codeRepoId);
  // §6.4: live refresh while expanded — the same repo.changed filter WorktreeState uses, so a
  // worktree created from the graph's own dialog appears without a collapse/expand round trip.
  const off = transport.on('repo.changed', (event) => {
    const record = codeReposStore.codeRepoRecord(codeRepoId);
    if (!record || event.repoId !== record.repoId || event.kind !== 'refsChanged') return;
    void refresh(codeRepoId);
  });
  leases.set(codeRepoId, { transport, off });
  void refresh(codeRepoId);
}

export function collapseRepoWorktrees(codeRepoId: string): void {
  release(codeRepoId);
  byRepo.delete(codeRepoId);
}

/** §7: "switch to this worktree" — a worktree row's click. Clicking the entry that *is* this row's
 *  own repository needs no special case: openRepoAtPath's codeRepoRecordForPath finds that row and
 *  openRepoWorkspace opens-or-activates it, same as onRowClick.
 *
 *  P84 §4.5: takes the entry, not the bare path, so it can write the click-time parent hint —
 *  between the import resolving and the next batched RepoWorktreeLinks answering, this is what
 *  keeps the freshly-imported row from flashing at the top level. */
export async function switchToWorktree(codeRepoId: string, wt: WorktreeEntry): Promise<void> {
  const state = stateFor(codeRepoId);
  state.error = null;
  try {
    await codeReposStore.openRepoAtPath(wt.path);
    if (wt.isMain) return; // clicking the main worktree imports the *anchor*, which has no parent
    const record = codeReposStore.codeRepoRecordForPath(wt.path);
    if (record) noteWorktreeLink(record.id, worktreeParentId(codeRepoId) || codeRepoId);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
}

/** git-ui's `pickerModel.ts:94`-`98` twin, four lines, replicated rather than imported:
 *  `pickerModel.ts` is not on `@kira/git-ui`'s exports map (only "." and "./icons"), and "."
 *  pulls the whole graph chunk. Keep the two in step by hand if either changes. */
export function worktreeLabel(entry: WorktreeEntry): string {
  if (entry.branch) return entry.branch.replace(/^refs\/heads\//, '');
  if (entry.isDetached && entry.head) return `detached @ ${entry.head.slice(0, 7)}`;
  return entry.isBare ? 'bare' : 'unknown';
}

// §6.6: eviction, without inverting an import — state/workspace.ts must not import this module (it
// already imports fileTree.ts/search.ts, and this module imports it), so both closures are watched
// here instead, the pattern quickOpen.ts:183-210 established for exactly this.

// A closed workspace's lease dies with its shared client (closeRepoWorkspace -> disposeGitTransport),
// so collapse here rather than leave a row expanded over a dead subscription. openRepos is always
// reassigned wholesale, so a plain watch sees the pre-close membership as `previous`.
watch(
  () => workspaceStore.openRepos,
  (openRepos, previous) => {
    if (!previous) return;
    for (const id of previous) if (!openRepos.includes(id)) collapseRepoWorktrees(id);
  },
);

// removeCodeRepo reassigns `records` wholesale; a removed repository must not keep an entry (or a
// lease) here. It also calls closeRepoWorkspace, but only the open case is covered by the watch above.
watch(
  () => codeReposStore.records,
  (records) => {
    const live = new Set(records.map((r) => r.id));
    for (const id of [...byRepo.keys()]) if (!live.has(id)) collapseRepoWorktrees(id);
  },
);
