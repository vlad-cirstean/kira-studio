import type { RepoSummary } from '@shared/domain/repo';
import { reactive } from 'vue';
import { control } from '../bridge/control';
import { closeRepoWorkspace, openRepoWorkspace } from './workspace';

// C5 §3.4: the repo list store, ConnectionsRepo's own shape for a repository entry — hydrate,
// import, rename, remove. No connect/disconnect lifecycle (a repository is a path, not a live
// session, D11) and no secret-storage concept (D1's own "nothing secret, nothing credential-
// shaped").
export const codeReposState = reactive({
  records: [] as RepoSummary[],
});

export function codeRepoRecord(id: string | null | undefined): RepoSummary | undefined {
  if (!id) return undefined;
  return codeReposState.records.find((r) => r.id === id);
}

export async function hydrateCodeRepos(): Promise<void> {
  codeReposState.records = await control.codeWorkspaceListRepos();
}

/** Opens the native folder picker and imports the chosen directory — undefined when cancelled or
 *  the folder wasn't a usable repository (the dialog itself surfaces the rejection). */
export async function importRepoViaDialog(): Promise<RepoSummary | undefined> {
  const chosen = await control.filesChooseFolder('Import repository…');
  if (chosen.canceled || !chosen.path) return undefined;
  const repo = await control.codeWorkspaceImportRepo(chosen.path);
  codeReposState.records = [...codeReposState.records, repo];
  return repo;
}

export async function renameCodeRepo(id: string, name: string): Promise<void> {
  const repo = await control.codeWorkspaceRenameRepo(id, name);
  const idx = codeReposState.records.findIndex((r) => r.id === id);
  if (idx >= 0) codeReposState.records[idx] = repo;
}

// The Go side already dropped this repo's own tab rows in the same transaction (CodeReposRepo.Remove)
// — this is the frontend half of that: the workspace's own in-memory tabs (and its file-tree/
// search/quick-open caches, C13-3) would otherwise point at a repository that no longer exists.
// closeRepoWorkspace is a no-op when the workspace was never open in the first place, but still
// drops those caches unconditionally (state/workspace.ts), so nothing further is needed here.
export async function removeCodeRepo(id: string): Promise<void> {
  await control.codeWorkspaceRemoveRepo(id);
  codeReposState.records = codeReposState.records.filter((r) => r.id !== id);
  closeRepoWorkspace(id);
}

/** P82: canonicalized the way gitpath.CleanNFC canonicalizes a repository root
 *  (internal/gitpath/gitpath.go:46) — `git worktree list` reports paths verbatim, while
 *  RepoSummary.root/.repoId come back NFC-normalized from gitclient.Identify. Exported (P83 §5.1)
 *  so state/terminals.ts's terminalCountAtPath and openTerminalSession compare cwd the same way,
 *  instead of copying this logic a second time. */
export function canonicalPath(p: string): string {
  return p.normalize('NFC').replace(/[/\\]+$/, '');
}

function recordForRoot(path: string): RepoSummary | undefined {
  const target = canonicalPath(path);
  return codeReposState.records.find(
    (r) => canonicalPath(r.root) === target || canonicalPath(r.repoId) === target,
  );
}

/** P82: "switch to this worktree". A worktree is its own repository root (gitclient.Identify's
 *  RepoID is the worktree root), so switching to one is opening its own workspace — the same
 *  premise WorktreeList.vue's own switch rests on, not a second worktree-switching path. Imports
 *  it first when this app has no row for that root yet. */
export async function openRepoAtPath(path: string): Promise<void> {
  const existing = recordForRoot(path);
  if (existing) {
    openRepoWorkspace(existing.id);
    return;
  }
  try {
    const imported = await control.codeWorkspaceImportRepo(path);
    codeReposState.records = [...codeReposState.records, imported];
    openRepoWorkspace(imported.id);
  } catch (err) {
    // Another window imported this root between the lookup above and this call — re-read the list
    // and use the row that now exists. Anything else propagates to the caller's own error surface.
    if ((err as { code?: string }).code !== 'E_ALREADY_IMPORTED') throw err;
    await hydrateCodeRepos();
    const row = recordForRoot(path);
    if (!row) throw err;
    openRepoWorkspace(row.id);
  }
}
