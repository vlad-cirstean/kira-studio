// P94 pass 3 §4.3: RepoFileView.vue's mount() read its file two different ways (worktree vs a
// revision-pinned tab) with near-duplicate try/catch/error-message plumbing around each — lifted
// out as one pure(ish) async call so mount() itself only branches on the result.

import { control } from '../../bridge/control';
import { gitRepoIdFor } from '../../repo/git/hostHandlers';
import { gitTransportFor } from '../../repo/git/transport';

export type FileContentResult =
  | { kind: 'found'; text: string }
  | { kind: 'missing' | 'binary' | 'tooLarge' }
  | { kind: 'error'; message: string };

/** Reads `path` from the worktree (`rev === null`) or, for a revision-pinned tab, via the git
 *  transport's `file.read` (P74 §7.3 — the same request RepoDiffView.vue's own commit-diff sides
 *  use, never the worktree file). Never throws — a read failure or a missing git repo both come
 *  back as `{ kind: 'error' }`, `mount()`'s own contract for every failure mode it renders. */
export async function loadFileContent(
  repoId: string,
  path: string,
  rev: string | null,
): Promise<FileContentResult> {
  if (rev === null) {
    try {
      const content = await control.codeWorkspaceReadFile(repoId, path);
      return content.kind === 'found'
        ? { kind: 'found', text: content.text }
        : { kind: content.kind };
    } catch (err) {
      return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  }

  const gitRepoId = gitRepoIdFor(repoId);
  if (!gitRepoId) return { kind: 'error', message: 'This repository is not open.' };
  const transport = gitTransportFor(repoId);
  try {
    const result = await transport.request('file.read', { repoId: gitRepoId, rev, path });
    return result.kind === 'found'
      ? { kind: 'found', text: result.content }
      : { kind: result.kind };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  } finally {
    transport.dispose();
  }
}
