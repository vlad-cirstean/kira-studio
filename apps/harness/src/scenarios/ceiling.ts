import { chain } from "./topology.ts";
import type { Scenario } from "./types.ts";

/** `tests/perf/graphUi.ts`'s (W15) own ceiling — the largest repository the app is meant to
 *  handle at all, not a dev-loop scenario (`hugeRepo` stays 20,000 for that). */
const COMMIT_COUNT = 100_000;

let cached: Scenario | undefined;

/**
 * Built lazily and memoized, not a precomputed constant, and deliberately **not** registered in
 * `index.ts`'s `SCENARIOS` (P4 W12): 100,000 `chain()` records cost real seconds to build, and
 * nothing should pay that cost by importing this module or by an accidental `?scenario=ceiling`
 * — only `loadScenario("ceiling")`'s own hidden-scenario branch reaches this function, and only
 * `tests/perf/graphUi.ts` is expected to ever call it.
 */
export function ceiling(): Scenario {
  if (!cached) {
    cached = {
      name: "ceiling",
      git: { kind: "ok", path: "/usr/bin/git", version: "2.43.0" },
      repoOpen: {
        kind: "ok",
        repo: {
          repoId: "/repos/ceiling",
          root: "/repos/ceiling",
          gitDir: "/repos/ceiling/.git",
          commonDir: "/repos/ceiling/.git",
          isBare: false,
          isLinkedWorktree: false,
          head: { kind: "branch", name: "main" },
        },
      },
      commits: chain(COMMIT_COUNT, "ceiling"),
    };
  }
  return cached;
}
