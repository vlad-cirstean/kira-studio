import { canonicalPath } from '@shared/domain/path';
import type { RepoSummary } from '@shared/domain/repo';
import { moveId } from '@workbench/util/useSortableReorder';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';
import { useWorkspaceStore } from './workspace';

// C5 §3.4: the repo list store, ConnectionsRepo's own shape for a repository entry — hydrate,
// import, rename, reorder, remove. No connect/disconnect lifecycle (a repository is a path, not a live
// session, D11) and no secret-storage concept (D1's own "nothing secret, nothing credential-
// shaped").
export const useCodeReposStore = defineStore('coderepos', () => {
  const state = reactive({
    records: [] as RepoSummary[],
  });
  // The outer useCodeReposStore(pinia) call in main.ts's bootstrap() sets the active Pinia
  // instance before this setup body runs, so this nested call correctly resolves to it without
  // needing its own explicit instance (state/pinia.ts's own header comment).
  const workspaceStore = useWorkspaceStore();

  function codeRepoRecord(id: string | null | undefined): RepoSummary | undefined {
    if (!id) return undefined;
    return state.records.find((r) => r.id === id);
  }

  function upsertRecord(repo: RepoSummary): void {
    const idx = state.records.findIndex((r) => r.id === repo.id);
    if (idx >= 0) state.records[idx] = repo;
    else state.records = [...state.records, repo];
  }

  // A list response older than a newer request's is dropped: it could lack a repo imported since.
  let listSeq = 0;
  async function hydrateCodeRepos(): Promise<void> {
    const seq = ++listSeq;
    const list = await control.codeWorkspaceListRepos();
    if (seq !== listSeq) return;
    state.records = list;
    // Another window removed a repository: an open workspace on it would answer every call E_NOT_FOUND.
    const live = new Set(state.records.map((r) => r.id));
    for (const id of [...workspaceStore.openRepos]) {
      if (!live.has(id)) workspaceStore.closeRepoWorkspace(id);
    }
  }

  let subscribed = false;
  /** Boot: subscribes before the first read so a push landing mid-await is not lost, and keeps the
   *  list live in every module and window for the window's lifetime. The push is payload-free, so
   *  each one re-reads. */
  async function initCodeRepos(): Promise<void> {
    if (!subscribed) {
      subscribed = true;
      control.onAdeTaskRepos(() => {
        void hydrateCodeRepos();
      });
    }
    await hydrateCodeRepos();
  }

  /** Opens the native folder picker and imports the chosen directory — undefined when cancelled or
   *  the folder wasn't a usable repository (the dialog itself surfaces the rejection). */
  async function importRepoViaDialog(): Promise<RepoSummary | undefined> {
    const chosen = await control.filesChooseFolder('Import repository…');
    if (chosen.canceled || !chosen.path) return undefined;
    const repo = await control.codeWorkspaceImportRepo(chosen.path);
    upsertRecord(repo);
    return repo;
  }

  async function renameCodeRepo(id: string, name: string): Promise<void> {
    const repo = await control.codeWorkspaceRenameRepo(id, name);
    const idx = state.records.findIndex((r) => r.id === id);
    if (idx >= 0) state.records[idx] = repo;
  }

  /** Optimistic: the new order shows at once in ade's tab strip and the Git panel (both read
   *  `records`); a rejected save re-reads the persisted order, then rethrows. */
  async function reorderCodeRepos(fromId: string, toId: string): Promise<void> {
    const ids = moveId(
      state.records.map((r) => r.id),
      fromId,
      toId,
    );
    const byId = new Map(state.records.map((r) => [r.id, r]));
    state.records = ids.flatMap((id) => byId.get(id) ?? []);
    try {
      state.records = await control.codeWorkspaceReorderRepos(ids);
    } catch (err) {
      await hydrateCodeRepos();
      throw err;
    }
  }

  // The Go side already dropped this repo's own tab rows in the same transaction (CodeReposRepo.Remove)
  // — this is the frontend half of that: the workspace's own in-memory tabs (and its file-tree/
  // search/quick-open caches, C13-3) would otherwise point at a repository that no longer exists.
  // closeRepoWorkspace is a no-op when the workspace was never open in the first place, but still
  // drops those caches unconditionally (state/workspace.ts), so nothing further is needed here.
  async function removeCodeRepo(id: string): Promise<void> {
    await control.codeWorkspaceRemoveRepo(id);
    state.records = state.records.filter((r) => r.id !== id);
    workspaceStore.closeRepoWorkspace(id);
  }

  /** P84 §4.5: exported under a name that says what it matches on — the same lookup
   *  openRepoAtPath uses below, reused by worktrees.ts's switchToWorktree to resolve the record its
   *  own import just created. */
  function codeRepoRecordForPath(path: string): RepoSummary | undefined {
    const target = canonicalPath(path);
    return state.records.find(
      (r) => canonicalPath(r.root) === target || canonicalPath(r.repoId) === target,
    );
  }

  /** P82: "switch to this worktree". A worktree is its own repository root (gitclient.Identify's
   *  RepoID is the worktree root), so switching to one is opening its own workspace — the same
   *  premise WorktreeList.vue's own switch rests on, not a second worktree-switching path. Imports
   *  it first when this app has no row for that root yet. */
  async function openRepoAtPath(path: string): Promise<void> {
    const existing = codeRepoRecordForPath(path);
    if (existing) {
      workspaceStore.openRepoWorkspace(existing.id);
      return;
    }
    try {
      const imported = await control.codeWorkspaceImportRepo(path);
      upsertRecord(imported);
      workspaceStore.openRepoWorkspace(imported.id);
    } catch (err) {
      // Another window imported this root between the lookup above and this call — re-read the list
      // and use the row that now exists. Anything else propagates to the caller's own error surface.
      if ((err as { code?: string }).code !== 'E_ALREADY_IMPORTED') throw err;
      await hydrateCodeRepos();
      const row = codeRepoRecordForPath(path);
      if (!row) throw err;
      workspaceStore.openRepoWorkspace(row.id);
    }
  }

  return {
    ...toRefs(state),
    codeRepoRecord,
    hydrateCodeRepos,
    initCodeRepos,
    importRepoViaDialog,
    renameCodeRepo,
    reorderCodeRepos,
    removeCodeRepo,
    codeRepoRecordForPath,
    openRepoAtPath,
  };
});
