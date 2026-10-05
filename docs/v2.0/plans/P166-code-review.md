# P166 code review findings (round 1 of 2)

- Base: `743af03` (P142's last fix commit, 2026-10-01).
- HEAD reviewed: `f40cd35544f0d7c90fd457fb6034655459829fb6` (`v2.0`).
- Scope: `git diff 743af03..HEAD`, 624 files (P143-P165).
- Dimensions: (1) architecture/structure/maintainability/security, (2) functional correctness, (3) performance/resources.
- Checks run on HEAD: `bun run lint` green, `bun run typecheck` green, `bun run test:unit` green (1784 pass), `go vet` green, `golangci-lint` 0 issues, `knip` exit 0. `go test ./internal/... ./apps/kira-space/...` red: F2.

Counts: high 0, medium 3, low 6.

## Findings

### F1 (medium) ArchiveTask can archive a task while a run it just started is live in a removed worktree

`apps/kira-space/internal/ade/archive.go:146-158`, with `runs.go:576-611` (`completeRun`/`recordOutcomeLocked`) and `setup.go:353-359` (`runSetup` calling `onReady`).

`stopTaskWork` cancels the live runs and setups, waits, then `ArchiveTask` takes the task mutex. Nothing stops a new launch in between, and nothing re-checks live work under the mutex.

Failure scenario A: run R1 of step 1 exits on its own just before Archive. `superviseScript` has already evaluated `stopOutcome(ctx)` (not cancelled yet) and blocks in `completeRun` on the task mutex. `stopTaskWork` cancels R1 (no effect on the outcome) and waits on `done`, which closes only after `completeRun` returns. `completeRun` records `done`, `advanceLocked` starts step 2 (`before: auto`) and launches R2, a new live entry not in `waits`. Archive then removes the worktree under R2's agent and archives the task. R2 keeps running against a deleted directory; its outcome is recorded on an archived task.

Failure scenario B: a prepare script finishes just before Archive. `runSetup` calls `onReady` → `launchHeldLocked` launches the held runs before `endSetup` closes `done`. Same result. A concurrent `StartRun`/`Approve` between `stopTaskWork` and `mu.Lock()` does the same.

Fix: under the task mutex, mark the task as archiving (an in-memory set checked by `launch`/`queueRun`, or check `ArchivedAt`-pending) so no launch happens after `stopTaskWork` begins; or, after taking the mutex, list the task's live runs/setups again and loop (release, cancel, await) until none remain.

### F2 (medium) `go test ./apps/kira-space/internal/ade` fails: `TestTracker_ResumeAfterAbandonedLaunchAndDoubleComposeGuard`

`apps/kira-space/internal/ade/tracker_test.go:359-371`, against `tracker.go:236-241`.

Deterministic, not flaky (3/3 runs): `tracker_test.go:371: Prepare: ade: invalid input: /repo no longer exists`. In the window, `Tracker.Prepare` gained an `os.Stat` of the resumed record's cwd; the test still resumes a session recorded with `Cwd: "/repo"`, which does not exist on this machine. `go test ./...` is red on HEAD (the pre-commit hook does not run Go tests, so it never caught this).

Fix: give the test a real directory (`t.TempDir()`) for `Cwd` in this test (and any other resume test that reaches the stat); keep the stat in production.

### F3 (medium) OpenReviewWindow on an already-open review window does nothing visible

`apps/kira-space/internal/bridge/adetask.go:732-746`.

The doc comment says "opens the branch's review window, or focuses it when already open", and `ade.ReviewWindowOpen.Existing` documents "the caller only focuses it". The `Existing` branch returns `false` without calling `s.FocusWindow(res.Key)`. Frontend callers (`AdeBranchRow.vue:53`, `AdeBranchPanel.vue:84`, `AdeStageBlock.vue:92`) ignore the result.

Failure scenario: the review window of a branch sits behind the main window. The user clicks Review again: nothing happens, no error; the window stays hidden.

Fix: in the `Existing` branch call `s.FocusWindow(res.Key)` (already wired to `windows.Focus` in `main.go:191`) and return its result.

### F4 (low) ArchiveTask purges review state before the worktree removal that can still fail

`apps/kira-space/internal/ade/archive.go:156-162`, `review.go:172-212`.

`teardownReview` unpins and `Purge`s every review session of the task, closes its review windows and deletes its GitHub sync ledger before `removeWorktree` runs. `removeWorktree` can fail after the preflight (`RunOp` returns `!res.OK`, e.g. a lock or a race with a process in the tree). Archive then returns an error, the task stays live, but its review marks, pins and ledger are gone for good (the ledger loss also means files this app marked viewed on GitHub are never unmarked).

Fix: remove the worktrees first, then tear down review state, then archive; or do the irreversible purge only after `Tasks.ArchiveTask` succeeds.

### F5 (low) Run transitions trigger un-debounced full board refetches that read every run ever stored

`apps/kira-space/internal/ade/runs.go:190-202` (`emitRuns` → `notifyBoard`), `board.go:288-311` (`load`), `storage/repos/adetask.go:528-547` (`RunsByTask`).

Every run insert, launch, outcome and pending-note change calls `notifyBoard` directly, not the 250 ms `scheduleBoard`. Each push makes every window invalidate `boardKey`; TanStack cancels the JS promise of an in-flight fetch but the Go side still computes each `Board` call. Each `Board` call reads all runs of all tasks, archived included (`SELECT ... FROM ade_runs` with no filter), plus all archived tasks and branches, plus a `git status` per worktree. A step with `runsOn: each repo` over N branches emits N+ pushes in a burst, so N full board computations per window; the cost grows with history forever.

Fix: route `emitRuns`'s board notification through `scheduleBoard` (the runs push already patches the cached board via `mergeRuns`); restrict `RunsByTask` to live tasks (`JOIN ade_tasks ... WHERE archived_at IS NULL`) for the board, and give `stopTaskWork` a per-task query.

### F6 (low) Take over of a stopped TUI session ignores the fallback cwd it computes

`apps/kira-space/internal/ade/launches.go:122-131`, `181-200`; `tracker.go:233-243`.

`takeOverCwd` falls back to the gate path when the recorded cwd is gone, and the result goes into `PrepareArgs.Cwd`. For a TUI record, `pa.Resume = rec.ID`, and `Tracker.Prepare` with `Resume` always uses `existing.Cwd` and errors when it is missing. The fallback is dead for TUI records.

Failure scenario: a stopped TUI session's worktree was removed and `launchGate` recreates it at a different free path (`freePath`). Take over runs the gate (creating a worktree and maybe a setup), then fails with "<old path> no longer exists".

Fix: for a TUI record whose cwd is gone, resume through `Resumes: rec.ClaudeSessionID` with the gate cwd (as the headless branch does), or reject before `launchGate` runs so no side effects precede the error.

### F7 (low) GitHub viewed sync ignores `PullFiles.Truncated` and drops ledger rows past 3000 files

`apps/kira-space/internal/ghclient/graphql.go:149-152`, `gitsession/ghsync.go:49-55`, `171-219`.

`PullFiles` stops at `maxPullFiles` (3000) and sets `Truncated`; nothing reads it. `ghSyncFiles` treats every path past the cap as `!InPr`: a locally reviewed file becomes `skip notInPr`, and a synced one is added to `drop`, so `GitHubSyncPlan`/`Apply` delete its ledger row. GitHub still shows it viewed; a later un-review never unmarks it.

Fix: when `Truncated`, never drop synced rows for paths not seen (or return a `truncated` status and skip planning).

### F8 (low) Background goroutines outside `TaskBoard.wg` outlive Close

`apps/kira-space/internal/ade/workflows.go:137` (`go b.RunAllEnvScripts(b.ctx)`), `repoconfig.go:75` (`go b.refreshEnvScripts`), `runs.go:39` (`go b.applyTUIFinish`).

`Close` cancels `b.ctx` and waits only on `b.wg`. These goroutines are not added to it. On quit, `RunEnvScripts` sees the cancelled script (`res.Cancelled`) and still calls `Facts.SetEnvState` with error "the script was cancelled", overwriting the stored sha; the write races `repositories.Close()`/`db.Close()` in `main.go`'s teardown. `applyTUIFinish` can likewise write after the DB closes.

Fix: `b.wg.Add(1)` around each (as `queueUnmark` does), and skip `SetEnvState` when `ctx.Err() != nil`.

### F9 (low) Stale default in the settings comment

`apps/kira-studio/frontend/src/state/settingsDomain.ts:79-85`.

The comment still states "max response 10 MiB -> 50 MB"; P160 changed the default to 5 (schema `.default(5)` two screens below, and the Go mirror's comment was updated). The comment says it must match `options.go` field for field, so a reader trusts it.

Fix: update to "-> 50 MB (P160: -> 5 MB)" as in `internal/storage/model/settings.go:84`.

## Coverage

Reviewed (read against current code, CodeGraph for call paths):
- `apps/kira-space/internal/ade/`: `runs.go`, `launches.go`, `live.go`, `steps.go` (step machine parts), `setup.go` (gate, setup), `recover.go`, `archive.go`, `review.go`, `review_agent.go`, `ghsync.go`, `logsink.go`, `folderwatch.go`, `deploy.go`, `taskworkflow.go`, `vars.go`, `repoconfig.go` (UpdateRepo), `workflows.go` (Start), `board.go` (deps, load, Board, assemble), `rebasecheck.go` (checker), `tracker.go` (Prepare resume, Send), `paste.go`.
- `apps/kira-space/internal/adeagent/` (`mcp.go`, `process.go`): loopback MCP auth, token handling, process group stop.
- `apps/kira-space/internal/storage/repos/adelogs.go`, `adetask.go` (run, setup, recover, reset, archive queries), migration `0012_p150_review.sql`.
- `apps/kira-space/internal/gitsession/ghsync.go`, `ghclient/graphql.go`, `gitreview/store.go` (observer, pin), `gitclient/catfile/session.go` (ctx watcher), `gitsession/worktree.go`, `codeworkspace/import.go`, `adeflow/writer.go` (file name validation).
- `apps/kira-space/internal/bridge/adetask.go` (validation, review window, focus), `apps/kira-space/main.go` (wiring, teardown order).
- `internal/terminal/` (`session.go` readLoop/exitDrain, `ptmx_linux.go`, `ptmx_other.go`), `internal/testx/apphome.go`, `internal/kirapaths/`.
- Frontend: `ade/queries.ts` (signals), `ade/v2/queries.ts`, `ade/v2/state/adeDialogs.ts`, `adeReviewWindow.ts`, `adeTakeOver.ts`, `ade/v2/dialog/turnWatch.ts`, `views/repo/askReviewAgent.ts`; kira-studio `workers/parse/*`, `editor/MonacoHost.vue`, `editor/chunkedText.ts`, `views/httprequest/ResponsePane.vue`, `useResponseBody.ts`, settings default change.
- Tooling: `scripts/mutation/run.sh`, `ts.sh`, `tools/mutation/package.json`, `scripts/prepare-ui-tests.sh`.
- Prototype leakage: no `src/` import of `proto/`; Cheetah packages are root devDependencies only (MIT); separate `vite.proto.config.ts`/`tsconfig.proto.json`.

Skimmed (structure and hot spots only, no line-by-line):
- `ade/board_facts.go`, `gitfacts.go`, `integration.go`, `board_writes.go`, `adeflow/parse.go`, `adeagent/stream.go`, `bridge/adewire/wire.go`.
- Frontend ADE v2 board model: `board/progress.ts`, `actions.ts`, `plan/usePlanModel.ts`; `ade/v2/wire.ts`.
- `gitsession/incremental.go`, `gitreview` migrations, `storage/repos/aderepoconfig.go`, `adebacklog.go`, `adeghsynced.go`.

Not reached (round 2 should cover):
- Frontend ADE v2 components (`ade/v2/**/*.vue`: panel, plan, sessions, review, repos, workflows, needs, shell), `board/timeline.ts`, `needsYou.ts`, `calendar.ts`, `dialog/compose.ts`, `flow.ts`, `deliver.ts`, `notes/*`.
- `apps/kira-space/frontend/src/bridge/index.ts` changes, `packages/git-ui` review pane/state changes, `packages/workbench` (`perfProbe.ts`, `clipboard.ts`, `virtualRows.ts`, `StatusBar.vue`).
- kira-studio documents scroll (`DocumentView.vue`, `RowActionButton.vue`, `page.ts`), grid layer fix (`slickTheme.css`, `ConsoleResultGrid.vue`), console `copyAll.ts`/`resultMenu.ts`, gRPC/HTTP request body panes.
- `scripts/codegraph-duplicates.ts`, `tools/mutation/summarize.ts`, `stryker.config.mjs`, `scripts/mutation/go.sh`, `scripts/check-ade-colours.sh`.
- Test code (unit, UI, perf specs, Go `_test.go`) beyond F2; generated bindings, `wire/`, testdata, docs, mockups.
