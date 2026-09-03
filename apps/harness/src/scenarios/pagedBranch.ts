import type { CommitRecord, DecorationRef } from "@kira-version/core";
import { commitByName } from "./topology.ts";
import type { Scenario } from "./types.ts";

/**
 * `docs/plans/P4.md` W13's "screenshot after a Load more" scenario: the one visual bug a
 * functional test cannot see is a lane discontinuity at a page boundary — the layout worker's
 * open-lane frontier not carrying correctly from one `graph.stream` chunk to the next. Neither
 * existing large scenario can exercise it: `badges` fits in a single page (nothing to load more
 * of); `hugeRepo`/`ceiling` are a pure `chain()` with no branch to discontinue. This scenario is
 * a single long-lived side branch, deliberately positioned so its own row-span straddles the
 * `kiraVersion.graph.pageSize` default (5,000) boundary — row 4999 is still page one, row 5000 is
 * not — so a `graph.spec.ts` screenshot taken before vs. after one `Load more` click brackets
 * exactly the seam a real regression would break.
 *
 * The trunk is 6,000 commits and the branch 400, both built with `commitByName()` (not
 * `topology()`'s spec-string parser, which does not scale to thousands of entries — see
 * `hugeRepo.ts`'s own comment on the same trade-off). The branch forks off `trunk-1200` and is
 * never merged back (an open lane, same shape as `badges`' own "unmerged-tip"), so both the fork
 * point itself and a mid-branch cut are exercised: only `branch-399` through `branch-199`
 * (rows 4799-4999) are on page one — the older half of the branch, and the trunk commits below
 * the fork, only arrive once `Load more` fetches page two.
 */
const TRUNK_COUNT = 6000;
const BRANCH_COUNT = 400;
/** `trunk-FORK_INDEX` is the branch's parent. Chosen so the branch's row-span (below) covers row
 *  4999/5000 with headroom on both sides, not just brushes it. */
const FORK_INDEX = 1200;

function buildCommits(): CommitRecord[] {
  // A single shared, monotonic `index` sequence across both chains, oldest-built first — see
  // `commitByName()`'s own doc comment on why this matters (it only feeds the timestamp, but a
  // consistent EPOCH-relative order is still the least surprising choice for two chains that
  // will be interleaved into one array below).
  let index = 0;

  // Rows 6399 down to 5199 once reversed: trunk-0 (root) through trunk-FORK_INDEX.
  const trunkBase: CommitRecord[] = [];
  for (let i = 0; i <= FORK_INDEX; i++) {
    const parents = i > 0 ? [`trunk-${i - 1}`] : [];
    trunkBase.push(commitByName(`trunk-${i}`, parents, index++));
  }

  // Rows 5198 down to 4799 once reversed: branch-0 (forks off trunk-FORK_INDEX) through
  // branch-(BRANCH_COUNT - 1), the branch's own tip.
  const branch: CommitRecord[] = [];
  for (let i = 0; i < BRANCH_COUNT; i++) {
    const parents = i === 0 ? [`trunk-${FORK_INDEX}`] : [`branch-${i - 1}`];
    branch.push(commitByName(`branch-${i}`, parents, index++));
  }

  // Rows 4798 down to 0 once reversed: trunk-(FORK_INDEX + 1) through trunk-(TRUNK_COUNT - 1),
  // the trunk's own head — the trunk carries on past the fork exactly as if the branch had never
  // been cut from it.
  const trunkHead: CommitRecord[] = [];
  for (let i = FORK_INDEX + 1; i < TRUNK_COUNT; i++) {
    trunkHead.push(commitByName(`trunk-${i}`, [`trunk-${i - 1}`], index++));
  }

  // Built oldest-first above (ascending index); `topology()`'s own convention, and what
  // `CommitRecord.parents` needs (a parent's own record must already exist by name when its
  // child is built). Concatenated in fork order — base, then branch, then head — and reversed
  // once at the end into the newest-first order `CommitStore` expects, which is what actually
  // produces the row layout described above.
  return [...trunkBase, ...branch, ...trunkHead].reverse();
}

const DECORATIONS: Readonly<Record<string, readonly DecorationRef[]>> = {
  [`trunk-${TRUNK_COUNT - 1}`]: [{ kind: "branch", name: "main", isHead: true }],
  [`branch-${BRANCH_COUNT - 1}`]: [{ kind: "branch", name: "feature/long-lived", isHead: false }],
};

function decorate(records: readonly CommitRecord[]): CommitRecord[] {
  return records.map((record) => {
    const decoration = DECORATIONS[record.subject];
    return decoration ? { ...record, decoration } : record;
  });
}

// A function, not a top-level value — `HIDDEN_SCENARIOS`' own convention (`ceiling.ts`'s doc
// comment): importing `scenarios/index.ts` must never pay this scenario's own 6,400-commit build
// cost, only calling `loadScenario("pagedBranch")` should.
export function pagedBranch(): Scenario {
  return {
    name: "pagedBranch",
    git: { kind: "ok", path: "/usr/bin/git", version: "2.43.0" },
    repoOpen: {
      kind: "ok",
      repo: {
        repoId: "/repos/paged-branch",
        root: "/repos/paged-branch",
        gitDir: "/repos/paged-branch/.git",
        commonDir: "/repos/paged-branch/.git",
        isBare: false,
        isLinkedWorktree: false,
        head: { kind: "branch", name: "main" },
      },
    },
    commits: decorate(buildCommits()),
  };
}
