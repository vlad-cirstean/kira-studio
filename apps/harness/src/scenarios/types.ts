import type { CommitRecord } from "@kira-version/core";
import type { GitStatus, RepoCandidate, RepoOpenResult } from "@kira-version/ipc";

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
  /** `repo.list`'s answer for this scenario (P4 W13) — absent (equivalent to `[]`) for every
   *  scenario that does not care about the repo picker's candidate list. Real git-repo discovery
   *  is not modelled; a scenario simply states the candidates it wants `RepoPicker.vue` to show,
   *  independent of `repoOpen`'s own "ignores `path`, one repo per scenario" behaviour (its own
   *  doc comment) — clicking a candidate here still opens *this* scenario's one repo, which is
   *  enough to exercise the picker's own open/close/emit flow. */
  readonly candidates?: readonly RepoCandidate[];
}
