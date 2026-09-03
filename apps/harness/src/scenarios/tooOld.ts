import type { GitStatus } from "@kira-version/ipc";
import type { Scenario } from "./types.ts";

/**
 * `GitBlockedPanel.vue`/`gitBlockedCopy.ts` (P4 W10) switch on all three of `GitStatus`'
 * non-`"ok"` kinds; `authFailure` already exercises `notFound`, this exercises `tooOld` — a real
 * git binary found, but older than `kiraVersion.git.path`'s own minimum-version check accepts.
 */
const git: GitStatus = {
  kind: "tooOld",
  path: "/usr/bin/git",
  detected: "2.10.0",
  required: "2.20.0",
  settingId: "kiraVersion.git.path",
};

export const tooOld: Scenario = {
  name: "tooOld",
  git,
  repoOpen: { kind: "gitUnavailable", git },
  commits: [],
};
