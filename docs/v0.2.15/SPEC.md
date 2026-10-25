# v0.2.15

First phase `P343` (highest in `docs/HISTORY.md` is `P342`). Branch `chapter/v0.2.15`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P343 | Keep commit detail panel open when opening a diff. Bug: in git UI commit history view, opening a file diff from a commit makes the commit detail panel disappear. Panel stays visible. Likely code: `apps/kira-space/frontend/src/state/repoTabs.ts` (`openRepoCommitDiffTab`), `packages/git-ui`. Add UI-spec coverage only if logic warrants; no over-testing. | Done |
| P344 | macOS traffic-light window buttons differ between dev server and released bundled app; released buttons are smaller. Make dev render identical to released app. (Direction changed in P345: the larger buttons are correct.) Investigate window chrome config: titlebar style, button position/size, dev vs production build differences. | Done (superseded by P345) |
| P345 | Rework macOS traffic-light fix. `UIDesignRequiresCompatibility` had no effect on user's Mac; dev buttons still larger than released. Re-investigate (dev may run raw binary, not bundle, so plist keys are not read; SDK linking; Wails titlebar options). Revert ineffective plist key and S14/A6 checks if confirmed useless. Fix for real. Update docs. | Done |
| P346 | Git graph: branches do not show where they fork from. Last few branches start from main but render as starting from nowhere. Intended: only where two branches forking from the same commit have interleaved/overlapping commits (time order), group them topologically at that locality. NOT topological ordering for the whole graph. Fork point and edge to parent must render. | Done |
| P347 | Close chapter v0.2.15 (hand-fold per `CLAUDE.md`, rewrite the existing `<!-- chapter v0.2.15 -->` block in `docs/HISTORY.md`). Do NOT run until user explicitly says to close. | Done |

## Results

### P343

Root cause: hidden graph tab (`v-show`) reads 0x0; `App.vue` breakpoint went `overlay`, then click-outside closed the detail pane. Fix in `packages/git-ui/src/App.vue`: `syncBreakpoint` and overlay click-outside skip while `!graphVisible`; `watch(graphVisible)` resyncs on show. One UI spec in `repo-graph-keep-state.spec.ts` (fails without fix, passes with). `trackErrors` now ignores the benign `ResizeObserver loop` notice, a pre-existing flake in the close-workspace spec. Two pre-existing load flakes fixed: `graph-blank-rows` checked grid layout right after `clock.resume()` before the paused resize rAF ran (now polls); `copy-coverage` review window scanned while async content landed before or after the locale switch (content now settled first; `src` folder and one-shot announcement allowed). Full `test:ui:space`: 677 passed.

### P344

Root cause: not window config. One `Options` path builds both windows. Difference is linked SDK: release runner `macos-15` links 15.5 SDK, dev on user's Mac links 26. macOS 26 gives 26-SDK binaries larger traffic lights. Fix: `UIDesignRequiresCompatibility=true` in all four Info plists (Studio and Space, release and dev). Guard: `verify-packaging.sh` S14 (source plists) and A6 (built bundles). Docs: `PACKAGING.md`, `ARCHITECTURE.md` (stale title-bar line, SDK note, Known open items entry). Checks run: `verify:packaging`, gendoctypes `--check`, xmllint on plists. shellcheck not installed here.

macOS behaviour unverified here (Linux session). User must confirm on a Mac: (1) SDK split, `xcrun --show-sdk-version` and `vtool -show-build` on released and dev binaries; (2) `bun run dev:studio` and `bun run dev:space` traffic lights match released app side by side, 78px inset clears them. If key has no effect, fallback is pinning both builds to one SDK (declined in plan); raise with user first.

User result on real Mac: plist-key fix did not fix issue; dev buttons still differ from released. Superseded by P345.

Direction change (P345): the larger macOS 26 buttons are the correct ones, not the released app's smaller ones. The plist-key fix is reverted.

### P345

Direction changes from user, final: larger macOS 26 buttons are correct; drop the SDK stamp; minimum macOS is 26.0 (14 and 15 dropped on purpose). Earlier iterations (stamp 15.5, then stamp 26.0 via `vtool`) were removed.

Root cause: AppKit picks window chrome by the executable's linked SDK. Released binaries read `sdk 15.5` (runner `macos-15`, smaller buttons); dev links the user's Xcode SDK (26+, larger). Window code is identical in both builds. `UIDesignRequiresCompatibility` (P344) did not help; reverted from four plists.

Fix, Electron model: no stamp; SDK is whatever the building Xcode provides. Floor 26.0: `LSMinimumSystemVersion` `26.0.0` in four plists, `install.sh` preflight, README, Space README, site copy, ARCHITECTURE, PACKAGING checklist. Both darwin Taskfiles set `-mmacosx-version-min` and `MACOSX_DEPLOYMENT_TARGET` from `MACOS_MIN`, resolved from `xcrun --show-sdk-version` (26.0 with SDK 26+, else 14.0), so the SDK 15.5 runner, which cannot target 26, keeps building. Guards: S14 checks `LSMinimumSystemVersion` is 26.0.0 in the four plists; A6 fails when a bundle links SDK 26+ without minos 26.0 and only notes a warning while the SDK is below 26. Runners: user applied the patches in `f8175023a` (`ci: build on macos-26 runners`); `release.yml`, `pr.yml`, `cache-warm.yml` run `macos-26`, so release links SDK 26 like dev. Pending patch files and the Known open items entry removed. Docs: `PACKAGING.md`, `ARCHITECTURE.md`. Checks run: `verify:packaging`, gendoctypes `--check`, xmllint, YAML parse, pre-commit hook. shellcheck not installed here.

macOS behaviour unverified from Linux. User moved dev and runners to SDK 26 and confirmed the buttons themselves.

### P346

Root cause: P93 made display order branch-major for the whole graph. `--topo-order` plus per-tip buckets put every non-HEAD branch below all loaded main rows; `projectLayoutInput` dropped each upward link and `planForkStub` drew a dashed stub from nowhere. Plan: `plans/P346.md`.

Fix:
- Backend walks `git log --date-order` (log walk, tail scan, ranged review walk share `logBaseArgs`).
- New `packages/git-core/src/graph/displayOrder.ts` (`localTopoOrder`, `flatqueue` 3.1.0 min-heap, ISC, zero dependencies, released 2026-06-05): store order kept; only sibling chains from one fork commit that interleave become contiguous. Heap is unbounded (a parked row can re-enter the heap more than twice), not fixed-capacity as the plan sketched.
- `rowPlan.ts`: `assignRowRanks` returns per-row rank; `collapseRuns` contracts each maximal run of one group; `projectLayoutInput` asserts no upward link. Removed `forkParentOf`, `forkStub`, `planForkStub`, `EdgePathPlan.dashed`, the stub click and `hitTest.ts`. Unexported two now-internal symbols for knip.
- `docs/ARCHITECTURE.md` graph block updated.

Tests: unit `displayOrder.spec.ts` (identity, fork, merged branch, nested siblings, paging, 300-DAG property check), updated `rowPlan.spec.ts` (per-run collapse) and `rowSvg.spec.ts`; flow `TestGraphForkInterleaveDateOrder`; UI spec for the same scenario in `repo-graph-branch-order.spec.ts` with `buildForkInterleaveChunk`/`buildForkInterleaveRefsList`; rewrote P93 expectations in `repo-graph-branch-order`, `repo-workspace`, `repo-graph-change-request-badge`. `graph-blank-rows.spec.ts` failed once on the full run: it scrolled to the list end for a collapsed row and groups no longer cluster there, so it now scrolls from the top until one renders (`scrollToCollapsedRow`).

Perf (`KIRA_GIT_PERF=1`, 20000 commits, first chunk): `--topo-order` 249.99ms, `--date-order` 245.78ms. No regression.

Results: bun tests git-core and git-ui 460 pass; typecheck, lint, `lint:dead` clean; Go gitclient, gitsearch, gitflow, reviewflow pass; full `test:ui:space` 677 pass after the one fix above (graph-blank-rows 4/4 re-run); git-module visual spec 7/7, no baseline change.

Known: display order is not final on arrival. A later page can join two chains and move rows next to the loaded boundary; the grid repaints on every plan publish.

### P347

User asked to close. Hand-folded into `docs/HISTORY.md`, rewriting the stale v0.2.15 block (3 phases, wrong content). `docs/v0.2.15/` removed. PR #10 retitled to cover all 5 phases.
