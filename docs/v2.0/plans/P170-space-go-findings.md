# P170 findings: space-go (P168 Parts 14-16, 17 Go, 20, 22 Go, plus P169)

Reviewer: Opus, Stream B. Findings only; a Sonnet fixer fixes every non-design item, one commit per
group, then deletes this file.

- Base: `f40cd35`. Reviewed HEAD: `1ff382e` (branch `p168-stream-b`, equal to local `v2.0`).
- Scope: `git diff f40cd35..HEAD` over `apps/kira-space/internal/**`, `apps/kira-space/main.go` and
  the `internal/terminal/bound.go` AbortAgent seam. Fixer commits read in full, plus one hop.
- Baseline: `go test -race -count=1 ./internal/...` in `apps/kira-space` green at HEAD.
- Severity: high = data loss, security, crash, wrong result in a common path. Medium = wrong result
  or stuck state in a plausible path. Low = edge case, resource, maintainability.

Counts: 0 high, 1 medium, 7 low, 0 design decisions.

## Block 1: ADE engine and Space host (Part 20, Part 22 Go, Part 21 R2 Go)

### F1 (low): `Tracker.Abort` of a fresh record never releases its Take over binding

- Files: `apps/kira-space/internal/ade/tracker.go:400-441` (`Abort`), caller
  `internal/terminal/bound.go` (`abortAgent`); board side `internal/ade/launches.go:266-290`
  (`bindTUIRun`, `OnTUIStopped`), `internal/ade/runs.go:40` (`tuiBound`).
- Issue: Take over of a headless run registers an MCP finish channel (`adeagent.Register`: a config
  file holding a bearer token, plus the token in the server) and binds it to the new TUI record.
  The binding is released only by `OnTUIStopped`. Before `6d66d45`, a terminal that failed to open
  after Compose left its row running; Reconcile stopped it after the grace window and called
  `OnStopped`, which released the binding. `Abort` now removes the record from `spawnedAt`, so
  Reconcile never sees it, and for a fresh record it deletes the row and skips `OnStopped`.
- Scenario: Take over a stuck run; the PTY fails to open after Compose (spawn failure, registry
  closing, duplicate terminal id). The row is deleted, but `tuiRuns[runID]` keeps the binding, the
  `<run>-<n>.mcp.json` file with its live token stays in the agent dir, and the token stays valid,
  until the next Take over of that run or app restart. A regression against the pre-fix path.
- Fix: release per-session state on every abort. Call `OnStopped(recordID)` for fresh records too
  (the board handler only releases bindings), or add a separate abort hook the board wires to
  `OnTUIStopped`. Extend `TestTracker_AbortDeletesFreshAndStopsResumed` to assert the handler ran.

### F2 (low): the new pending-launch guards lock a retry out for the whole pending TTL

- Files: `apps/kira-space/internal/ade/launches.go:171` (`ensureNotOpen`), `:363` (`LaunchStage`),
  `:458` (`StartBranch`); `internal/ade/tracker.go:263-280` (`Prepare` supersede loop), `:292-303`
  (`hasPending`), `defaultPendingTTL` (2 min).
- Issue: a pending intent is consumed only by Compose. A launch whose terminal never reaches Compose
  (window closed mid-launch, the panel unmounted, `Open` failing validation before compose) keeps
  its intent for `PendingTTL`. The three guards now refuse any new launch that matches it.
  `Prepare` already handles this case for a resume ("A retry supersedes an abandoned launch"), but
  `ensureNotOpen` now refuses first, so that supersede loop is dead at board level.
- Scenario: Take over, the terminal fails to mount; Take over again within 2 minutes answers "the
  conversation is already open" with nothing open. Same for `▶ Start` ("already starting").
- Fix: let the guard ignore an intent older than a short window (seconds, the mount round trip),
  or have the renderer report an abandoned launch so `Prepare`'s supersede applies; keep the guard
  for the double-click case it exists for. Use one message that says a launch is starting.

### F3 (low): a run held as "worktree missing" has no release path but Stop and Retry

- Files: `apps/kira-space/internal/ade/runs.go:360-372` (`queueRun` hold), `:720-723`
  (`launchHeldLocked`); `internal/ade/launches.go:56-66` (`launchGate`), `internal/ade/setup.go`
  (`startSetup`, no-script path).
- Issue: Part 20 F1's fix holds a run pending with note "worktree missing" instead of recreating the
  worktree. Held runs launch only from `onSetupReady` / `RetrySetup`. When the user recreates the
  worktree through `▶ Start` (`launchGate` → `ensureWorktree` fresh → `startSetup`), a repo with
  no prepare script writes the setup row `ready` synchronously and never calls `onReady`, so the
  held run stays pending. A worktree re-added outside the app has no trigger at all.
- Scenario: remove a task branch's worktree, let the next step queue (held "worktree missing"),
  Start the branch to recreate it. The board still shows the step waiting; only Stop then Retry
  launches it.
- Fix: after `launchGate` creates a fresh worktree whose setup is ready at once, call
  `launchHeldLocked(sb)` (the task mutex is already held), as `RetrySetup` does. Optionally recreate
  the worktree in `queueRun` as the finding first proposed.

### F4 (low): `CodeReposRepo.Create` lost its doc comment to the new sentinel

- File: `apps/kira-space/internal/storage/repos/coderepos.go:52-59`.
- Issue: `f024c55` inserted `ErrCodeRepoExists` between `Create`'s doc comment and the func, so the
  four-line `Create` doc now documents the var and `Create` has none.
- Fix: move the var above the comment block.

Block 1 dropped candidates:
- `debouncer.stop` / `folderWatcher.stop` waiting on an in-flight callback could deadlock: callers
  (`stopWatchers`, `stopFolderWatch`) hold no lock the callbacks take (`b.mu` released in `Close`
  first; `importMu` released before `stopFolderWatch` in `AddFolder`). Sound.
- Tracker grace timers vs `Close`: `graceWG.Add` happens under `mu` while not closed; `Close` sets
  `closed` under `mu` before `Wait`. Sound. `Abort` racing a fired timer: the record is gone from
  `spawnedAt`, Reconcile skips it. Sound.
- `track()` / `runTracked` / `rebaseChecker.close`: Add always under the closed flag's lock before
  Wait. Sound; `-race` green.
- `launch` refused by `errBoardClosed` leaves a note-less pending row: shutdown only, and the row is
  re-evaluated on the next step transition. Not worth a finding.
- Compose deletes the pending intent before `InsertTUI` commits, so a second `StartBranch` can pass
  both guards in that window: the window is one SQLite insert and the second call must land inside
  it after the renderer's mount round trip. Too narrow to report.
- `adeagent` registration ids restart at 1 per process: an orphan file from a crash is overwritten
  0600 by the same name; harmless.
- `adeflow.Get` now reads only `<id>.yaml`: equivalent to the old List filter for every valid id
  (id must equal the file stem); path traversal guarded.

## Block 2: git process layer, ops, preflight, review, search, prepare, gh (Parts 14, 15, P169)

### F5 (medium): checkout preflight still passes a bare branch name without `--`

- Files: `apps/kira-space/internal/gitops/checkout.go:45` (`RewrittenPathsArgs`), caller
  `internal/gitsession/preflight.go:24-36,62` (`rewrittenPaths` with `resolved.Name`, a short name).
- Issue: Part 14 F10 added `--` to the walk and working-diff argv, but the same bug class remains in
  `git diff --name-only -z HEAD <target>`. `target` is the branch's short name. When a branch shares
  its name with a top-level path (`docs`, `test`, `api`) or the worktree holds a file named `HEAD`,
  git fails with `fatal: ambiguous argument 'docs': both revision and filename` (probed on git 2.43).
- Scenario: a repo with a `docs/` directory and a branch `docs`. Every checkout of `docs` from git-ui
  or the VS Code extension fails at preflight with that error, so the app cannot switch to it.
- Fix: end the argv with `--` (`diff --name-only -z HEAD <target> --`). Check the other rev-taking
  builders a client name can reach (`porcelain.ShowMetadataArgs`/`ShowBodyAndSignatureArgs` when
  `commit.detail` gets a ref name rather than a sha) and add `--` where git accepts it.

### F6 (low): `boundedWriter.Write` reports a short write, contrary to its own contract

- File: `apps/kira-space/internal/ghclient/runner.go:34-51`.
- Issue: on overflow `Write` reslices `p` and returns the truncated length with a nil error.
  `io.Copy` turns `n < len(p)` into `io.ErrShortWrite`, stops copying and closes the pipe — the exact
  SIGPIPE path the doc comment says it avoids. Real `gh` (Go) dies from SIGPIPE, so `cmd.Run`
  returns an `ExitError` and the too-large status still wins; that works by accident. A child that
  survives EPIPE and exits 0 yields `Run` error `short write`, which `classify` reports as
  `KindNotFound` "gh could not be started: short write". Probe: a script that ignores SIGPIPE and
  prints 200 KB against a 1 KiB cap returned `err=short write, trunc=false` (probe deleted).
- Fix: keep the original length (`n := len(p)` before reslicing, return `n, nil`), so the copy
  drains the pipe and `StdoutTruncated` is always set. The large-page test then holds for any child.

### F7 (low): `UndoRun` checks tips outside the write that replays the undo

- File: `apps/kira-space/internal/gitsession/ops.go:1366-1410` (`tipsMoved` at `:1385`, `Take` at
  `:1392`, replay at `:1406`).
- Issue: the Part 16 F11 guard runs `tipsMoved` before `Take` and before `runWriteArgvList` takes
  `Repo.Write`. `update-ref` replays are pinned by their old value, but the reset and cherry-pick
  undo replays are `reset --keep <prev>`, which nothing pins at write time.
- Scenario: two windows on one repo. Window A clicks Undo reset; between A's tip check and A's write,
  window B's cherry-pick (or a commit from a terminal) moves HEAD. A's replay then resets the branch
  past B's commit. The commit is recoverable from the reflog only. Narrow window, hence low.
- Fix: run the tip check inside the same `Repo.Write` acquisition as the replay (a write-list
  variant that takes a pre-check callback), or re-check right before the replay under the lock.

### F8 (low): `RunPrepare` and `RunRestack` still claim their slot after teardown

- Files: `apps/kira-space/internal/gitsession/worktree.go:461-470` (`RunPrepare`),
  `internal/gitsession/stack.go:690-702` (`RunRestack`); fixed sibling `remote.go:303-313`.
- Issue: Part 16 F13 added a `tornDown` re-check after `RunRemote`'s claim, because teardown's
  `forceCancel` finds nothing claimed later. The prepare and restack slots have the same
  claim-then-spawn shape and no re-check.
- Scenario: a `worktree.prepare` or `stack.restack` call holding the entry claims its slot just after
  `teardown` ran `forceCancel`. The prepare script (up to its timeout, 15 min default) or the rebase
  chain runs uncancellable on a dead entry.
- Fix: after each claim, read `e.tornDown` under `e.mu` and return `ErrRepoTornDown`, as
  `RunRemote` does; better, one helper the three slots share.

Block 2 dropped candidates:
- `RunOp` arms undo before `Reclassify`: no Reclassify (`reclassifyCherryPick`, `reclassifyStashPop`)
  flips a nil error to non-nil or back, so `armed` always matches the final outcome.
- Undo slot no longer cleared for a non-undoable op: `e.undo.Set(nil)` still runs before every write
  (`ops.go:1209`).
- `BranchConfigRestoreArgs` (`config --local --add -- key value`, valueless key as `true`): probed on
  git 2.43, `--` is accepted and NUL output is `key\nvalue\0` / `key\0`. Sound.
- `catfile.ReadOneShot` now spawns `rev-parse --verify <rev>` with an unguarded rev: same argv shape
  the pre-existing `cat-file -s <rev>` had; outside this delta.
- `ghclient.parseURLForm` keeps a port (`github.com:443`): the finding left the port to GHES needs.
- `isRE2Limit` maps `a{2,1}` to unsupported: JS rejects it too, so it is unreachable from the client.
- `gitreview` NFC collision keeps the NFC row and deletes the NFD row's children: the fixer followed
  the finding's chosen side; the pin carries over. Not a new defect.
- `gitprepare.awaitDrained` deadlock: every reserved ticket is delivered synchronously by the same
  goroutine (tick, write, flush), and the ticker is joined first. Sound.
- `gitsearch` `\S` inside a class: complement range checked against the whitespace list; exact.
- `Registry.release` detaching cat-file under `reg.mu`: `catfileMu` is held only for pointer swaps,
  `NewSession` spawns lazily. No stall.
- `porcelain` NUL-framed refs and inventory: every consumer (`refsSnapshot`, `captureTagDeleteUndo`,
  `queuefacts`) goes through `ParseRefRows`/`ParseInventory`; no LF parser left.

## Block 3: git RPC, socket and contract (Part 17 Go)

Nothing real found. Read `11f097d`, `93d357c`, `eeed257`, `04bcf28`, `4d4a118`: the error mapper
covers `ErrRepoNotHeld`, `ErrRepoTornDown`, `ErrInvalidRev`, `ErrStoreClosed`; `review.snapshot`
returns raw bytes once; `search.run` clamps to 2000; tests set `GIT_CONFIG_GLOBAL` and
`GIT_CONFIG_NOSYSTEM`.

Block 3 dropped candidates:
- `gitrpc`, `gitsock` and `gitsession` `TestMain` carry three identical git-config isolation
  bodies: test scaffolding, a `testx` helper would be tidier; not worth a finding.
- `handleGraphStream` now passes stream errors through `mapGitError`: a cancel keeps its classified
  kind and non-git errors pass through unchanged, as before.

## Routed

None. F1-F8 sit in space-go files.

## Coverage

- Commits read in full (Go): Part 14 `7b44882`, `8462e1f`, `ad8e892`, `d5fa91e`, `3137ce5`,
  `ca85fab`, `97d444b`, `adf67ea`, `3a8d3c7`, `7bc0923`; Part 15 `32ce971`, `71750e3`, `378792e`,
  `7f93323`, `e187f7e`, `c520c54`, `9986f9d`; Part 16 `869dd9c`, `ffe53e7`, `5251f2b`, `e09e6fa`,
  `61774dd`, `7809a9e`, `1c7472d`, `73c7f40`, `088fd66`, `60901a8`; Part 17 `11f097d`, `93d357c`,
  `eeed257`, `04bcf28`, `4d4a118`; Part 20 `e3cab58`, `0c0c049`, `67deb9c`, `96b89fa`, `3b4b467`,
  `29a6e54`, `446d56b`; Part 22 `f024c55`, `6d66d45`, `1b0af29`, `0216251`; Part 21 R2 Go half
  `08d6262`; P169 `1fe0c34`; `07e7387` (caller rename only).
- One hop: `ade/{board,launches,runs,setup,tracker,folderwatch,workflows,repoconfig}.go`,
  `adeflow/watch.go`, `internal/terminal/bound.go`, `gitsession/{entry,registry,ops,remote,stack,
  worktree,preflight,refs,queries,incremental}.go`, `gitpreflight/undo.go`,
  `gitclient/{catfile,logsession,porcelain}`, `ghclient/{runner,errors,graphql,remote}.go`,
  `gitrpc/{handlers,graph,incremental,search}.go`, `main.go` teardown and service list (15).
- Commits `102123d`..`eac9db0` (P166/P167 fixes inside the range) were already read as new code by
  P168 Part 20; not re-reviewed.
- Probes: full `-race` suite; git 2.43 ambiguity probes (`HEAD` file, `docs` branch vs dir); git
  config NUL/`--add --` probe; `boundedWriter` short-write probe in `ghclient`. All deleted.
