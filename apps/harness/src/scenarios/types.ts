import type { CommitRecord } from "@kira-version/core";
import type { GitStatus, RepoOpenResult } from "@kira-version/ipc";

/**
 * A named, deep-linkable state the harness can render (`?scenario=<name>`). P3 W14 grows this
 * from P0's flat `{repoId, toplevel, gitDir, isBare, commitCount}` shape into real,
 * contract-shaped data `mockBridge.ts` can serve without inventing anything at request time.
 */
export interface Scenario {
  readonly name: string;
  /** `app.init`'s own git status for this scenario — independent of `repoOpen`'s: a host can
   *  have a working git and still fail to open one particular repo, or (this file's
   *  `authFailure`) have no working git at all, in which case both fields carry the same
   *  status. */
  readonly git: GitStatus;
  /** What `repo.open` returns, regardless of the `path` the UI actually passes — the mock
   *  bridge has exactly one repo per scenario, so there is nothing to branch on. */
  readonly repoOpen: RepoOpenResult;
  /** Newest-first, exactly as `git log` and `CommitStore.append`/`appendPage` both expect.
   *  Empty for a scenario whose `repoOpen` never succeeds. */
  readonly commits: readonly CommitRecord[];
}
