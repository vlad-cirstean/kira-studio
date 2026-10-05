# P167 code review findings (round 2 of 2)

- Base: `743af03` (P142's last fix commit).
- HEAD reviewed: `838125adc4ed7dd80534625fcef65ddeb3f5459b` (`v2.0`, after P166's fixes and result).
- Scope: `git diff 743af03..HEAD` re-read against the tree P166's fixes left (fix commits `eac9db0`
  `fcf4fd2` `56881e6` `fb3840f` `78a77f6` `684a17e` `21a6814` `f962242`), plus every area P166's
  coverage list marked skimmed or not reached. No `P168 Part N` commit landed during the review.
- Excluded: generated bindings, docs, the Cheetah prototype (`apps/kira-studio/frontend/proto`).
- Dimensions: (1) architecture/structure/maintainability/security, (2) functional correctness,
  (3) performance/resources.
- Checks on HEAD: `go test ./...` green; `go test -race ./apps/kira-space/internal/{ade,gitsession}`
  green; `bun run test:unit` green (1784 pass, 0 fail). No red check, so no check finding.

Counts: high 0, medium 2, low 8.

## P166 fixes re-checked

- `ade/archive.go` + `live.go` archive guard (`78a77f6`): headless runs, setups and worktree creation
  are blocked; the barrier lock/unlock drains in-flight launches; a failed archive drops the flag
  through the deferred release. Gap: interactive launches on an existing worktree skip the check
  (F3).
- Review teardown after worktree removal (`78a77f6`): correct order; nothing purged on a failed
  removal.
- `goTracked` (`f962242`): env-script and TUI-finish goroutines are now waited on; one window left
  between `wg.Wait` and the MCP server's close (F4).
- Debounced board refetch, `RunsByLiveTask`/`RunsOfTask` (`fb3840f`): `ade_runs_task` index covers
  both queries; the board only reads runs of live tasks and nothing else needed archived runs.
  Regression check found none; the cheaper board makes F2's per-push GitHub calls the larger cost.
- Take over cwd (`21a6814`): a moved TUI record now starts a new record resuming the same Claude
  conversation at the gate path; no regression found.
- GitHub sync truncation (`684a17e`), review window focus (`fcf4fd2`), tracker test (`eac9db0`),
  settings comment (`56881e6`): correct.

## Findings

### F1 (medium) An estimate has no upper bound, cannot be lowered, and its span drives O(n²) plan work

`apps/kira-space/internal/bridge/adetask_validate.go:20` (`adeEstRe`), `storage/repos/adetask.go:40-53`
(`checkEstExtends`), `frontend/src/ade/v2/board/calendar.ts:159-167` (`spanDays`),
`board/timeline.ts:383` (`collectDayKeys`), `timeline.ts` `spansOn`/`buildBand`.

`adeEstRe` accepts any digit count (`^\d+(\.\d+)?[hd]$`). `checkEstExtends` refuses any later shrink
or clear. `parseEst` turns `Nd` into an N-day span; `spanDays` builds an N-entry array;
`collectDayKeys` adds every one of those days as a band; `buildBand` then runs `spansOn` per band,
which calls `e.days.indexOf` for every entry. Cost is roughly bands × entries × span.

Failure scenario: a user types `3000d` instead of `3d` (or `40000h`). The task now spans 3000 work
days: 3000+ bands render, and every plan model recompute (every minute, every board push, every
second while a setup runs, see F7) does ~10⁷ × task-count operations. `300000d` freezes the window on
load. The estimate field is extend-only, so the user cannot undo it; the only exit is archiving the
task from a window that may no longer respond.

Fix: bound the estimate where it is validated (Go `validateAdeEst` and the estimate field), e.g. at
most 60 work days or 480 h; clamp `span` in `buildMineEntries` as defense in depth.

### F2 (medium) Every board push makes every open review window re-read the PR's files from GitHub

`apps/kira-space/frontend/src/ade/queries.ts:52-56` (`onAdeTaskBoard`),
`frontend/src/ade/v2/queries.ts:421-429` (`useGhSyncPlan`, `staleTime: 0`),
`review/AdeReviewSync.vue:13` (always mounted in the review header),
`internal/gitsession/ghsync.go:109-115` → `ghclient/graphql.go:126-160` (`PullFiles`, uncached).

Each `kira:adetask:board` push invalidates `ghSyncPlanPrefix`. Every review window has an active sync
plan query, so it refetches at once. `GhSyncPlan` calls `PullFiles`, which spawns one `gh api
graphql` process per 100 files (up to 30 pages for a 3000-file PR), with no cache. Board pushes fire
on any ref change in any board repo (debounced 250 ms), every run transition of any task, and most
board writes. None of these change the PR's viewed state.

Failure scenario: two review windows are open while three agents work on other tasks. Every agent
commit and run step pushes the board; each push costs two GraphQL listings, so a busy hour burns
hundreds to thousands of GraphQL requests. The rate limit trips, `ghFailure` arms the breaker, and
sync plus every other `gh`-backed feature (PR state in the panel) reports "unavailable" until reset.

Fix: stop invalidating the sync plan on board pushes. Fetch it when the Sync popover opens
(`enabled: open`), plus the existing window-focus and post-mark refreshes. Or cache `PullFiles` per
PR with a short TTL keyed by head sha.

### F3 (low) Archive does not block an interactive launch on an existing worktree

`apps/kira-space/internal/ade/launches.go:26-43` (`launchGate` returns at line 41 before
`ensureWorktree`'s check), callers `StartBranch` (407), `LaunchStage` (317), `TakeOver`;
`archive.go:123-174`.

P166's guard calls `checkNotArchiving` in `queueRun`, `launch`, `ensureWorktree` and `startSetup`.
When the branch already has a worktree, `launchGate` returns its path without reaching any of them.
`ArchiveTask` takes the task mutex only after preflight and `stopTaskWork` (up to `stopWait`, 15 s
per run), so a launch can take the mutex in between.

Failure scenario: archive starts and waits for a stuck run to stop. Meanwhile the user clicks Start
Claude Code on a branch in another window. `StartBranch` gets the mutex, `Prepare` returns a
terminal id, and the renderer composes the terminal afterwards. `closeTaskTerminals` has already run
(the terminal did not exist yet), then the worktree is removed. The session starts in a deleted
directory, and its record attaches to an archived task.

Fix: call `checkNotArchiving(tc.task.ID)` at the top of `launchGate` (or in `StartBranch`,
`LaunchStage`, `TakeOver` and `launchReviewAgent` after the task mutex is taken).

### F4 (low) A finish_step call during quit can still spawn an untracked DB write

`apps/kira-space/internal/ade/board.go:153-178` (`goTracked`, `Close`), `runs.go:37-40`
(`recordFinish`), `launches.go:282-312` (`applyTUIFinish`).

`Close` cancels `b.ctx`, waits on `b.wg`, then closes the MCP server (`b.agent.Close()` at line 174).
Between `wg.Wait` returning and the server closing, a taken-over TUI's `finish_step` still reaches
`recordFinish` → `goTracked` → `wg.Add(1)` after `Wait` returned (or concurrently with it at counter
zero, which `sync.WaitGroup` forbids). `applyTUIFinish` never checks `b.ctx`.

Failure scenario: the user quits while a taken-over Claude Code session calls `finish_step`. The
goroutine runs `UpdateRun`/`advanceLocked` after `main.go` has closed the database: a logged write
error at best, a lost or half-applied step transition at worst.

Fix: close the agent server before `wg.Wait`. Make `goTracked` refuse new work once `b.ctx` is
cancelled (check under a mutex shared with `Close`). Return early in `applyTUIFinish` when
`b.ctx.Err() != nil`.

### F5 (low) A merge is recorded whenever Claude's turn stops, even when it stopped to ask

`apps/kira-space/frontend/src/ade/v2/dialog/flow.ts:131-151` (`sendMerge`),
`dialog/compose.ts:244` (`ASK`), `internal/ade/integration.go:226-278` (`RecordMerge`), `160-209`
(`integrationRow`).

The merge template ends with "If anything is unclear, ask me before changing anything." A turn that
ends with a question still resolves `stop`, and `sendMerge` then calls `recordMerge`. `RecordMerge`
stores a recorded mark at the branch tip without checking that the target holds it.
`integrationRow` then sees a mark and a target without the tip, and reports `stale`.

Failure scenario: Claude stops to ask how to resolve a conflict. The branch, never merged, now shows
"stale · no longer in staging". Needs you lists a "Re-merge" item for a merge that never happened.

Fix: in `RecordMerge`, check containment of the tip in the target (`IsAncestor`, local or
`<remote>/<target>`), and return a clear error when it is not there. The flow already surfaces that
error through `setActionError`.

### F6 (low) Integration rows spawn uncached git processes on every board build

`apps/kira-space/internal/ade/integration.go:168-181` and `194-204`.

For a branch with a target mark at an older tip, every `Board` call runs two
`merge-base --is-ancestor` processes, plus a `rev-list --count` when stale, per branch per
integration target. Only `contains` is cached (`caches.contain`). The board rebuilds on every push in
every window.

Failure scenario: 20 branches that moved after a merge into 2 targets cost 80+ git spawns per board
build. Two windows and frequent pushes during agent work make this most of the board's git load.

Fix: memoize these per (mark tip, tip, target tip) in `repoCaches`, as `contains` already does.

### F7 (low) The whole plan model recomputes every second while any worktree setup runs

`apps/kira-space/frontend/src/ade/v2/plan/usePlanModel.ts:226-246` (tickers), `297` (`nowMs` read
inside `model`).

`model` reads `now.value` directly. While any setup runs, `secondTick` updates `now` every second,
so `buildTimeline`, every task's `buildTaskProgress`, `buildNeedsYou` and every card rebuild each
second. Only the `⚙ preparing` elapsed label and needs-you ages need the clock. Setups can run for
minutes.

Fix: keep `model` on a minute-granularity input (or `today` only). Compute elapsed labels and ages
in a small computed or component that reads the second ticker.

### F8 (low) Past off days and extra days add Plan bands forever

`apps/kira-space/frontend/src/ade/v2/board/timeline.ts:385`, writers `board/dayMenu.ts:43`,
`plan/AdePlanView.vue:236-238`; schema cap `state/settingsDomain.ts:82` (1000).

`collectDayKeys` adds a band for every `offDays`/`extraDays` entry, past ones included, even with
history hidden. Nothing ever prunes those lists.

Failure scenario: after a year of marking holidays, each past day off still renders as a greyed
band above Today. Once a list reaches 1000 entries, the settings patch that marks a new day off
fails validation.

Fix: in `collectDayKeys`, skip negative offsets unless history is shown and within `historyDays`.
Drop past dates when writing either list.

### F9 (low) Review code from a branch row's context menu fails silently

`apps/kira-space/frontend/src/ade/v2/plan/AdeBranchRow.vue:53`.

`openReview.mutate({ branchId: id })` has no `onError`, and the row never renders the mutation's
error. The panel (`AdeBranchPanel.vue:84-87`) and stage block (`AdeStageBlock.vue:91-95`) callers do
handle it.

Failure scenario: `OpenReviewWindow` refuses ("the branch of X is not created yet" for a branch
created outside the app, or a review base that cannot be resolved). The menu closes and nothing
happens.

Fix: pass `onError` that writes the task's action error (`useAdeBoardUiStore().actionError[taskId]`,
which the panel header shows, as the dialog flow's `setActionError` does).

### F10 (low) ADE v2 push channel names exist twice; the shared constants are dead

`packages/shared/protocol/events.ts:71-81` (`CHANNEL.adeTask*`), `apps/kira-space/frontend/src/bridge/index.ts:259-270`.

The bridge subscribes with string literals (`on('kira:adetask:board', cb)` and 8 more). No code
reads `CHANNEL.adeTask*` (grep: only the definition). The comment there says they mirror
`adewire/channels.go` verbatim, so a rename has to be made in three places, and the one the code
actually uses is not the one the comment points readers to.

Fix: subscribe through `CHANNEL.adeTaskBoard` and the other constants in `bridge/index.ts`, as
every other push in that file does.

## Coverage

Reviewed (read against current code; CodeGraph for call paths and blast radius):
- P166 fix commits listed above, with callers (`launch`, `queueRun`, `ensureWorktree`, `startSetup`,
  `launchGate`, `advanceLocked`, `launchHeldLocked`, `Close`, `recordFinish`, `RunEnvScripts`,
  `Board`/`load`/`assemble`, `RunsOfTask`/`RunsByLiveTask`, `TakeOver`/`Tracker.Prepare`,
  `ghSyncFiles`).
- ADE v2 frontend logic: `board/{timeline,needsYou,calendar}.ts`, `dialog/{compose,flow,deliver,turnWatch}.ts`,
  `notes/{AdeNotesEditor.vue,notesExtensions.ts}`, `plan/usePlanModel.ts`, `ade/queries.ts`
  (signals, log append), `v2/queries.ts`.
- ADE v2 Vue: `review/{AdeReviewWindow,AdeReviewSync,AdeReviewCompose}.vue`,
  `state/adeReviewWindow.ts`, `panel/{AdeRunLog,AdeEstimateField}.vue`,
  `sessions/{AdeHeadlessPane,AdeSessionsTab,AdeSessionStrip}.vue`, `plan/AdePlanView.vue` (plan
  writes, day menu), `plan/AdeBranchRow.vue`, Review-code callers in `AdeBranchPanel`/`AdeStageBlock`;
  a pattern sweep (timers, listeners, `v-html`, fire-and-forget mutations) over all `ade/v2/**`.
- Space `bridge/index.ts`, `main.ts` review boot, `App.vue`, `state/workspace.ts`,
  `views/repo/{RepoDiffView.vue,askReviewAgent.ts,useDiffEditor.ts}`, settings pane changes.
- `packages/git-ui` review changes (`ReviewFilesPane`, `ReviewView`, `main.ts`, `state/review.ts`,
  `state/reviewFiles.ts`), `git-ipc` `review.snapshot` contract, `gitrpc/incremental.go`,
  `gitsession/incremental.go` (rename carry-over, `ReviewSnapshot`), `gitreview/store.go` (observer,
  pin), `ade/ghsync.go` `onReviewChange`.
- `packages/workbench`: `clipboard.ts`, `virtualRows.ts` (getter overscan against vue-virtual's
  computed options), `StatusBar.vue`, `monacoTheme.ts`.
- Kira Studio: documents scroll (`DocumentView.vue` shared row tooltip, `RowActionButton.vue`,
  `page.ts` memo), grid layer CSS (`slickTheme.css`, `CommitGrid.vue`), console `copyAll.ts`,
  `resultMenu.ts`, `ConsoleResultGrid.vue`, `ConsoleView.vue` format, gRPC and HTTP request body
  beautify, engine-status removal.
- Go: `adeagent/{stream,process}.go`, `adeflow/{parse,reader}.go`, `ade/integration.go`,
  `ade/review.go` (open, target, teardown), `storage/repos/{adereview,windows}.go`,
  `ghclient/graphql.go`, `gitsession/queuefacts.go`.
- Tooling: `scripts/check-ade-colours.sh` (byte-checked the sed tab), `scripts/codegraph-duplicates.ts`,
  `scripts/mutation/go.sh`, `tools/mutation/stryker.config.mjs`.

Skimmed (structure and hot spots only):
- `ade/{board_facts,gitfacts,board_writes}.go`, `bridge/adewire/wire.go`, `storage/repos/{aderepoconfig,adebacklog,adeghsynced}.go`.
- Remaining ADE v2 Vue components (`backlog/*`, `needs/*`, `repos/*`, `workflows/*`, `run/*`,
  `panel/{AdeTaskTab,AdeTaskPanel,AdeWorktreeSetup,AdeLinkRow}.vue`, `plan/{AdeTaskCard,AdeDayBand}.vue`, `shell/*`) through the pattern sweep only.
- `tools/mutation/summarize.ts`, `scripts/mutation/ts.sh`.

Not reached:
- `packages/workbench/src/testing/ui/perfProbe.ts` (test-only harness).
- Test code (unit, UI, perf specs, Go `_test.go`).
- `go.sh`'s gremlins exclusion regexes (`-E /`) depend on gremlins' path matching, not verifiable
  without the tool installed.

Areas with nothing real found: P166's fixes other than F3/F4's gaps; Studio documents scroll, grid
layer fix, console copy-all and format, gRPC/HTTP beautify; `git-ui` review filter; workbench
clipboard and virtual rows; notes editor; `adeagent` stream parsing; `adeflow` parser; duplicate
finder and mutation tooling.
