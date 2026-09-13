import type { RepoSummary } from '@shared/domain/repo';
import { reactive } from 'vue';
import { control } from '../bridge/control';

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

export async function removeCodeRepo(id: string): Promise<void> {
  await control.codeWorkspaceRemoveRepo(id);
  codeReposState.records = codeReposState.records.filter((r) => r.id !== id);
}
