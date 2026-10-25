# v0.2.15

First phase `P343` (highest in `docs/HISTORY.md` is `P342`). Branch `chapter/v0.2.15`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P343 | Keep commit detail panel open when opening a diff. Bug: in git UI commit history view, opening a file diff from a commit makes the commit detail panel disappear. Panel stays visible. Likely code: `apps/kira-space/frontend/src/state/repoTabs.ts` (`openRepoCommitDiffTab`), `packages/git-ui`. Add UI-spec coverage only if logic warrants; no over-testing. | Todo |
| P344 | macOS traffic-light window buttons differ between dev server and released bundled app; released buttons are smaller. Make dev render identical to released app. Investigate window chrome config: titlebar style, button position/size, dev vs production build differences. | Todo |
| P345 | Close chapter v0.2.15 (fold per `CLAUDE.md`). | Todo |

## Results
