# P168 Part 20 findings: Space ADE engine (Go) and Space persistence

Reviewer: Opus, Stream B, position 7. Findings only; the Sonnet fixer fixes every non-design item,
one commit per group, then deletes this file.

- Base: `f40cd35` (last review baseline). Reviewed tree: `5534b73` (branch `p168-stream-b`).
- Unreviewed commits in owned paths since base (all read as new code): `102123d`, `085102b`,
  `6af53ab`, `f962242`, `21a6814`, `78a77f6`, `fb3840f`, `fcf4fd2`, `eac9db0`.
- Routed to Part 20 from other streams: none (`P168-routed-from-stream{A,B,C}.md`,
  `P168-routed-to-stream-a.md` checked).
- Baseline: `go test -race -count=1` on `internal/{ade,adeflow,adeagent,storage,bridge}/...` green.

Severity: high = data loss, security, crash, wrong result in a common path. Medium = wrong result
or stuck state in a plausible path. Low = edge case, resource, maintainability.

## F1 (medium): a run launches with an empty worktree path

- Files: `internal/ade/runs.go:336-373` (`queueRun`), `:383-450` (`launch`), `:667-691`
  (`launchHeldLocked`); `internal/ade/setup.go:258-263` (`setupReady`).
- Issue: `queueRun` resolves `path` with `worktreeOf`, which returns `""` when the branch is
  checked out nowhere. `setupReady` returns true whenever the branch has a `ready` setup row, so it
  ignores `path`. `launch` never checks `path`.
- Scenario: a task's worktree is removed after its setup finished (git-ui worktree remove, a
  terminal `git worktree remove`, or the repo root switched off the branch). The next step starts
  through `advanceLocked`, `Approve`, `RetryRun` or a send-back.
  - Script stage: `superviseScript` runs the step command with `Dir: ""`, so it runs in the app
    process's cwd (`/` for a Finder launch, the dev checkout in development). A destructive
    command (`rm -rf build`, `git clean -fdx`) hits the wrong tree.
  - Agent stage: `InsertHeadless` fails `Validate` (`cwd is required`) after `InsertRun`, so the
    run stays `pending` with an empty note and no process. `advanceLocked` only logs. Stop then
    Retry repeats the same failure.
- Related: any `launch` error after `InsertRun` (missing code repo, `Logs.Reset` error) leaves the
  same note-less `pending` row.
- Fix: treat `path == ""` as a closed gate. In `queueRun` and `launchHeldLocked`, recreate the
  worktree through the same path `launchGate` uses (`ensureWorktree` plus `startSetup` when
  fresh), or hold the run with a note such as "worktree missing". Make `launch` refuse an empty
  path. When `launch` fails after `InsertRun`, record the run `failed` with the error as note,
  not a silent `pending`.

## F2 (medium): a TUI session row is persisted before its terminal can still fail to open

- Files: `internal/ade/tracker.go:287-363` (`Compose`), `internal/ade/vars.go:98-115`
  (`composeStageMessage`), `internal/ade/review_agent.go:36-43` (review resume).
  Caller: `internal/terminal/bound.go:93-115` (Part 8, not owned).
- Issue: `Compose` inserts or marks the `ade_sessions` row running, and arms the live maps, before
  `BoundService.Open` rechecks `len(composed) > MaxCommandBytes` (64 KiB) and before the PTY
  spawns. `composeStageMessage` puts the whole task notes (up to 1 MiB, `adeMaxNotesBytes`) and the
  whole stage prompt into the quoted command. `composeReviewMessage` already caps notes at 2000
  runes; the stage message does not.
- Scenario 1 (deterministic): a task whose notes plus stage prompt exceed about 64 KiB. Every
  `▶ <Stage>` launch fails with "command is too long". Each attempt leaves a phantom TUI row,
  reconciled to `stopped` after the 30 s grace. Its Claude session id never ran, so Take over of it
  runs `claude --resume <id>` on a conversation that does not exist.
- Scenario 2: a review agent launch whose Open fails after Compose (too long, duplicate terminal
  id, registry closing). The row keeps `purpose = 'review'` and an existing cwd, so every later
  `LaunchReviewAgent` resumes the nonexistent conversation. The task's review agent stays broken
  until its cwd disappears.
- Fix: in `Compose`, build the final command first and return an error when it exceeds
  `terminal.MaxCommandBytes`, before any store write. Cap notes in `composeStageMessage` the way
  `composeReviewMessage` does. The residual case (spawn failure after a successful Compose) needs
  an abort hook from `internal/terminal`; routed to Stream A as optional (see
  `P168-routed-from-streamB.md`).

## F3 (low): the MCP finish channel is keyed by run id only; a second registration clobbers it

- Files: `internal/adeagent/mcp.go:150-188` (`Register`, `forget`),
  `internal/ade/launches.go:220-259` (`finishBinding`, `bindTUIRun`).
- Issue: `Register(runID)` writes `<dir>/<runID>.mcp.json` and appends a token; `release` removes
  that path and every token of the run id. `bindTUIRun` calls the previous binding's `release`
  after the new `Register`.
- Scenario: Take over a stuck run, abandon the launch before the terminal opens (no row yet), then
  Take over again. Or Take over after the first TUI ran `/clear` (its Claude session id changed,
  so `runningTUI` misses it). The second `Register` overwrites the same file. `bindTUIRun` then
  releases the first binding, which deletes the new file and the new token. The new TUI's
  `--mcp-config` points at a deleted file, and its `finish_step` calls fail auth. The run stays
  stuck. An abandoned binding also keeps its token and file until restart.
- Probe: a `-race` test registering `run1` twice, then releasing the first, found the same path
  and zero tokens left with the second file gone (probe deleted).
- Fix: make each registration unique: a per-registration file name (run id plus a random suffix)
  and a `release` that forgets only its own token.

## F4 (low): `wg.Add` outside `closeMu` races `Close`

- Files: `internal/ade/runs.go:434-448` (`launch`), `internal/ade/setup.go:298-303`
  (`startSetup`), `internal/ade/ghsync.go:253-263` (`queueUnmark`); `internal/ade/board.go:155-189`.
- Issue: `goTracked` orders `wg.Add` before `Close`'s `wg.Wait` under `closeMu` and refuses work
  after close. These three call `b.wg.Add(1)` directly. `sync.WaitGroup` requires an Add from zero
  to happen before Wait.
- Scenario: a bound call (StartRun, RetrySetup, StartBranch's gate) or a review-store observer
  event lands during app teardown. `Add` races `Wait`; the goroutine can start after `Close`
  returned and use the closed Conn and, after `db.Close`, the closed DB. `launch` has already
  written the run as `running`.
- Fix: one helper that takes `closeMu`, refuses when closed, and does `Add`. Call it in `launch`
  before `UpdateRun` (refusing leaves the run unlaunched, not `running`), in `startSetup` before
  `UpsertSetup`, and in `queueUnmark`.

## F5 (low): background callbacks outlive `Close` and teardown

- Files: `internal/ade/rebasecheck.go:134-150` (untracked `go func` per check, `onDone` calls
  `scheduleBoard`), `internal/ade/board.go:222-229` (`scheduleBoard` re-arms `boardTimer` after
  `Close` stopped it), `internal/ade/folderwatch.go:119-147,171-179` (`rescan` timer not awaited
  by `stop`), `internal/adeflow/watch.go:16-50,96-111` (`stop` does not wait for an in-flight
  `fire`, though its doc says it does), `internal/ade/tracker.go:348` (`AfterFunc(Grace,
  Reconcile)` never stopped).
- Scenario: quit while a rebase check, folder rescan or workflow echo is in flight, or within 30 s
  of a TUI launch. The callback runs after `repositories.Close`/`db.Close` (logged DB errors) or
  emits on a torn-down emitter.
- Fix: run rebase checks through `goTracked` (or a checker-owned WaitGroup awaited in `Close`);
  make `scheduleBoard`/`scheduleWorkflows` no-ops once closed; make the folder and workflow
  debouncers wait for an in-flight callback in `stop`; keep the tracker's grace timers and stop
  them in `Tracker.Close`. Fix the `Watch` doc to match.

## F6 (low): `startSetup` wipes the setup log before its busy check

- Files: `internal/ade/setup.go:276-291` (`Logs.Reset` before `claimSetup`), `:308-317`
  (`claimSetup` checks and registers under two separate `runMu` sections).
- Scenario: `runSetup` writes `failed` and notifies the board before `endSetup` unregisters it.
  A Retry in that window resets the log, then fails with "a setup is already running"; the
  failure's log is gone. The split check/register lets two concurrent callers both claim.
- Fix: claim first (one `runMu` section: check and register), then reset the log.

## F7 (low): single-session guards ignore launches still pending in the tracker

- Files: `internal/ade/launches.go:323-366` (`LaunchStage`), `:413-459` (`StartBranch`),
  `:76-87` (`runningTUI`).
- Issue: the guards read only `running` TUI rows. A row exists only after `Compose`, so a prepared
  launch whose terminal has not opened yet is invisible.
- Scenario: a double click on `▶ Start` (or two windows) prepares two launches on one branch
  worktree; both open, two Claude TUIs edit one worktree. The review agent is protected by the
  unique `ade_sessions_review` index; stage and branch sessions are not.
- Fix: let `Tracker` report pending intents for a (task, branch, stage) and refuse a second
  Prepare while one is pending (until it is consumed or expires).

## F8 (low): workflow reads reparse every file and query last-valid per file

- Files: `internal/adeflow/reader.go:45-125` (`List`, `record`, `Get`).
- Issue: `Get(id)` runs a full `List`: it reads and parses every workflow file and, per valid
  file, `record` runs `Store.LastValid()` (a full-table query). `Get` runs on every run completion
  (`advanceLocked` → `refreshSnapshot`), on `StageDone`, `CreateTask` and `SetTaskWorkflow`. Reads
  have no size cap; the 1 MiB cap applies only to app writes and imports, not a file placed by hand.
- Fix: read `LastValid` once per `List` and pass it to `record`; skip a file over `maxYamlBytes`
  with an error entry; parse only the requested id's file in `Get` before falling back.

## F9 (low): session guards scan the whole session history

- Files: `internal/ade/launches.go:76-87` (`runningTUI`), `internal/ade/archive.go:203-220`
  (`closeTaskTerminals`), `internal/storage/repos/adesessions.go:52-60` (`ListTask`).
- Issue: each launch and archive reads every `ade_sessions` row ever written (rows are never
  pruned, see F11) to find running TUIs.
- Fix: add a repo query filtered on `state = 'running' AND mode = 'tui'` (with task or branch
  where the caller has one) and use it in both places.

## F10 (low): duplicate helper and stale doc

- Files: `internal/storage/repos/adetask.go:32-37` (`boolToInt`) duplicates
  `internal/storage/repos/aderepoconfig.go:255-260` (`boolInt`); `internal/ade/tracker.go:143-145`
  says "call Recover once at boot" but `Tracker` has no `Recover` (`TaskBoard.Recover` does it).
- Fix: keep one helper; fix the comment.

## F11 (low): `UpdateRepo` writes two stores without rollback

- Files: `internal/ade/repoconfig.go:52-82`.
- Issue: `RepoConfig.Upsert` commits, then `SetRepoSettings` writes the prepare script/timeout.
  A failure in the second leaves the first applied and returns an error; `validatePatch`'s doc
  promises a bad patch leaves both untouched (true for validation, not for a write failure).
- Fix: write `SetRepoSettings` first (it is the call that can refuse), then `Upsert`; or document
  that a later failure can leave the nickname/branches/environments half applied.

## F12 (DESIGN-DECISION): no retention for run logs and session rows

- Files: `internal/storage/repos/adelogs.go`, `internal/storage/repos/adesessions.go`,
  `internal/storage/repos/adetask.go:937-961` (`ArchiveTask` keeps runs and logs).
- Issue: each run keeps up to 2 MiB of log (`AdeLogTailBytes`); runs, logs and `ade_sessions` rows
  of archived tasks are kept forever (logs stay readable from the Sessions tab). The DB grows with
  every run.
- Decision needed: a retention policy (age or count, archived tasks only, or keep forever). Not
  for the fixer; becomes a `SPEC.md` phase if the user wants one.

## Dropped candidates

- Headless `--setting-sources` default `user,project,local` loads a repo's project settings and
  hooks with no trust prompt: documented app setting (`ARCHITECTURE.md`, P146), user-selectable.
- `0009` drops `ade_repo_config.prepare_timeout` without copying values: shipped migration, never
  edited after landing.
- Stale `ade_review_windows` row blocking a re-open: no reachable path; `shell.OpenWindow` cannot
  fail, and an ephemeral window's close always deletes its `windows` row, cascading the review row.
- `taskMus`, `stepMsgs` and `rebaseChecker.failed` grow per task or tip: bounded by user actions,
  bytes each; `stepMsgs` clears on workflow switch.
- `onReviewChange` suffix match (`/feat/x` matches another remote's branch): extra plan run only;
  `runUnmark` recomputes against the right branch.
- `UpsertMark` keeps `recorded = 1` across a tip change: documented ("recorded only ever rises").
- `ghclient.SetFilesViewed` skips GraphQL errors without a path: outside owned files and not
  verified against a real response; Part 16's closed scope.
- Deploy facts call uncached `IsAncestor`/`CountRange` where integration facts use the caches:
  bounded by board fan-out, not measured as a cost; not worth a finding.

## Coverage

- Own files, read in full: `internal/ade/{runs,live,recover,logsink,command,paste,taskworkflow,
  board,board_writes,board_facts (100-402),setup,ghsync,launches,tracker,archive,review (1-212),
  review_agent,sendback,steps (partial),vars,workflows,integration,deploy,repoconfig,
  rebasecheck,folderwatch}.go`; `internal/adeflow/{parse,reader,writer,watch}.go`;
  `internal/adeagent/{process,mcp,stream,suffix,doc}.go`; `internal/storage/{db.go,
  migrations/*.sql,migrations/embed.go}`; `internal/storage/repos/{adetask,adesessions,adelogs,
  adeghsynced,adereview,windows,helpers,repos,adefacts,aderepoconfig,adebacklog}.go`;
  `internal/storage/model/{adetask (Validate),adesession}.go`;
  `internal/bridge/{adetask,adetask_validate,agentsessions}.go`.
- Skimmed: `internal/ade/{facts,gitfacts}.go` (signatures), `bridge/adewire/wire.go` (types),
  `storage/repos/{settings,coderepos,gitreposettings,gitclients,layout,tabs}.go` and remaining
  `model/*.go` (not ADE-specific, Part 2 shapes).
- One hop: `main.go` (`wireTracker`, `wireAdeTask`, `wireReviewWindows`, `closeTaskReviewWindows`,
  `purgeReviewWindows`, teardown order); `internal/terminal/bound.go` (`Open`),
  `internal/shell/{registry,openwindow}.go` (review window close path),
  `internal/gitsession/ghsync.go`, `internal/ghclient/graphql.go` (`SetFilesViewed`),
  `internal/sqlitex` (one connection, FK on).
- Watch items: run engine and recovery (F1, F4), per-task mutex (no misuse found; archive barrier
  sound), review window ordering (sound; dropped candidate), GitHub sync ledger (sound), workflow
  YAML limits (F8), `adetask_validate` bounds (sound; engine limits stricter than bridge),
  `adeagent` process and MCP token (F3), migrations 0004-0015 ordering (sound).
- Probes: `adeagent` double-register (F3), deleted.
