# v0.2.15

First phase `P343` (highest in `docs/HISTORY.md` is `P342`). Branch `chapter/v0.2.15`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P343 | Keep commit detail panel open when opening a diff. Bug: in git UI commit history view, opening a file diff from a commit makes the commit detail panel disappear. Panel stays visible. Likely code: `apps/kira-space/frontend/src/state/repoTabs.ts` (`openRepoCommitDiffTab`), `packages/git-ui`. Add UI-spec coverage only if logic warrants; no over-testing. | Done |
| P344 | macOS traffic-light window buttons differ between dev server and released bundled app; released buttons are smaller. Make dev render identical to released app. Investigate window chrome config: titlebar style, button position/size, dev vs production build differences. | Todo |
| P345 | Close chapter v0.2.15 (fold per `CLAUDE.md`). | Todo |

## Results

### P343

Root cause: hidden graph tab (`v-show`) reads 0x0; `App.vue` breakpoint went `overlay`, then click-outside closed the detail pane. Fix in `packages/git-ui/src/App.vue`: `syncBreakpoint` and overlay click-outside skip while `!graphVisible`; `watch(graphVisible)` resyncs on show. One UI spec in `repo-graph-keep-state.spec.ts` (fails without fix, passes with). `trackErrors` now ignores the benign `ResizeObserver loop` notice, a pre-existing flake in the close-workspace spec. Full `test:ui:space`: 675 passed, 2 load-flaky (`copy-coverage`, `graph-blank-rows`) pass alone with and without the fix.
