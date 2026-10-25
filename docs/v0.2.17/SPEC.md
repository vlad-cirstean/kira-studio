# v0.2.17

First phase `P349` (highest in `docs/HISTORY.md` is `P348`). Branch `chapter/v0.2.17`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P349 | macOS app icon white padding. Dock, Finder and bundle icon show a white ring inside the squircle, both apps. Root-cause at the icon source or generation step, fix there, name the macOS 26 icon format chosen. Plan: `plans/P349.md`. | Done |
| P350 | Git graph collapsed branch runs. A collapsed run shows tip, placeholder, oldest commit; the oldest row is irrelevant. Show tip, then the placeholder holding every other run member. Plan: `plans/P350.md`. | Done |
| P351 | Git graph toolbar matches every other toolbar. Separators (and any other drift found) differ from the shared toolbar pattern. One shared separator primitive, same spacing. Plan: `plans/P351.md`. | Done |
| P352 | GitHub PR sync. PRs do not load for each branch and are not cached across sessions. Persistent per-repo cache keyed per head branch, one initial full load, incremental sync after, served from cache then refreshed. Plan: `plans/P352.md`. | Done |
| P353 | ADE task flow. New task is scheduled Today so it can start immediately (add dialog `AdeAddPopover.vue`/`adeAddUi`; tasks currently land in Later). Drop repo and branch selection from new-task creation (useful only in the existing-branch/attach tab). Archive asks confirmation dialog. Drop the Changes tab of a work item. Estimate editable any time (set, change, clear; simple), not only extend. In the task panel remove the Name row with input; the panel title becomes the inline editable field, no duplicate. Plan: `plans/P353.md`. | Done |
| P354 | ADE review. Review code button gets an icon. Pressing it while the review window is open crashes the whole app: root-cause and fix; it must only focus the existing window. Review window diff is side by side exactly like the git module (reuse its diff components and behavior, not inline). Review window left bar is fixed to the window's branch: no switching or swapping branches. Review agent starts as a plain interactive terminal with no 'ask about this branch' input; a clearly visible button forwards the user's review comments to the agent. Plan: `plans/P354.md`. | Done |
| P355 | ADE branch styling. Branch chips and rows across the whole ADE module use dotted borders and blue text. Restyle in line with the rest of the design language (shared primitives, Tailwind tokens). Plan: `plans/P355.md`. | Done |
| P356 | Close chapter v0.2.17 (hand-fold per `CLAUDE.md`). | Pending |

## Results

### P349 (Done)

Full-bleed Icon Composer SVG, root fill set in `icon.json`. `CFBundleIconName=appicon`. `Assets.car` shipped. `verify-packaging` S15/A7 cover it. Commits `6a015d3f5`, `e81ea6818`, `ab44ac7a8`. Unverified: macOS look and `actool` acceptance of root fill; no macOS in Linux sandbox.

### P350 (Done)

`collapseRuns` shows tip, then placeholder; oldest member hidden. `bun test` git-core 221 pass, full `test:ui:space` 679 pass, visual 19 pass. Commits `5a951762c`, `ebc7e02c8`.

### P351 (Done)

`ToolbarSeparator` primitive in `packages/workbench`. Graph toolbar (`AppToolbar.vue`) and 8 Studio toolbars use it. Lint rule U104 bans hand-rolled dividers. Geometry spec `repo-graph-toolbar.spec.ts`. Two hand-styled status indicators (restacking, remote-progress) left as-is by user decision. Intermittent `graph-blank-rows.spec.ts:294` root-caused to spec race (baseline taken before final-page relayout); fixed in `e1647c035`, no app change. Space and Studio visual baselines unchanged. Commits `abd785a3a`, `405a7fa66`, `efd7f1840`, `1d1a9df44`, `e1647c035`.

### P352 (Done)

Persisted per-repo change request index. Migration 0047 (`git_host_change_requests`, `git_host_sync_state`), key `lower(provider|host|owner/name)`. Optional `githost.ChangeRequestSync` role (Page, Probe, Checks); GitHub uses GraphQL pages, `gh api -i` ETag probe, `nodes(ids)` checks. `gitsession/crsync.go`: resumable backfill, probe then delta walk, checks refresh, `backoff/v4` plus rate-limit gate, account and schema invalidation. Contract 51: `branch.changeRequestIndex`, `branch.syncChangeRequests`, event kind `changeRequestsChanged`. git-ui fills badges from one index read, no per-branch lookups once complete; focus regain syncs (debounced). Checks: go tests (gitsession, githost, storage, gitrpc, flows, appwire) pass, `golangci-lint` 0 issues, typecheck, lint, lint:dead, lint:rules clean, `bun test packages/git-ui` 241 pass, full `test:ui:space` 683 pass. Flow test `githostflow/sync_test.go`, UI spec `repo-graph-change-request-index.spec.ts`. Unverified: a live GitHub 304; sandbox proxy blocks the API, covered by golden header blocks only. Deviations from plan: INTEGER ms times, `node_id` column, NOCASE `head_owner`, Checks take node ids, `wait` and `focused` params on sync, flow harness default config is manual (`Disabled`), sweep is time-based (15 min), deletion only via missing Checks node for open rows, `head_sha` rule dropped. Commits `22333db3a`, `ff7082a7b`, `0dbd9a38b`, `60d5c7f06`, `94b459721`, `7b6212c5d`, `cc16150c4`, `d3bb66ec6`.

### P353 (Done)

`CreateTaskArgs.Day` (nil = Later); add popover sends today or next work day, no repos or bases. Repoless task refuses Start until a repo is added. Archive click asks `confirm-dialog` (clear path only; at-risk dialog and send-then-archive unchanged). Changes tab, `AdeChangesTab`, Branch `files`/`commits`/`commitCount` and `RangeCommits` removed. Estimate set, change, clear any time; `ErrEstimateShrink` gone, clear button added. Panel title is the inline field; Name row gone. Go `newtask_test.go`, UI `ade-v2-task-flow.spec.ts` plus updates. Parity test keeps oracle pairs inline. Regenerated `graphChunkFrame` golden (stale contract 50, pre-existing unit failure). Checks: typecheck, lint, lint:dead, `bun run test:unit` 1945 pass, `go test ./apps/kira-space/...` pass, `lint:go` 0 issues, full `test:ui:space` 683 pass. No `FlowDeps` fake in `ade-v2-dialog.spec.ts` (flow wired only through UI); archive confirm covered by `ade-v2-task-flow.spec.ts` (Cancel sends nothing, Archive sends) and `ade-v2-archive.spec.ts`. Flake `TestRefsChanged_StaleRefreshIsSingleFlight`: late stale observer re-claimed the refresh key after the first refresh released it, so a second fetch ran; background closures now recheck `cacheStale` after claim. `-race -count=300` under parallel load: 0 failures. Commits `f66c55281`..`3473f2ca1`.

### P354 (Done)

Review code button has the `git-compare` icon (panel, step block, branch panel). Crash root cause: `WindowRegistry.Focus` called `[NSApp unhide:]` off the main thread; AppKit aborts. `Focus` now runs the unhide through `application.InvokeSync`, then Show/UnMinimise/Focus. Second press only focuses. macOS crash fix is unobservable here (no AppKit); covered by `TestRaiseUnhidesOnMainThreadBeforeWindowCalls`, a unit test of the ordering seam. Flow `TestReviewWindowAndAgent` asserts one window opens; contract `OpenReviewWindow#existing`.

Diff side by side: Monaco `useInlineViewWhenSpaceIsLimited` flipped the narrow window to inline; set `false`. Window-only differences removed: "Needs review" filter (`reviewFilter`), Ask review agent action (`askReviewAgent.ts`), session resume/save, target switching. Git-ui `lockTarget` fixes the left bar to the window's branch.

Review agent is a plain terminal; `AdeReviewCompose` and the question input gone. "Send review comments · N" button calls `ForwardReviewComments` (`Tracker.Send`, then `MarkSent`); prompt `ade.review.forward.message` is editable. Copy button beside it calls `ReviewForwardText`: same composed message to clipboard via `useCopy`, no agent needed, no Send, no MarkSent.

Tests: Go `TestReviewForwardComments` (incl. copy text equals forwarded prompt, `sentAt` unset after copy), UI specs `ade-v2-review.spec.ts` (side by side, plain terminal, forward, copy clipboard text equals contract text and no forward call), `ade-v2-review-open.spec.ts` (icon, focus only). Contracts `ade-review-open`, `ade-review-forward`.

Verified: typecheck, lint, lint:dead, lint:go clean; `go test ./apps/kira-space/...` pass after `TestList` count fix (118 prompts); targeted Playwright 118 passed; full `test:ui:space` 689 passed; `test:visual:space` 19 passed, no baseline change; real `claude` `TestAdeReviewStep|TestAdeReviewLost|TestAdeManualSession` pass.

### P355 (Done)

Root cause: ADE pushed plain branch names through `VarText` as template-variable chips (dashed border, blue text). New `BranchChip` (theme): `Badge` with `git-branch` codicon, git graph ref-badge recipe; variants `default`, `info`, `warn`. `TextPart` object gains `kind?: 'branch'`; `VarText` renders it as `BranchChip` (keeps `data-var`). `branchParts` (and `catalogParts` `branchVars` param) builds branch-name parts; all branch-only callers in `baseMarker`, `actions`, `reviewCode`, `rebaseActions`, `changeBase`, `reviewAnchor` switched. Real variable chips (workflow, run dialog, automations, `syncParts` shas) unchanged. Base marker: `BranchChip` (`default`, `info` for another owner's branch, `warn` while rebase pending, replaces dashed amber). Review branch name now `text-fg`. Base picker: plain label and `font-data` options. Branch panel: `BranchChip` inside the link, tooltip with full name. Deviation: `Identifier` import kept in `AdeBranchPanel.vue` (still used elsewhere); dropped `hover:bg-hover` on the link (check-ui-primitives U18).

Tests: selectors updated in `ade-v2-base-rebase.spec.ts`, `ade-v2-plan.spec.ts`. New visual spec `ade-plan-branches.spec.ts`. Checks: typecheck, lint, lint:dead clean; `test:unit` 1945 pass; targeted ADE specs 129 pass; full `test:ui:space` 689 pass; `test:visual:space` 20 pass, existing baselines zero diffs. New baselines (reviewed, stable over repeat runs): `plan-branches-stacked`, `plan-branches-review`, `plan-branches-pending`, `branch-panel-details`. Viewport 1400x1800 so the sticky day header does not cover rows.
