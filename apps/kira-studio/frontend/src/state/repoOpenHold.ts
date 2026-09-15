import type { Transport } from '@kira/git-ipc';

/**
 * The per-connection `repo.open` hold `blameAnnotation.ts`'s `blame.line` calls need — moved out
 * of `views/repo/blameAnnotation.ts` (Group 3, P69 review) so `repo/git/transport.ts`'s own
 * `disposeGitTransport` can clear an entry on its own dispose path: `repo/` must not import
 * `views/` directly (C5 §2's restricted-imports rule), but both may import `state/`.
 *
 * §4.2: `blame.line` needs this connection to already hold the repo. `repo.open` is idempotent
 * per (connection, repoId) and git-ui never calls `repo.close`, so the hold lives as long as the
 * transport — one memoised promise per gitRepoId, module-level so two open file tabs on the same
 * repository share it. Mirrors `reviewDecorations.ts`'s own `baseMemo` (C12-7/C13-14): only a
 * SUCCESSFUL resolution stays cached, so a transient failure can retry on the next attach rather
 * than replay the same rejection forever.
 */
const repoOpenMemo = new Map<string, Promise<void>>();

export function ensureRepoOpen(transport: Transport, gitRepoId: string): Promise<void> {
  let cached = repoOpenMemo.get(gitRepoId);
  if (!cached) {
    cached = transport
      .request('repo.open', { path: gitRepoId }, undefined)
      .then(() => undefined)
      .catch((err: unknown) => {
        repoOpenMemo.delete(gitRepoId);
        console.error('repoOpenHold: repo.open failed', err);
        throw err;
      });
    repoOpenMemo.set(gitRepoId, cached);
  }
  return cached;
}

/**
 * `disposeGitTransport`'s own cleanup hook (`repo/git/transport.ts`) — a `repo.open` hold is
 * scoped to one `gitsession.Conn` (one per shared client per repo workspace), but this memo used
 * to outlive it: closing a repo workspace and reopening it creates a NEW `Conn`, yet a stale
 * resolved entry here made `ensureRepoOpen` short-circuit without ever calling `repo.open` on it,
 * so every `blame.line` call then failed with `E_REPO_NOT_HELD` for that file. Call this
 * alongside `localEmittersByCodeRepoId.delete(...)` there.
 */
export function forgetRepoOpen(gitRepoId: string): void {
  repoOpenMemo.delete(gitRepoId);
}
