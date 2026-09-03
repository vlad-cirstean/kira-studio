import { topology } from "./topology.ts";
import type { Scenario } from "./types.ts";

const commits = topology([
  "root",
  "feature-a:root",
  "feature-b:root",
  "merge:feature-a,feature-b",
  "tip:merge",
]);

export const clean: Scenario = {
  name: "clean",
  git: { kind: "ok", path: "/usr/bin/git", version: "2.43.0" },
  repoOpen: {
    kind: "ok",
    repo: {
      repoId: "/repos/clean",
      root: "/repos/clean",
      gitDir: "/repos/clean/.git",
      commonDir: "/repos/clean/.git",
      isBare: false,
      isLinkedWorktree: false,
      head: { kind: "branch", name: "main" },
    },
  },
  commits,
  // A second entry so the repo picker (P4 W13) has something to click besides the active repo's
  // own already-checkmarked row — `repo.open` ignores which one, per this file's own type doc.
  candidates: [
    { path: "/repos/clean", label: "clean" },
    { path: "/repos/other", label: "other-repo" },
  ],
};
