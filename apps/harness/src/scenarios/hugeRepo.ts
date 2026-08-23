import { chain } from "./topology.ts";
import type { Scenario } from "./types.ts";

/** A dev-loop scenario loaded synchronously on every page load, not a perf benchmark — so
 *  20,000, not `tests/perf`'s own 100,000-row ceiling. Large enough that `graph.loadMore`
 *  (the default page size is 5,000, `packages/core/src/settings/schema.ts`) genuinely has a
 *  second and third page to fetch. */
const COMMIT_COUNT = 20_000;

export const hugeRepo: Scenario = {
  name: "hugeRepo",
  git: { kind: "ok", path: "/usr/bin/git", version: "2.43.0" },
  repoOpen: {
    kind: "ok",
    repo: {
      repoId: "/repos/huge",
      root: "/repos/huge",
      gitDir: "/repos/huge/.git",
      commonDir: "/repos/huge/.git",
      isBare: false,
      isLinkedWorktree: false,
      head: { kind: "branch", name: "main" },
    },
  },
  commits: chain(COMMIT_COUNT, "huge"),
};
