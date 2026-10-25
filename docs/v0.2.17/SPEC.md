# v0.2.17

First phase `P349` (highest in `docs/HISTORY.md` is `P348`). Branch `chapter/v0.2.17`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P349 | macOS app icon white padding. Dock, Finder and bundle icon show a white ring inside the squircle, both apps. Root-cause at the icon source or generation step, fix there, name the macOS 26 icon format chosen. Plan: `plans/P349.md`. | Done |
| P350 | Git graph collapsed branch runs. A collapsed run shows tip, placeholder, oldest commit; the oldest row is irrelevant. Show tip, then the placeholder holding every other run member. Plan: `plans/P350.md`. | Done |
| P351 | Git graph toolbar matches every other toolbar. Separators (and any other drift found) differ from the shared toolbar pattern. One shared separator primitive, same spacing. Plan: `plans/P351.md`. | Pending |
| P352 | GitHub PR sync. PRs do not load for each branch and are not cached across sessions. Persistent per-repo cache keyed per head branch, one initial full load, incremental sync after, served from cache then refreshed. Plan: `plans/P352.md`. | Pending |
| P353 | ADE task flow. New task is scheduled Today so it can start immediately (add dialog `AdeAddPopover.vue`/`adeAddUi`; tasks currently land in Later). Drop repo and branch selection from new-task creation (useful only in the existing-branch/attach tab). Archive asks confirmation dialog. Drop the Changes tab of a work item. Estimate editable any time (set, change, clear; simple), not only extend. In the task panel remove the Name row with input; the panel title becomes the inline editable field, no duplicate. | Pending |
| P354 | ADE review. Review code button gets an icon. Pressing it while the review window is open crashes the whole app: root-cause and fix; it must only focus the existing window. Review window diff is side by side exactly like the git module (reuse its diff components and behavior, not inline). Review window left bar is fixed to the window's branch: no switching or swapping branches. Review agent starts as a plain interactive terminal with no 'ask about this branch' input; a clearly visible button forwards the user's review comments to the agent. | Pending |
| P355 | ADE branch styling. Branch chips and rows across the whole ADE module use dotted borders and blue text. Restyle in line with the rest of the design language (shared primitives, Tailwind tokens). | Pending |
| P356 | Close chapter v0.2.17 (hand-fold per `CLAUDE.md`). | Pending |

## Results

### P349 (Done)

Full-bleed Icon Composer SVG, root fill set in `icon.json`. `CFBundleIconName=appicon`. `Assets.car` shipped. `verify-packaging` S15/A7 cover it. Commits `6a015d3f5`, `e81ea6818`, `ab44ac7a8`. Unverified: macOS look and `actool` acceptance of root fill; no macOS in Linux sandbox.

### P350 (Done)

`collapseRuns` shows tip, then placeholder; oldest member hidden. `bun test` git-core 221 pass, full `test:ui:space` 679 pass, visual 19 pass. Commits `5a951762c`, `ebc7e02c8`.
