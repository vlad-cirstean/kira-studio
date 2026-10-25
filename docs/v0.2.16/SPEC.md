# v0.2.16

First phase `P346` (highest in `docs/HISTORY.md` is `P345`). Branch `chapter/v0.2.16`. Phases run top to bottom. Continues v0.2.15 work that landed after its first close (PR #10 merged early).

| # | Phase | Status |
|---|-------|--------|
| P346 | macOS window chrome rework. v0.2.15 P344 plist key (`UIDesignRequiresCompatibility`) was ineffective; superseded. Larger macOS 26 buttons are correct. Min macOS 26.0, real SDK via `macos-26` runners, no SDK stamp. | Todo |
| P347 | Git graph date order. Branches did not show their fork point. Display order is `--date-order` with local sibling grouping, fork lanes, no fork stubs. | Todo |
| P348 | Close chapter v0.2.16 (hand-fold per `CLAUDE.md`). | Todo |

## Results

### P346

Direction changes from user, final: larger macOS 26 buttons are correct; drop the SDK stamp; minimum macOS is 26.0 (14 and 15 dropped on purpose). Earlier iterations (stamp 15.5, then stamp 26.0 via `vtool`) were removed.

Root cause: AppKit picks window chrome by the executable's linked SDK. Released binaries read `sdk 15.5` (runner `macos-15`, smaller buttons); dev links the user's Xcode SDK (26+, larger). Window code is identical in both builds. `UIDesignRequiresCompatibility` (v0.2.15 P344) did not help; reverted from four plists.

Fix, Electron model: no stamp; SDK is whatever the building Xcode provides. Floor 26.0: `LSMinimumSystemVersion` `26.0.0` in four plists, `install.sh` preflight, README, Space README, site copy, ARCHITECTURE, PACKAGING checklist. Both darwin Taskfiles set `-mmacosx-version-min` and `MACOSX_DEPLOYMENT_TARGET` from `MACOS_MIN`, resolved from `xcrun --show-sdk-version` (26.0 with SDK 26+, else 14.0), so the SDK 15.5 runner, which cannot target 26, keeps building. Guards: S14 checks `LSMinimumSystemVersion` is 26.0.0 in the four plists; A6 fails when a bundle links SDK 26+ without minos 26.0 and only notes a warning while the SDK is below 26. Runners moved to `macos-26` (`release.yml`, `pr.yml`, `cache-warm.yml`), so release and dev link the same SDK class. Docs: `PACKAGING.md`, `ARCHITECTURE.md` (Known open items). Checks run: `verify:packaging`, gendoctypes `--check`, xmllint, YAML parse, pre-commit hook. shellcheck not installed here.

macOS behaviour unverified here (Linux session); runner move confirmed by user, look not yet confirmed on a Mac. Quick confirm on a Mac: dev build `vtool -show-build "apps/kira-studio/bin/Kira Studio.dev.app/Contents/MacOS/Kira Studio"` shows `sdk 26.x` and `minos 26.0` and the buttons are the larger ones. Release builds on `macos-26`; confirm on a released build too. Fallback if dev clang or ld rejects `-mmacosx-version-min=26.0`: set the dev floor back to 14.0 in `MACOS_MIN` and keep the plist floor; if buttons still differ with equal SDKs, re-investigate.

### P347

Root cause: P93 made display order branch-major for the whole graph. `--topo-order` plus per-tip buckets put every non-HEAD branch below all loaded main rows; `projectLayoutInput` dropped each upward link and `planForkStub` drew a dashed stub from nowhere. Plan: `plans/P347.md`.

Fix:
- Backend walks `git log --date-order` (log walk, tail scan, ranged review walk share `logBaseArgs`).
- New `packages/git-core/src/graph/displayOrder.ts` (`localTopoOrder`, `flatqueue` 3.1.0 min-heap, ISC, zero dependencies, released 2026-06-05): store order kept; only sibling chains from one fork commit that interleave become contiguous. Heap is unbounded (a parked row can re-enter the heap more than twice), not fixed-capacity as the plan sketched.
- `rowPlan.ts`: `assignRowRanks` returns per-row rank; `collapseRuns` contracts each maximal run of one group; `projectLayoutInput` asserts no upward link. Removed `forkParentOf`, `forkStub`, `planForkStub`, `EdgePathPlan.dashed`, the stub click and `hitTest.ts`. Unexported two now-internal symbols for knip.
- `docs/ARCHITECTURE.md` graph block updated.

Tests: unit `displayOrder.spec.ts` (identity, fork, merged branch, nested siblings, paging, 300-DAG property check), updated `rowPlan.spec.ts` (per-run collapse) and `rowSvg.spec.ts`; flow `TestGraphForkInterleaveDateOrder`; UI spec for the same scenario in `repo-graph-branch-order.spec.ts` with `buildForkInterleaveChunk`/`buildForkInterleaveRefsList`; rewrote P93 expectations in `repo-graph-branch-order`, `repo-workspace`, `repo-graph-change-request-badge`. `graph-blank-rows.spec.ts` failed once on the full run: it scrolled to the list end for a collapsed row and groups no longer cluster there, so it now scrolls from the top until one renders (`scrollToCollapsedRow`).

Perf (`KIRA_GIT_PERF=1`, 20000 commits, first chunk): `--topo-order` 249.99ms, `--date-order` 245.78ms. No regression.

Results: bun tests git-core and git-ui 460 pass; typecheck, lint, `lint:dead` clean; Go gitclient, gitsearch, gitflow, reviewflow pass; full `test:ui:space` 677 pass after the one fix above (graph-blank-rows 4/4 re-run); git-module visual spec 7/7, no baseline change.

Known: display order is not final on arrival. A later page can join two chains and move rows next to the loaded boundary; the grid repaints on every plan publish.

### P348

Chapter folded by hand into `docs/HISTORY.md`. `docs/v0.2.16/` removed.
