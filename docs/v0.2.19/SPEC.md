# v0.2.19

First phase `P365` (highest in `HISTORY.md` is `P364`). Branch `chapter/v0.2.19`. Phases run top to bottom.

| # | Phase | Status |
|---|-------|--------|
| P365 | CI resilience. Bound the apt step in `.github/actions/setup/action.yml` (`-o Acquire::Retries=3 -o Acquire::http::Timeout=30`, step timeout) after `ui (Linux, shard 4/4)` hung twice on a `libwebkitgtk-6.0-4` download (PR #13). Retry every transient fault that a later run could clear: network fetches in setup and test steps (apt, bun/npm install, Go module download, Playwright browser download), and rerun `cancelled` runs caused by a timeout in `pr-rerun-flaky.yml` (still never a superseded run; the head-SHA guard covers that). Workflow files cannot be pushed from this session: use `docs/pending-changes/` / `docs/pending-workflows/` per `docs/DEV_ENVIRONMENT.md`. | Done |
| P366 | ADE page design pass. Too many textures, patterns and fonts; make surfaces, type and spacing uniform. Redo the branch tooltips, still ugly, using the plan's color coding. | Done |
| P367 | SQL diff broken: output almost entirely truncated. Root-cause and fix. | Done |
| P368 | Move reviews between columns on the planning board. | Done |
| P369 | Review window header: merge title bar and second bar into one title bar. Remove the sync-to-GitHub button and its functionality entirely (frontend, bridge, backend, docs). | Done |
| P370 | Review window: dropdown with GitHub's review actions (approve, comment, request changes), like the GitHub VS Code extension. Add PR-level comments, sent to the PR. | Done |
| P371 | Review comment dialog resizes and fits the available space. Hunk checkmark must not move when the add-comment mark appears on hover. | Done |
| P372 | Code review, 1 round, over the full diff since the base (see CLAUDE.md). | Done |
| P373 | Close chapter, open PR. | Pending |

## P365 Result

Plan: `plans/P365.md`. Direct: `retry` in `scripts/lib.sh` (used by `pull_images`, `setup.sh`, `install-golangci-lint.sh`, `pull-test-images.sh`), `scripts/retry.sh`, `scripts/ci-apt-install.sh` (apt conf with retries and timeouts, per-attempt `timeout`, drops the first mirror between rounds), `.github/actions/setup/action.yml` (apt via the script, retried `go mod download` on cache miss), `docs/PACKAGING.md` section 7.

Pending patches in `docs/pending-changes/` (apply from a Mac session, then delete): `.github__workflows__pr.yml.patch` (step timeouts, retried Playwright install), `.github__workflows__pr-rerun-flaky.yml.patch` (reruns a cancelled run only when a job hit its timeout; newest-run guard), `.github__workflows__pages.yml.patch` (job timeouts).

Checked: `sh -n` on all scripts, `yq` parse, `git apply --check` on all three patches, local `retry.sh` runs (exit 0, 124 on timeout, 1 after 3 attempts). `ci-apt-install.sh` verified by CI only.

## P366 Result

Plan: `plans/P366.md`. Scope: shell top bar, Plan tab, four panel spots; Backlog, Needs and Workflows editor untouched.

Uniform set: flat token surfaces (card is `Card` `section`, `bg-chrome` only for weekend and day off), no textures, shadows, dashed borders or tint washes, no italic or extrabold, `font-medium` on entity names only, density-scale spacing, codicons instead of glyph icons, state by rail, border, outline or chip colour. Step label and tag use `AdeChip`.

Branch tooltip: new `TooltipContent` `surface` variant and `AdeBranchTip`, one per branch row and tag chip, in the plan colours (work-colour dot, repo chip, tag chip in tone, base marker with parent colour, progress, merged and deployed). Default tooltips render branch chips neutral (`data-chip="branch"`). `BaseMarker.color` and `TextPart` branch `variant` added.

Labels lost leading glyphs (`en.json`); five duplicate ADE keys deleted in favour of existing ones. Guards: U105 bans repeating gradients, U11 covers extrabold and black, ADE U88 exemptions removed. Docs: `ARCHITECTURE.md` density, tooltip and Plan lines.

Baselines: `plan-branches-stacked`, `-review`, `-pending`, `branch-panel-details` (label text changed), new `plan-branch-tip`, `plan-branch-plain-tip`; space screenshots and site visual baselines refreshed (git-graph, memory and studio shots also drifted). Checked: unit 1957 pass, space `ui` 695 pass, space `visual` 20 pass, screenshots rerun clean, `site:check` green after baseline refresh, lint, lint:dead, typecheck via hooks.

## P367 Result

Plan: `plans/P367.md`. Diff is the SQL data view's pending-changes diff (`PreviewCommandPanel` Changes view, `MonacoDiff`). Data was whole; rendering collapsed.

Root cause: `MonacoDiff` root is `h-full min-h-40`; the caller's `h-60` lost to `h-full`, and `h-full` under a parent with only `max-height` is `auto`, so Monaco's `height: 100%` diff root measured 0 px.

Fix: `MonacoDiff.vue` mounts Monaco on an inner `absolute inset-0` host; `PreviewCommandPanel.vue` sizes it with an `h-60` wrapper; `ARCHITECTURE.md` fact. `mutations.spec.ts` scenario 1b asserts the modified line is visible and `.monaco-diff-editor` is taller than 200 px (failed with 0 before the fix).

Checked: studio `ui` `mutations.spec.ts` and `cell-editor.spec.ts` pass, `build:test:space` builds, lint:dead, typecheck and lint via hooks. No Space spec or visual baseline covers `MonacoDiff`.

## P368 Result

Plan: `plans/P368.md`. Frontend only; no Go or wire change (`SetPlan` and `ade_task_plan.day` already carried a review's day).

Semantics: a review item with a plan day is pinned to it like a task. No day keeps the merge-order auto placement. Moving it to Later clears the day.

Changes: `board/timeline.ts` (`TimelineEntry.auto`; pinned reviews join the mine entries and place nothing), `board/dropPlan.ts` (drop on an auto review counts as a band drop), `board/menu.ts` (`Plan` submenu for reviews; auto review reads Later), `plan/AdeTaskCard.vue` (review card draggable), `ARCHITECTURE.md` bullet. Tests: flow `TestReviewPlanDay`; UI `ade-v2-plan.spec.ts` (drag pins, pinned renders on its day), `ade-v2-task-menu.spec.ts`; unit `ade-v2-dropplan`, `ade-v2-timeline`. The drag spec waits two animation frames before release: the drop target is hit-tested per frame, so release raced it (1 in 8 flaky before).

Assumptions (user to check):

- A1. "Columns" means Plan day bands, including `Later`. No kanban by status exists; a status-column move is not possible (status is derived).
- A2. Moving a review to `Later` un-pins it; if a planned task builds on or conflicts with it, it shows on that task's day, not in `Later`.
- A3. A pinned review counts in the overdue rollover of a past day (moves to today with the others). It adds no hours, stays out of overflow, and stays out of the day-off "move tasks starting this day" confirm (same as parked tasks today).
- A4. A pinned review on a later day than its dependent task is allowed; the Plan shows it where the user put it.

Checked: typecheck, lint, knip, unit specs (44 pass), `TestReviewPlanDay` and `TestQueueMergeTree`, `build:test:space`, Playwright ui `ade-v2-plan`, `ade-v2-task-menu`, `ade-v2-review-open` (37 pass; drag spec 25/25 repeats). No visual spec covers the change.

## P369 Result

Plan: `plans/P369.md`. Commits: UI sync removal, merged title bar, Go engine/ledger removal, host role + contract 53, docs.

Header: `AdeReviewHeader` now renders inside the shared `TitleBar` strip (34px, drag region, 78px traffic-light inset); the second bar and the "Review · branch" text are gone. Title truncates to one line. Uncommitted hint is a warn `Badge` plus tooltip (`wails-no-drag`). Spec `ade-v2-review.spec.ts` "boots three panes" asserts identity inside `.wails-drag`, bar height 34, no "Review · " text.

Sync removal: `AdeReviewSync`, `syncParts`, queries, wire types, bridge methods, `space.ade.review.sync.*` and `window.title.title` i18n keys, git-ui `onReviewMarked`/`onMarked`; Go `ade/viewedsync*`, `ViewedSync` bridge/wire, `AdeViewedSyncRepo`, `gitreview` observer, `gitsession/viewedsync*`, `githost.FileReviewSync`/`ChangeFiles`, GitHub `PullFiles`/`SetFilesViewed`, fakehost viewed state. Migration 0050 drops `ade_viewed_sync`. Git IPC contract 52 to 53 (`GitHostInfo.fileReviewSync` removed); `graphChunkFrame` golden regenerated for the version. `TestGitHubSyncWithFakeGh` became `TestGitHubChangeRequestsWithFakeGh`. Visual baseline `review-step-panel` moved (right pane 35px taller: second bar gone).

Checked: typecheck, biome, lint:rules, lint:go, knip, `go build ./...`, `go test ./apps/kira-space/...` (gitclient and mobileweb timing tests failed only under concurrent UI load, pass alone), flow tests, `bun test packages/git-ipc`, full `test:ui:space` (690 pass), full `test:visual:space` (20 pass). Leftover-name grep clean except migrations 0012/0044/0050, ARCHITECTURE migration note, contract comments, `HISTORY.md` and memory-eval testdata.

Not verifiable on Linux: merged bar clearing the macOS traffic lights on a real WKWebView window. It reuses the main window's 78px inset and drag strip.

## P370 Result

Plan: `plans/P370.md`. Commits: host role, git socket requests with contract 54, review window UI, docs.

Host: optional `githost.ChangeRequestReviews` (ReviewTarget, SubmitReview, Comment). GitHub drives `gh api` REST (GET pulls/{n}, POST pulls/{n}/reviews, POST issues/{n}/comments); every field goes through `-f`, never `-F` (argv test guards it). `classify` gains a 422 arm that reports GitHub's first `errors[]` entry. fakehost records reviews and comments and refuses approving its own merge request.

Wire: `changeRequest.reviewState`, `changeRequest.submitReview`, `changeRequest.comment`; contract 53 to 54 (additive); `graphChunkFrame` golden regenerated. Flow test `TestChangeRequestReviewActions` writes `tests/contract/ade-review-actions.json`; four `contract:` UI specs read it.

UI: `AdeReviewActions` (title bar right group: Review dropdown with Comment, Approve, Request changes; Comment on {short}) and `AdeReviewSubmitDialog`. Reuses `common.action.approve.label`, `common.comment.label`, `common.message.label` and the board `Review` label.

Checked: typecheck, biome and lint:rules, lint:go, knip, `go build ./...`, `go test ./apps/kira-space/...`, flow tests, `bun test packages/git-ipc`, full `test:ui:space` (694 pass), `test:visual:space` (20 pass, no baseline moved). Neither flaky Go test (gitclient escalation timer, mobileweb concurrent board reads) failed this run.

Not verified: real GitHub calls. The sandbox cannot reach the GitHub API, so `gh api` POSTs are covered by argv test only.

Assumptions to check:
- A1: Local inline review comments stay agent-only. A submitted review carries only the dialog's message, not the window's comments. Sending them as GitHub review threads would need each comment mapped onto the PR diff; GitHub refuses the whole review when one line is outside it.
- A2: The "Comment" review event and "Comment on PR" are two separate actions, as on GitHub: the first records a review, the second a plain conversation comment.
- A3: On a merged or closed PR, all three review events are disabled and the conversation comment stays available.
- A4: Errors show inline in the dialog (the repo has no toast primitive), and success shows a short status line in the title bar with an "Open PR" link.
- A5: The review is recorded against the PR's current head on GitHub, not the local branch tip. A differing local tip only warns.
- A6: A pending review the user started on github.com makes GitHub refuse a new one (422). That refusal is shown as is; the app does not submit or discard the pending review.

## P371 Result

Plan: `plans/P371.md`. Commits: glyph lanes fix, `DialogContent` `resizable`, review dialog, docs.

Hunk mark: Monaco lays glyph lanes out per line, so hovering a hunk line added the Left add-comment lane and shifted the mark and the whole margin. Fix in `reviewDecorations.ts`: `persistLane` on hunk, comment and add-comment glyphs, plus a `laneCollection` placeholder on line 1 reserving the Left lane. The margin is always two lanes wide. `docs/ARCHITECTURE.md` updated. Spec `the hunk mark stays put when the add-comment mark shows` failed on the old tree (mark x 645 to 663 on hover), passes now.

Dialog: opt-in `resizable` prop on theme `DialogContent`: `ResizeHandle` on the right and bottom edges (`dialog-resize-x`, `dialog-resize-y`), half-size handle math for the centred box, bounds 320 by 240 up to 90% by 80% of the window; i18n `common.dialog.resizeWidth.label` and `resizeHeight.label`. `AdeReviewSubmitDialog` uses it; its textarea fills the body (`min-h-24 flex-auto resize-none field-sizing-fixed`). Specs `the review dialog fits a small window` and `the review dialog resizes from its edges`.

Pre-existing flake fixed: `estimate: set, change and clear at any time` retyped before the board refetch reset the field (4 of 20 runs failed); the spec now waits for the reset value. 30 of 30 pass.

Checked: typecheck, lint, knip (pre-commit and pre-push), `build:test:space`, full `test:ui:space` (696 pass, 1 flake above, fixed), `test:visual:space` (20 pass, no baseline moved).

Assumptions to check:
- A1: "Review comment dialog" is `AdeReviewSubmitDialog` (Review dropdown and Comment on PR), the only dialog in the review window. The inline compose box in the diff (`ReviewThread.vue`, a Monaco view zone) is not a dialog and stays out. Its `resize-y` textarea grows inside a zone whose height is measured once at mount, so it scrolls instead of growing. If the user meant that box, it is a separate fix (re-lay the zone on a `useResizeObserver` callback, capped at the editor height).
- A2: "Fits the available space" means: never larger than the window (90% by 80%, the existing variant bounds), the textarea fills whatever height the dialog has, and the footer stays visible at small windows. The default open size stays `md` (480 px); it does not open full-window.
- A3: Resize is by the right and bottom edges, mouse and keyboard, growing from the centre. No corner grip and no left or top edge.
- A4: Size is not remembered between opens.
- A5: The review diff's glyph margin is now always two lanes wide (about one line height wider than a hunk-only file today). That is the cost of marks that never move, and it also gives comment and hunk marks their own columns.

## P372 Result

Rounds: 1. Base `d1975b05b`. Findings: 11 (0 high, 3 medium, 8 low; the review header miscounted 7). All fixed; findings file removed.

- F1, F2 (CI): `ci-apt-install.sh` bounds only `apt-get install --download-only` and repairs dpkg (`dpkg --configure -a`) before each round; the unpack runs unbounded under the step timeout. New `scripts/playwright-install.sh` repairs dpkg, then runs `playwright install --with-deps`. `go mod download` in `.github/actions/setup/action.yml` is 3 x 120 s so setup fits its 10-minute step.
- F3: dropped the stale pending-patch pointer in `PACKAGING.md`; the unobserved live GitHub POSTs are a `Known open items` entry in `ARCHITECTURE.md`.
- F4, F5 (tests): escalation test counts only SIGKILLs sent after `Wait` returned (atomic flag). Board-reads test uses `testing/synctest` (`synctest.Wait` instead of a 100 ms sleep). Both pass `-count=50 -race`, also under 8 busy loops with `-cpu=1,2(,4)`.
- F6: a review item is done once all its `review` branches merged into main; merged pinned reviews no longer show overdue. Unit row added.
- F7, F8: submit dialog waits for the on-open refetch, re-applies `reviewGate`, blocks on a failed refresh with an Alert. Title bar shows a disabled Review button with the failure in its tooltip. i18n `space.ade.review.actions.stateFailed.hint`.
- F9: `SubmitReview` and `CommentOnPull` use a 30 s write timeout; a write timeout reason says the request may have been recorded.
- F10, F11: resize handles moved to `DialogResizeHandles.vue`, mounted only for `resizable`; `ResizeHandle` gains `scale`, so ARIA reports full sizes; an aborted drag restores the last committed size. UI spec extended.

Pending user action: apply `docs/pending-changes/.github__workflows__pr.yml.patch` (`git apply`, then delete the patch file in the same commit). It points both Playwright install steps in `pr.yml` at `scripts/playwright-install.sh`. F2's optional `pr.yml` timeout change was not needed: the fix is in the action.
