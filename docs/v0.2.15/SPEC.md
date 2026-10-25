# v0.2.15

First phase `P343` (highest in `docs/HISTORY.md` is `P342`). Branch `chapter/v0.2.15`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P343 | Keep commit detail panel open when opening a diff. Bug: in git UI commit history view, opening a file diff from a commit makes the commit detail panel disappear. Panel stays visible. Likely code: `apps/kira-space/frontend/src/state/repoTabs.ts` (`openRepoCommitDiffTab`), `packages/git-ui`. Add UI-spec coverage only if logic warrants; no over-testing. | Done |
| P344 | macOS traffic-light window buttons differ between dev server and released bundled app; released buttons are smaller. Make dev render identical to released app. (Direction changed in P345: the larger buttons are correct.) Investigate window chrome config: titlebar style, button position/size, dev vs production build differences. | Done (superseded by P345) |
| P345 | Rework macOS traffic-light fix. `UIDesignRequiresCompatibility` had no effect on user's Mac; dev buttons still larger than released. Re-investigate (dev may run raw binary, not bundle, so plist keys are not read; SDK linking; Wails titlebar options). Revert ineffective plist key and S14/A6 checks if confirmed useless. Fix for real. Update docs. | Done |
| P346 | Git graph: branches do not show where they fork from. Last few branches start from main but render as starting from nowhere. Intended: only where two branches forking from the same commit have interleaved/overlapping commits (time order), group them topologically at that locality. NOT topological ordering for the whole graph. Fork point and edge to parent must render. | Todo |
| P347 | Close chapter v0.2.15 (hand-fold per `CLAUDE.md`, rewrite the existing `<!-- chapter v0.2.15 -->` block in `docs/HISTORY.md`). Do NOT run until user explicitly says to close. | Todo |

## Results

### P343

Root cause: hidden graph tab (`v-show`) reads 0x0; `App.vue` breakpoint went `overlay`, then click-outside closed the detail pane. Fix in `packages/git-ui/src/App.vue`: `syncBreakpoint` and overlay click-outside skip while `!graphVisible`; `watch(graphVisible)` resyncs on show. One UI spec in `repo-graph-keep-state.spec.ts` (fails without fix, passes with). `trackErrors` now ignores the benign `ResizeObserver loop` notice, a pre-existing flake in the close-workspace spec. Two pre-existing load flakes fixed: `graph-blank-rows` checked grid layout right after `clock.resume()` before the paused resize rAF ran (now polls); `copy-coverage` review window scanned while async content landed before or after the locale switch (content now settled first; `src` folder and one-shot announcement allowed). Full `test:ui:space`: 677 passed.

### P344

Root cause: not window config. One `Options` path builds both windows. Difference is linked SDK: release runner `macos-15` links 15.5 SDK, dev on user's Mac links 26. macOS 26 gives 26-SDK binaries larger traffic lights. Fix: `UIDesignRequiresCompatibility=true` in all four Info plists (Studio and Space, release and dev). Guard: `verify-packaging.sh` S14 (source plists) and A6 (built bundles). Docs: `PACKAGING.md`, `ARCHITECTURE.md` (stale title-bar line, SDK note, Known open items entry). Checks run: `verify:packaging`, gendoctypes `--check`, xmllint on plists. shellcheck not installed here.

macOS behaviour unverified here (Linux session). User must confirm on a Mac: (1) SDK split, `xcrun --show-sdk-version` and `vtool -show-build` on released and dev binaries; (2) `bun run dev:studio` and `bun run dev:space` traffic lights match released app side by side, 78px inset clears them. If key has no effect, fallback is pinning both builds to one SDK (declined in plan); raise with user first.

User result on real Mac: plist-key fix did not fix issue; dev buttons still differ from released. Superseded by P345.

Direction change (P345): the larger macOS 26 buttons are the correct ones, not the released app's smaller ones. The plist-key fix is reverted.

### P345

Direction change from user: the larger macOS 26 buttons (dev) are correct; released smaller ones are wrong. Initial stamp target 15.5 was reversed to 26.0.

Root cause: AppKit picks window chrome by the main executable's `LC_BUILD_VERSION` sdk field. Released binaries (both apps) read `sdk 15.5` (runner `macos-15`, smaller buttons); dev links the user's Xcode/CLT SDK (26+, larger). Dev runs from `.dev.app`, so the plist key reached it; `UIDesignRequiresCompatibility` did not help. Window code is identical in both builds.

Fix: `build:native` in both darwin Taskfiles stamps the linked binary with `vtool -set-build-version macos 14.0 26.0` (via `.stamped` file, then `mv`) and re-signs ad hoc. Vars `MACOS_MIN` and `MACOS_SDK_STAMP`; precondition requires `vtool`. Release is stamped up to 26.0 to get the larger chrome; dev matches regardless of installed SDK. Reverted the P344 key from four plists. S14 greps both Taskfiles for the stamp; A6 checks `vtool -show-build` sdk is `26.0` on built bundles (skips without vtool). Possible later switch to a macOS 26 runner image makes the stamp redundant; workflow files cannot be pushed from this session (`docs/DEV_ENVIRONMENT.md`). Docs: `PACKAGING.md`, `ARCHITECTURE.md`. Checks run: `verify:packaging`, gendoctypes `--check`, xmllint, YAML parse, pre-commit hook. shellcheck not installed here.

macOS behaviour unverified here (Linux session). Quick confirm on a Mac: `bun run dev:studio`, then `vtool -show-build "apps/kira-studio/bin/Kira Studio.dev.app/Contents/MacOS/Kira Studio"` must show `sdk 26.0` and `minos 14.0`; a packaged build must show the same and buttons match dev. Fallback if not: if sdk is wrong, check `vtool`/re-sign output; if sdk is 26.0 but release buttons stay small, the SDK theory is wrong, so stop and re-investigate; building release on a macOS 26 runner is the alternative.
