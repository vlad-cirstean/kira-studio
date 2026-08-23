import type { GitStatus } from "@kira-version/ipc";
import type { Scenario } from "./types.ts";

/**
 * Repurposed from a P0 stub (see dirty.ts/conflicted.ts, still stubs) into a real, if narrow,
 * exercise of `repo.open`'s `gitUnavailable` branch. Fetch/push auth-failure handling itself —
 * what this scenario's name actually promises — is still P6/P7 territory with no UI to show
 * yet; "git binary missing" is the one `RepoOpenResult` variant no other scenario reaches, and
 * it is real and testable today, so this scenario exercises that instead of staying a stub.
 */
const git: GitStatus = {
  kind: "notFound",
  probed: ["/usr/bin/git", "/usr/local/bin/git", "git"],
};

export const authFailure: Scenario = {
  name: "authFailure",
  git,
  repoOpen: { kind: "gitUnavailable", git },
  commits: [],
};
