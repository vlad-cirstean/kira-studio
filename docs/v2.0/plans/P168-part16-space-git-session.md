# P168 Part 16: review plan, Space git session

Chunk B3, Stream B position 3 of 10 (pre-plan `P168-prep-plan.md` §5.15). One Opus reviewer runs
this plan and reports findings. It fixes nothing. One Sonnet fixer follows (§10).
Tree surveyed: `088fd66` (`p168-stream-b`, rebased onto `v2.0` with Part 14 and Part 15 fixes landed).

Paths repo-relative. `PI` = `apps/kira-space/internal`, `GS` = `PI/gitsession`. Line numbers are as
of `088fd66`; re-read before citing.

SPEC row names this file `P168-part16-git-session.md`; the orchestrator named it
`P168-part16-space-git-session.md`. Same plan, this name wins.

## 0. Gates waived, and the routing tag

User decision for this stream: gates G0 and G1 (pre-plan §3.2) are **waived**. Part 8 (shared Go
base, Stream A) is not yet reviewed. Consequences:

- Root `internal/*` callees (`testx`, and indirectly `procgroup`, `sqlitex`, `notify`, `kiratime`
  through Parts 14-15) are **unreviewed callees**. Read them only as far as a Part 16 contract
  depends on them. A bug inside them is a valid finding when it breaks a Part 16 caller.
- **Any finding whose fix needs a file owned by another Part** carries
  `needs-other-part-file: <path> (Part N)`. The orchestrator routes it.
  - Stream A file (Parts 2-9: root `internal/**`, `scripts/**` except the two VS Code scripts, root
    config, `packages/{workbench,theme,kira-ui,shared,api-core}`) or Stream C file (Parts 10-13,
    Studio frontend): the Stream B fixer never edits it. The orchestrator appends it to
    `docs/v2.0/plans/P168-routed-from-streamB.md` (orchestrator's instruction; Part 14 F4 went to
    the existing `P168-routed-to-stream-a.md`, same entry shape).
  - Stream B file (Parts 14-15 closed, 17-23 later): same stream, sequential. The fixer may edit it
    when a Part 16 fix requires it, and names each such file in the commit body. The tag still
    names it. Typical: `gitrpc` error mapping (Part 17), `ade` callers (Part 20), `main.go`
    shutdown order (Part 22).

## 1. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Call `mcp__codegraph__codegraph_explore` with
  `projectPath=/home/user/kira-studio-streamB` before any Read/Grep on a symbol, call-path or
  blast-radius question. If the tool is not listed, load it with `ToolSearch "codegraph"`. The
  orchestrator greps the run's tool log for real calls. Index: run `sh scripts/codegraph-setup.sh`
  in the worktree if `.codegraph/` is missing or older than HEAD (reported up to date at `088fd66`
  for this plan). Seeds per block (§10):
  1. Lifecycle: `Registry` (`acquire`, `releaseFunc`, `release`, `expire`, `Close`, `IsOpen`,
     `ReconcileAutoFetch`), `newRepoEntry`, `pump`, `note`, `Subscribe`, `teardown`, `CatFile`,
     `closeCatFile`, `subscriber` (`note`, `run`, `close`), `Conn` (`Open`, `alreadyHeld`, `Entry`,
     `CloseRepo`, `Close`, `SetEmit`, `Emit`, `AskCredential`, `DisableAutoFetch`), `opSlot`;
     callers `gitsock.Server.handleConn`/`Close`, `bridge.ServeGitStream`, `ade.TaskBoard.Close`/
     `openRepo`, `main.go` shutdown.
  2. Walk and reads: `Conn.Walk`, `walkForSlot`, `WalkFor`, `ReviewWalkFor`, `markWalksStale`,
     `disposePair`, `Walk` (`newWalk`, `resetLocked`, `ensureFreshLocked`, `MarkStale`,
     `MarkRefresh`, `dispose`, `ReadPage`, `readPageLocked`, `Stream`, `Spec`, `Search`),
     `queries.go` (`runOne`, `runAllowingExit`, `runRecords`, `fileChanges`, `CommitDetail`,
     `FileDiff`, `Blob`, `GoToTarget`), `Refs`/`refsSnapshot`, `statusAndInProgress`, `Status`,
     `WorkingDetail`, `cache.go` caches; callers `gitrpc/{graph,detail,refs,search}.go`.
  3. Ops and undo: `opTable`, `validOpArg`, every `prepare*`, `prepareSequencerVerb`,
     `capture{BranchDelete,TagDelete,StashDrop,StackSet}Undo`, `reclassify*`, `runWriteArgv`,
     `runWriteArgvList`, `RunOp`, `UndoPeek`, `UndoRun`, `undoRunFailure`, `invalidateAfterWrite`,
     `oplog.go`, `preflight.go`, `stash.go`; callers `gitrpc/{ops,reset,stash}.go`,
     `ade/setup.go` (`RunOp`).
  4. Stack and worktree: `stack.go` (`Stacks`, `RestackPreflight`, `prepareStackSet`,
     `RunRestack`, `restackPrepare`, `runRestackPlan`, `restoreHead`, `buildRestackUndo`),
     `worktree.go` (`Worktrees`, `WorktreeAddPreflight`, `WorktreeRemovePreflight`,
     `prepareWorktreeAdd/Remove`, `RunPrepare`, `ParsePrepareTimeout`); callers
     `gitrpc/{stack,worktree}.go`, `ade` prepare use.
  5. Remote: `RunRemote`, `runFetch`, `runPushFamily`, `runPullOp`, `withAskpass`, `coreAskPass`,
     `repoPrompter.Ask`, `resolveUpstreamRemoteBranch`, `refSnapshot`/`diffRefSnapshots`,
     `PushPreflight`, `PullPreflight`, `autofetch.go`; callers `gitrpc/remote.go`,
     `ade/board.go` (`RunRemote`), `gitaskpass.Broker` (Part 14).
  6. Review: `review.go`, `incremental.go` (`blobOID`, `blobOIDs`, `readCurrentContent`,
     `readSnapshotSource`, `FileDelta`, `RangeFiles`, `rangeFilesRecords`, `renameSource`,
     `ReviewFileDiff`, `ReviewSnapshot`, `MarkFile`), `comments.go`; callers
     `gitrpc/{review,incremental,comments}.go`, `ade/review.go`.
  7. GitHub and ADE facts: `gh.go` (`ghState`, `ensureSnapshot`, `ResolveCommitPr`,
     `ResolveBranchPr`, `eagerResolveClosedBranches`, `maybePurgeClosed`, `IsGitHubHost`),
     `ghsync.go` (`ghSyncDecision`, `GhSyncPlan`, `ghSyncFiles`, `SetPrFilesViewed`),
     `queuefacts.go` (`pipePatchID`, `Cherry`, `ResolveCommit`, the rest); callers
     `ade/{ghsync,gitfacts,board_facts,integration,rebasecheck,archive}.go`, `bridge/github.go`,
     `gitrpc/gh.go`.
- **CodeGraph over-links names.** `Conn`, `Open`, `Close`, `Registry`, `Acquire`, `Release`,
  `Walk`, `Stream`, `Subscribe`, `RunOp`, `Store` also exist in Studio adapters, `internal/terminal`,
  `keepawake`, `adapterhost`, `git-ui` TS. Confirm every cross-package claim with `git grep` of Go
  import lines; Go's `internal/` rule makes those authoritative.
- **Real git 2.43.0 probes** (`/usr/bin/git`) in a scratch repo under the session scratchpad for any
  claim that turns on git's behaviour: `update-ref <ref> <sha> ""` when the ref exists, `reset
  --keep` refusals, `config` replay of multi-valued keys, `stash store` placement, `branch` then
  `--set-upstream-to` partial failure, `merge-base --is-ancestor` exit codes, `index.lock`
  contention messages, `patch-id --stable` on empty input. Run probes with `HOME` and
  `GIT_CONFIG_GLOBAL` pointed at the scratchpad (P154 isolation).
- **Concurrency probes** as throwaway `_test.go` files in `GS` (fake `Watcher` via
  `Registry.NewWatcher`, short `LingerFor`, `gitclient` fake runners as existing tests use), run
  with `-race`, deleted before the findings commit, never committed. Prefer a probe over prose for
  every race claim.
- **Checks:** `go vet` and `go test -race -count=1 ./apps/kira-space/internal/gitsession/...`. Both
  clean at `088fd66` (`ok`, 11.3 s). If a finding touches a caller, also
  `./apps/kira-space/internal/{gitrpc,gitsock,ade,bridge}/...`. If missing deps or bindings fail a
  check: `bun install --frozen-lockfile` and `bun run setup` (or `sh scripts/prepare-worktree.sh`).
  A red check is a finding.

## 2. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `088fd66`.

**Part 16 drift: 51 to 52 files, 18,789 to 18,911 code lines (tests 8,637 to 8,769).** Cause:
- P166/P167 and Part 14 fixer edits (`queries.go`, `remote.go`), recorded by Part 15's plan as
  18,773 at `73c7f40`.
- Part 15 fixer `71750e3`: `ops.go` (`prepareBranchCreate`, reset and branch-delete undo records,
  +6 net) and new `undo_guard_test.go` (132), then `088fd66` (test-only `bytes.Equal`).

Drift elsewhere since Part 15's plan (`73c7f40`):
- Part 15: 98 to 100 files, 15,176 to 15,595 (tests 7,563 to 7,900). Part 15 fixes.
- Part 11: 30,574 to 30,551. Part 13: 26,687 to 26,658 (tests 14,621 to 14,592). P162 grid commits.
- Totals: streams A 255,882, B 183,061; 2,879 owned, 0 orphans, 3,510 tracked (docs 478).

## 3. Own file set (52 files)

26 production files (10,142 lines), 26 `_test.go` (8,769). Production lines:

- **Session core:** `conn.go` 486, `entry.go` 454, `registry.go` 311, `cache.go` 251,
  `subscriber.go` 84, `opslot.go` 70.
- **Graph and reads:** `queries.go` 543, `walk.go` 379, `refs.go` 164, `status.go` 82,
  `search.go` 70, `working.go` 56.
- **Ops:** `ops.go` 1,345, `preflight.go` 703, `stash.go` 228, `oplog.go` 83.
- **Stack and worktree:** `stack.go` 950, `worktree.go` 553.
- **Remote:** `remote.go` 777, `autofetch.go` 203.
- **Review:** `incremental.go` 780, `comments.go` 263, `review.go` 221.
- **GitHub and ADE facts:** `gh.go` 556, `queuefacts.go` 282, `ghsync.go` 248.

Tests: `stack_test` 1,149, `ops_test` 1,067, `walk_test` 722, `remote_test` 578, `gh_test` 571,
`incremental_test` 560, `concurrency_test` 534, `conn_test` 496, `worktree_test` 449,
`queries_test` 369, `registry_test` 341, `search_test` 259, `autofetch_test` 250,
`comments_test` 205, `stash_test` 184, `oplog_test` 147, `working_test` 141, `undo_guard_test`
132, `undo_test` 121, `cache_test` 112, `subscriber_test` 106, `preflight_test` 104,
`refs_test` 65, `testentry_test` 60, `ghsync_test` 37, `main_test` 10 (P154
`testx.RunWithTempHomes`). No test file for `entry.go` (covered via `registry_test`,
`testentry_test`), `opslot.go`, `queuefacts.go`, `review.go`, `status.go`.

## 4. One hop: callers (git grep of import lines)

Production importers, symbol level (`git grep -ohE 'gitsession\.[A-Z]\w*'`, tests excluded):

- **`PI/gitrpc`** (Part 17; 19 production files): `Conn` 121 uses, `RepoEntry` 52, result types
  (`OpResult`, `RemoteOpResult`, `RestackResult`, `WorktreePrepareResult`, `StashShowResult`,
  `RefsResult`, `FileDiffResult`, `BlobResult`, `CommentListResult`, `PrLookupResult`,
  `ReviewSnapshotResult`, `StreamChunk`, `Walk`), param types (`OpRequest`, `RemoteOpParams`,
  `RemoteDeps`, `WorktreeAddParams`, `WorktreePrepareDeps`), helpers (`RunPrepare` via entry,
  `PreflightCherryPick`, `PreflightStashPop`, `ReviewFileStatusFor`, `MaxPatchBytes`). Error
  mapping: `detail.go:18-35` maps `ErrParentIndexOutOfRange`, `ErrFileNotInCommit`,
  `ErrPathEscapesRoot`, `ErrBranchNotFound`, `ErrUnrelatedHistories`, `ErrRangedMarkOnNonText`,
  `ErrCommentNotText`, `ErrCommentRangeOutOfFile`; `graph.go:87` `ErrRepoNotHeld`; `ops.go:36,42`
  `ErrInvalidResetMode`, `ErrInvalidOpArg`, `ops.go:29` `ErrUnservedOpKind`; `stash.go:48` `ErrStashNotFound`; everything else goes
  through `handlers.go:405` `mapGitError` (gitclient kinds only) and otherwise crosses as
  `E_INTERNAL`. **Unmapped:** `ErrRepoTornDown`, `gitreview.ErrStoreClosed`,
  `catfile.ErrInvalidRev`.
- **`PI/gitsock`** (Part 17): `server.go:241` `NewConn(ConnID(sessionID), clientID, label, nil)`,
  `Deps.Registry`, `Close` (reaches `Registry.Close`). Tests import widely (`integration_test`,
  `matrix_*`, `recovery_test`, `revoke_test`).
- **`PI/ade`** (Part 20; `archive`, `board`, `board_facts`, `ghsync`, `gitfacts`, `integration`,
  `rebasecheck`, `review`, `setup`): `RepoEntry` 23 uses (`ResolveBranchPr`, `GhSyncPlan`,
  `SetPrFilesViewed`, `RunOp`, `RunRemote`, queuefacts methods), `NewConn`, `Conn.Open/Entry/Close`,
  `OpRequest`, `RemoteOpParams`, `RemoteDeps`, `RemoteOpError`, `ParsePrepareTimeout`,
  `GhStatusKind`, `Event`, `ConnID`, `Registry` (incl. `Registry.Review.SetObserver` at
  `ade/ghsync.go:211`).
- **`PI/bridge`** (Part 22): `gitstream.go:209` `NewConn(newStreamConnID(), nativeClientID,
  nativeLabel, nil)` plus `noAutoFetch` opt-out; `github.go:46` `IsGitHubHost`,
  `Deps.GitRegistry.Gh`.
- **`PI/appcore/deps.go`** (Part 22): `GitRegistry *gitsession.Registry` field. Pre-plan §5.15 omits
  it.
- **`Space/main.go`** (Part 22): `wireGit` `main.go:557` `NewRegistry`, sets `OpLog`, `Settings`,
  `RepoSettingsGet/Set`; shutdown `main.go:209-238`: `adeTaskBoard.Close()` (216), `gitSock.Close()`
  (218), `gitRegistry.Close()` (226), askpass broker, `repositories.Close()` (235), `db.Close()`.
- TS consumers are Part 17-19 (`git-ipc` contract), read only to confirm a wire-shape claim.

## 5. One hop: callees

- **Part 14 (closed):** `gitclient` (`Identify`, `NewRepo`, `Repo.Read/Write/Writing/Runner/GitPath`,
  `Run`, `Spec` incl. `Setsid`/`Stdin`/`Env`/`OnStderr`, `Classify`, `KindOf`, `ResolveHead`,
  `NewRepoWatcher`, `Signal*`), `porcelain` (18 files import it), `catfile` (`NewSession`, `Check`,
  `CheckMany`, `CheckOneShot`, `Read`, `ReadOneShot`, `ErrMissing`, `ErrTooLarge`,
  `ErrInvalidRev`), `logsession` (`walk.go`), `ghclient` (`Client.OpenPulls/PullFiles/Account/...`,
  `Status`), `gitaskpass` (`Request`, broker `ShouldInterpose/WithOp/Env`).
- **Part 15 (closed):** `gitops` (10 files), `gitpreflight` (8), `gitreview` (7: `Store`,
  `FileRecord`, `LineRange`, `ProjectRanges`, range algebra, `ResolveBase`, `ErrStoreClosed`),
  `gitsearch` (`search.go`), `gitprepare` (`worktree.go`), `gitstore` (`walk.go`), `oplog` (4).
- **Part 20 (later, same stream):** `PI/storage/model` in `entry.go`, `registry.go`, `worktree.go`
  (`GitRepoSettings`, `GitRepoSettingsPatch`, `DefaultGitRepoSettings`).
- **Root `internal/*` (Part 8, unreviewed):** `testx` in `main_test.go` only. No production root
  import.
- External: `github.com/google/uuid` (`newUndoID`), `golang-lru` (`cache.go`), `container/list`.
- **Drift from pre-plan §5.15:** callers add `appcore`; callees add `logsession`, `ghclient`,
  `gitaskpass`, `gitstore`, `oplog` explicitly; `storage/model` confirmed.

## 6. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. This package is long-lived state shared
by every window, the VS Code socket client and ADE: lifecycle races, leaks and stale caches matter as
much as single-call correctness. Security: argv built from client and config strings, credentials
relayed to a window, a shell spawned by `RunPrepare`.

### 6.1 Session and registry lifecycle, repo watchers

- `Registry.acquire` (`registry.go:141`) after `Registry.Close` (`295`): Close swaps in a fresh map,
  so a late `Conn.Open` (socket handshake in flight, ADE board, native mount) builds a new entry
  with a live watcher, `pump` goroutine and auto-fetch timer nobody tears down, against a closed
  review store. Check `main.go:209-238` order, `gitsock.Server.Close`, `bridge.ServeGitStream`
  teardown and `ade.TaskBoard.Close` (`board.go:169`) against that.
- `release` (`194`) closes the cat-file session after dropping `reg.mu` (P108 F13). A re-acquire
  between unlock and `closeCatFile` gets the entry whose session is closed under it; an in-flight
  `Check`/`Read` on the new holder fails. Probe or prove harmless (lazy restart).
- `expire` (`228`) versus linger re-acquire, `teardown` (`entry.go:421`) idempotence, `<-e.done`
  waits on `pump`; `note` spawns `go e.eagerResolveClosedBranches()` (`entry.go:259`) that can run
  after teardown (uses `ghClient`, `CatFile`, caches).
- `Conn.Open` (`conn.go:216`) close race (P108 F1) and duplicate-open cleanup (F15), `Subscribe`
  keyed by `subscriptionID` (F3), `Subscribe` on a torn-down entry returns a no-op: the hold then
  stores a dead entry that never emits `repo.changed`.
- `Conn.Close` (`338`) disposes walks while a `Stream` holds `w.mu` across a blocked `emit`
  (backpressure, §6.10): does disconnect teardown block on a wedged socket?
- `AskCredential` (`159`): `credential.request` emitted to a Conn whose `emitFn` is nil yet
  (`SetEmit` race, P108 Part 17 F9) or already closed; answer channel reuse; secret lifetime.
- Watcher failure: `NewWatcher` error fails the Open; a watcher whose `Signals` channel closes on
  its own (fsnotify error) ends `pump` silently, leaving caches never invalidated except by
  `invalidateAfterWrite`. Linked worktree and bare repo summaries (`repoWorkingDir`).
- `IsOpen` semantics during linger; `ReconcileAutoFetch` over lingering entries.

### 6.2 Incremental graph updates and walk staleness

- `markWalksStale` (`conn.go:469`) marks both slots; `ensureFreshLocked` resets only at the top of
  the next call. A `Stream` already running during a refs change emits a mixed page.
- `walkForSlot` (`434`) returns a walk that `Conn.Walk` (`385`) may dispose a moment later after a
  spec change (`old.dispose()` outside `c.mu`). Callers using the returned `*Walk` (`gitrpc/
  graph.go`, `search.go`) must see `ErrRepoNotHeld`, never a panic or a disposed log session.
- `Stream` (`walk.go:279`): `marks` map growth per stream, `resumeThroughRow` past a reset store,
  `dictBase` against `gitstore` dictionary across a reset, `nextSeq` monotonic across resets,
  exhausted flag on zero-chunk restream (G16 F7, client-side), `cachedThrough > 0` guard.
- `readPageLocked` (`241`): reset only when `log.Failed()` (P108 F4); two consecutive stale resumes
  error; cancel mid-page keeps rows.
- `incremental.go` is the review-side incremental path (since-review deltas, §6.7). P166 only skimmed
  it: review it whole.

### 6.3 Op table dispatch and argument validation

- `opTable` (`ops.go:192`): every kind's `Prepare` against `validOpArg` (`40`) for every string
  reaching argv. Map each `OpRequest` field per kind to its guard or prove it unguarded and
  reachable: stash messages, tag messages, revert/cherry-pick shas, reset target, stash index/sha,
  global stash refs, worktree paths, `stackSet` parent.
- `RunOp` (`1164`): `e.undo.Set(nil)` before the first write (F9); `earlyError` path; `failedAt > 0
  && autoStashApplied` message; `Reclassify` on the read-back; a multi-argv op whose later argv
  fails after an earlier one wrote (`branchCreate` plus `--set-upstream-to`, Part 15 F5): branch
  exists, result `OK: false`, no undo, no mention. Real git probe.
- `runWriteArgvList` (`1123`): one `Repo.Write` for the list (F12); `ctx.Err()` after an argv
  succeeded returns a Go error, losing which argvs ran; `noteWrite` per argv.
- `prepareSequencerVerb` (`971`) with Part 15's `ContinueArgs/AbortArgs/SkipArgs`.

### 6.4 Conflict continue/abort/skip state machine

- `opContinue`/`opAbort`/`opSkip` against `gitpreflight.InProgressOperation` per state (merge,
  cherry-pick, revert, rebase merge/apply backend, `am`, bisect). `canContinue/canAbort/canSkip`
  gate versus what `Prepare` re-checks server-side (a raw socket client skipping the UI gate).
- Read-back after each verb: `statusAndInProgress` (`status.go:27`) reflects the new state;
  `reclassifyCherryPick` (`922`) empty pick; `reclassifyStashPop` (`951`) conflicts leaving the stash.
- `restackPausedResult`/`restoreHead` (`stack.go:877,899`): a restack paused on conflict, then the
  user continues or aborts via `opContinue`/`opAbort`: is restack state (slot, undo, remaining plan)
  coherent afterwards?

### 6.5 Concurrent ops on one repo (locking, `index.lock`)

- Writes serialise through `Repo.Write`; remote ops run outside the gate (`remote.go:133` D11) but
  `pull` merges/rebases the worktree: confirm `runPullOp`'s second step takes `Repo.Write`.
- `RunPrepare` (`worktree.go:461`) spawns a user script in a worktree outside any gate while the app
  writes the same worktree (a linked worktree is its own entry, but the main worktree's `git worktree
  remove` can race it).
- An external `git` (terminal, IDE) holding `index.lock`: classified as which `OpError` kind? Auto-
  fetch skips while `Repo.Writing()` but not while an external write runs.
- ADE (`ade/setup.go` `RunOp`, `board.go` `RunRemote`) and windows running ops on one entry at once:
  undo slot overwrite (another window's op clears this window's undo), `remoteOp` slot contention
  returns `OperationInProgress` to ADE.

### 6.6 Cancellation and progress streaming

- `RunRemote` (`285`): `opCtx` versus `ctx` split; `setKillable(true)` only for fetch;
  `logOp.SetCancel`/`ClearCancel` on a nil `*oplog.Op` (auto-fetch passes `conn == nil`) are
  nil-safe (`oplog/log.go:155,172`); `finishRemoteResult` and `noteWrite` with a nil op: check.
- `remote.progress` throttle (100 ms) and final frame; progress after the result is delivered.
- `RunPrepare` `worktree.progress` batches: Part 15 now guarantees no batch after `Run` returns
  (`32ce971`); confirm the result frame is ordered after the last batch on the wire.
- `RunRestack`/`CancelRestack`, `CancelPrepare`: cancel racing slot release (late cancel hitting the
  next op; `opslot.go` `tryCancel` under `s.mu`).
- teardown `forceCancel` on all three slots; an op whose ctx is detached by `gitrpc` (D8) still
  stops at teardown?

### 6.7 Review store, since-review deltas, Part 15 store contract

- `gitreview.Store` is now **never reopened after `Close`** and returns `ErrStoreClosed`
  (`7f93323`). Every `e.review.*` call in `incremental.go`, `comments.go`, `review.go`, `ghsync.go`
  then fails with an error `gitrpc` maps to `E_INTERNAL`. Weigh: requests in flight during
  shutdown (acceptable) versus any path that closes the store earlier than app exit, or a
  `Registry` reused after `Close` (tests, `gitsock` restart?).
- `MarkFile` (`incremental.go:702`): whole read-diff-write under `Store.Lock`, including git
  spawns. `FileDelta` (`375`) tier 0/1/2, `IsAncestorArgs` exit 128, temp dir for no-index diff,
  `BodyTooLarge` line count, `catfile.ErrMissing` for a deleted file, rename carry-over
  (`renameSource`, `rangeFilesRecords:557-575`).
- `RangeFiles` (`508`): `Touch` after reads (session creation side effects), `blobOIDs` (`197`)
  newline split into `CheckOneShot`; `CheckMany` now returns `ErrInvalidRev` for a newline rev:
  confirm no caller can still pass one (`rev` from a ref name cannot hold a newline; `tip` from a
  user string?).
- `ReviewSnapshot`, `ResolveReviewBase` (`review.go:149`), `reviewRangeCountSlot` (one slot per
  entry, keyed by base/branch: cross-window clobber).
- Comments (`comments.go`): anchoring against `at` revs from the client, `lineCountAt` cache,
  `ExportComments` text into ADE agent prompts (prompt injection surface is Part 20's, note only).

### 6.8 GitHub sync and PR lookups (`gh.go`, `ghsync.go`)

- Context: P166 F7 (`684a17e`) made a truncated PR file list keep ledger rows (`ghSyncFiles`).
  P167 F2 (`076bd81`) dropped the frontend sync-plan invalidation on every board push; plan reloads
  on focus, mark, apply, popover open, each a `GhSyncPlan` call with uncached `PullFiles` plus
  `Account`. Weigh cost and the rate-limit breaker.
- `ensureSnapshot` (`gh.go:325`) single-flight: followers inherit the leader's ctx outcome (a
  cancelled leader hands every waiter a failed status); a leader panic leaves `fetch.done` open.
- Breaker armed by `ghFailure`/`armBreaker`; never cleared by `refsChanged` (D7): expiry rule.
- `GhSyncPlan` (`ghsync.go:109`): PR head not fetched; `files.State` casing (`"OPEN"`) versus
  `ghclient`'s normalisation; `blobOIDs` at the PR head; decision table `ghSyncDecision` (`49`)
  rows in order; `SetPrFilesViewed` per-path failure map versus whole-call status.
- `eagerResolveClosedBranches` (`517`) goroutine per `refsChanged`: unbounded spawns on a burst of
  ref signals? Gated by `eagerPurgeAllowed`.
- `IsGitHubHost` (`259`) and `githubRepo` (`275`) host parsing: Part 14 now strips https userinfo
  and lowercases hosts (`7bc0923`); confirm gitsession compares like with like.

### 6.9 Remote and credential handling

- `withAskpass` (`remote.go:120`): interposes only with a conn and no user `core.askPass`;
  `coreAskPass` cache (Part 14 `ad8e892`: failed read no longer cached). Inherited `GIT_ASKPASS`/
  `SSH_ASKPASS` env, `GIT_TERMINAL_PROMPT`; a prompt routed to the wrong window (repoPrompter holds
  the requesting conn).
- Protected-branch gate (P108 Part 15 F1) for `forcePush` and `deleteRemoteBranch`; `ConfirmToken`
  compare; lease re-check against `ExpectedRemoteTip`; `PushArgs` remote branch from upstream
  config (user-editable): leading `-`, `refs/...` spellings, `HEAD`.
- Remote names and URLs in `oplog` rendered argv (Part 15 §6.7): token in URL reaching every window.
- `runPullOp` (`516`) two steps; strategy resolution; fetch updates reported when the merge step
  fails.
- Auto-fetch (`autofetch.go`): `autoFetchTick` (`139`) `disableAutoFetch` on any error (offline
  laptop disables until restart); `rescheduleAutoFetch` overwriting `timer` without `Stop`;
  `pauseAutoFetch` then `EnsureAutoFetch`; tick racing `teardown` (`disabled` read before
  `stopAutoFetch`, then `RunRemote` on a torn-down entry); `noAutoFetch`/`AcquireQuiet` arming rules
  (C13-10, C14-3).

### 6.10 Undo log correctness

- Part 15 changed the replays: `RecreateRefArgs` (`update-ref <ref> <sha> ""`) for branch/tag
  delete undo, `UndoResetArgs` (hard replays as `--keep`). Check `undo_guard_test.go` asserts real
  git behaviour, and that a refused replay (`update-ref` with the ref already present, `reset
  --keep` refusing dirt) surfaces as a readable `OpError`, not `Unknown`. Real git probe of both
  stderr texts through `ClassifyOpError`.
- `UndoRun` (`ops.go:1276`) runs `record.Replay` one `runWriteArgv` each: **one `Repo.Write` per
  argv**, unlike `RunOp`'s F12 single write. Branch-delete undo is ref plus config writes; another
  writer can interleave.
- `UndoRun` takes the record (`Take`, `1281`) before validation: a transient `CatFile` error
  (`1298`) or a spawn error loses the undo for good. `RecoverySha^{commit}` check versus a tag undo
  whose captured sha is an annotated tag on a non-commit.
- `captureBranchDeleteUndo` (`998`) config replay from `config --get-regexp` lines: multi-valued
  keys, values with spaces or newlines, `branch.<b>.kirastack*` keys; `captureStackSetUndo`
  (`stack.go:452`); `captureStashDropUndo` (`1080`) `stash store` message.
- Undo slot attribution (`SnapshotFor`, `OriginConn`) across windows; slot cleared on teardown and
  at linger expiry (undo lost across a reload outside linger: by design?).

### 6.11 Memory growth in long-lived sessions

- Per entry: `detailCache` 64, `mergeBaseCache` cap, `diffCache` 4 MiB (an entry over cap evicts
  everything incl. itself), `refsCache`/`stackCache` single values, `ghState` caches
  (`commitCache`, `branchCache`, snapshot): bounds? `reviewRangeCountSlot`.
- Per walk: `gitstore.Store` has no eviction (Part 15 §6.6), `marks` map per stream, two walks per
  (conn, repo). A VS Code client paging a 1M-commit repo for hours.
- Per conn: `held`, `walks`, `creds` maps; closed conns' maps replaced (not retained).
- Registry: entries for repos opened once linger until `defaultLingerFor`; `Close` frees all.
- Goroutines: one `pump` per entry, one per subscriber, `eagerResolveClosedBranches` per
  `refsChanged`, `pipePatchID` copy goroutine (`queuefacts.go:229`) not joined.

### 6.12 Event ordering and backpressure to rpcstream

- `subscriber` (`subscriber.go`) coalesces per kind, refs before worktree; `deliver` ends in
  `Conn.Emit` then `rpcstream.Session.Emit` (Part 8, unreviewed), which can block on a wedged
  socket. Confirm nothing on the watcher or op path waits on it.
- Op result versus the `repo.changed` that follows it: `invalidateAfterWrite` runs in a defer
  (D7), the response is sent by `gitrpc` after return; a client reacting to `repo.changed` before
  the op result arrives (ordering across goroutines) re-reads fresh data either way?
- `Walk.Stream` emits synchronously under `w.mu` (D13): a slow client blocks this conn's other
  `graph.*` calls, `Conn.Walk` replacement, `dispose` and `Conn.Close`.
- `remote.progress`, `worktree.progress`, `credential.request` emitted from op goroutines: ordering
  against the op's response frame.

### 6.13 Graph cache invalidation

- `note(SignalRefsChanged)` (`entry.go:238`) drops `detail`, `refs`, `stack`, `mergeBases`,
  `rangeCount`, head, `gh`, bumps `cacheGen`; `invalidateAfterWrite` (`363`) drops the same minus
  `gh`. Is the `gh` omission right after a push (PR head now differs)? `worktreeChanged` drops
  nothing: status-derived caches?
- `cacheGen` (P108 F10): every cache fill checks the generation it started under; find any fill
  (e.g. `refsSnapshot`, `Stacks`, `mergeBase`, `ensureSnapshot`) that stores a value computed
  before an invalidation.
- `diffCache` never invalidated: key `(baseSHA, sha, path)` must be content-addressed; check every
  `set` caller passes resolved shas, never a ref name (`rangeFileDiffBody` with `mergeBase`/`tip`).
- Head staleness (`Head`, `setHead`): `statusAndInProgress` sets head from status output while a
  concurrent `note` marks it stale: lost stale mark?

### 6.14 Pre-plan watch items (§5.15)

`Conn.Open` close race and duplicate-open cleanup (§6.1), registry holds (§6.1), auto-fetch arming
per connection `noAutoFetch` (§6.9), walk staleness marks (§6.2), stack and worktree ops
(`stack.go` restack plan, cycles, `MaxStackedBranches`, dirty tree; `worktree.go` add/remove
preflight, `ConfirmToken`, `isPathInsideRepo` symlinks, `RunPrepare` sha256 staleness guard), protected
branches (§6.9).

## 7. Part 14 and Part 15 contract changes the session must handle

Read `git diff d21eeba~1..HEAD` on the callee packages; the reviewer checks each still holds here:

- **Part 15 `71750e3` edited `GS/ops.go` directly:** `prepareBranchCreate` (`ops.go:426`, track via
  `BranchSetUpstreamArgs` after `validOpArg`), `prepareReset` undo replay (`~858`,
  `UndoResetArgs`), `captureBranchDeleteUndo` (`~1017`, `RecreateRefArgs`). Review these regions
  again as part of block 3, plus `undo_guard_test.go`.
- **`gitops.UndoTagArgs` now `RecreateRefArgs`**: tag-delete undo refuses when the tag exists again.
- **`gitops.ClassifyOpError` ignores tab-indented path lines**: `RunOp`/`UndoRun` messages keep the
  full stderr; kind changes only.
- **`gitreview.Store`: `ErrStoreClosed`, no reopen; normalise keeps the NFC session; snapshot
  inflate bounded (`7f93323`).** §6.7.
- **`gitprepare`: no batch after `Run` returns, retained truncation latched, more git env scrubbed,
  doc fixed (`32ce971`).** `RunPrepare` builds env with `BuildEnv(os.Environ(), ...)`; confirm.
- **`gitsearch`: budget fires while git is silent, git failure outranks framing error
  (`c520c54`); JS regex semantics (`e187f7e`).** `Walk.Search` (`search.go:24`) maps the new
  incomplete result and errors; supersede (`searchGen`) and `dispose` cancel.
- **`gitpreflight`: staged rename source counts as dirty; stack depth verdict order-independent
  (`378792e`).** `stack.go`, `preflight.go`, `worktree.go` consumers.
- **Part 14 `catfile` (`7b44882`):** `ErrInvalidRev` for newline revs in `Check`/`CheckMany`
  (gitsession routes newline revs to `*OneShot`, check every call site incl. `UndoRun:1290`,
  `GhSyncPlan:129`, `stack.go:199` `commitResolves`, `queries.go:370`); cancel returns `ctx.Err()`;
  `ReadOneShot` pins the OID. **No `gitrpc` mapping for `ErrInvalidRev`** (§4).
- **Part 14 NUL framing:** `ParseRefRows` (`3137ce5`, `refs_test.go` updated), show body and
  signature (`97d444b`, `queries.go` edited), inventory (`BranchInventory`). `WalkArgs` and working
  diff end with `--` (`ca85fab`): `walk.go`, `working.go`, `search.go` append nothing after it.
- **Part 14 `ResolveHead`** fails on a non-1 verify exit (`8462e1f`): `Head` (`entry.go:317`) now
  errors where it used to report unborn; callers `RunOp`, `UndoRun`, `RunRemote`, `undoRunFailure`
  turn that into a Go error after a successful write.
- **Part 14 `ghclient`:** userinfo stripped, host lowercased (`7bc0923`); `PullFiles` paging bounded,
  head oid validated (`3a8d3c7`). §6.8.

## 8. What earlier fixes already changed (do not re-report)

- **P166/P167 scope (`git diff 743af03 HEAD`, 666 added, 83 deleted over 12 files):** new `ghsync.go`
  and `ghsync_test.go` (P150 GitHub viewed sync), `incremental.go` (`rangeFilesRecords`,
  `renameSource`, `ReviewSnapshot`), `queuefacts.go` (`IsAncestor`, `CountRange`, `Cherry`,
  `DiffPatchID`, `RecentPatchIDs`, `pipePatchID`, `ResolveCommit`; `ReflogCreatedAt`,
  `StackParents` removed), `worktree.go` (`ParsePrepareTimeout`, required timeout), `main_test.go`
  (P154). P166 F7 `684a17e` (truncated PR list keeps ledger rows). P166 skimmed `incremental.go`
  only. New code is in scope; report a real failure scenario only.
  (`743af03` sits behind the shallow boundary for `git log`; `git diff 743af03 HEAD` works.)
- **Part 14 fixes in `GS`:** `ad8e892` (`coreAskPass` no longer caches a failed read), `73c7f40`
  (dropped `oneRecord`), `97d444b` and `3137ce5` test/caller follow-ups. Do not re-report.
- **Part 15 fixes in `GS`:** `71750e3` and `088fd66` (§7). Do not re-report the fixed behaviour;
  a remaining gap in those regions is reportable.
- **P108 Part 16 fixes in code (comments name them):** F1 (Open after Close stores nothing), F2/F3
  (teardown vs Subscribe, subscriptionID), F4 (walk keeps rows except on `Failed`), F7 (dispose old
  walk outside `c.mu`), F9 (undo cleared before first write), F10 (`cacheGen`), F12 (argv list in
  one Write), F13 (`closeCatFile` outside `reg.mu`), F15 (`alreadyHeld`). P108 Part 15 F1
  (protected gate on the remote branch), P108 Part 17 F9 (`emitMu`). G30/G31/G32 review items
  cited in comments (newline `full` routing, batched `blobOIDs`, `BodyTooLarge` line count,
  zero-line full mark). Verify they hold; do not re-report them as new.
- `docs/v2.0/plans/P16{6,7}-code-review.md` are gone (fixed). Nothing to skip.

## 9. Unverified candidates

Leads from planning, **not findings**. Each needs a real scenario, a probe or a code read before
it is reported. Drop any that does not hold; say so in the coverage notes.

1. `Registry.acquire` after `Registry.Close` leaks an entry (watcher, `pump`, auto-fetch timer)
   over a closed review store (`registry.go:141,295`).
2. `release` closes the cat-file session after unlocking; a racing re-acquire's in-flight request
   fails (`registry.go:194-226`).
3. `note` spawns `eagerResolveClosedBranches` that outlives `teardown` (`entry.go:259`).
4. `Subscribe` on a torn-down entry: `Conn.Open` stores a hold that never receives `repo.changed`
   (`entry.go:278`, `conn.go:237-272`).
5. `UndoRun` replays argv one `Repo.Write` each, not the F12 single write (`ops.go:1312`).
6. `UndoRun` consumes the record before a transient check error, losing the undo
   (`ops.go:1281-1299`).
7. `branchCreate` with `track`: create succeeds, `--set-upstream-to` fails, result `OK: false`
   with a created branch and no hint (`ops.go:440-448`, `RunOp:1213`).
8. Branch-delete undo config replay from `--get-regexp` mishandles multi-valued keys or values with
   newlines (`ops.go:998-1050`).
9. `ErrRepoTornDown`, `gitreview.ErrStoreClosed`, `catfile.ErrInvalidRev` cross as `E_INTERNAL`
   (`gitrpc/handlers.go:405`; `needs-other-part-file` Part 17).
10. `Head` error after a successful write turns the whole op result into a Go error, hiding that
    the write happened (`RunOp:1240`, `UndoRun:1327`, `RunRemote:403`) under Part 14's stricter
    `ResolveHead`.
11. `autoFetchTick` disables auto-fetch for the entry's life on any transient failure; tick racing
    `teardown` runs a fetch on a torn-down entry (`autofetch.go:139-179`).
12. `rescheduleAutoFetch` overwrites `timer` without stopping a timer `EnsureAutoFetch` armed in the
    meantime (double ticks) (`autofetch.go:95-102`).
13. `ensureSnapshot` followers inherit a cancelled leader's failure (`gh.go:325-357`).
14. `pipePatchID` copy goroutine not joined; `src` blocked on a full pipe after `sink` exits
    (`queuefacts.go:229-271`).
15. `Walk.Stream` holding `w.mu` across a blocked emit stalls `Conn.Close` via `disposePair`
    (`walk.go:279`, `conn.go:338`).
16. `Walk.marks` grows per stream without bound; `gitstore` store unbounded (`walk.go`).
17. `invalidateAfterWrite` keeps `gh` caches after a push; `worktreeChanged` drops nothing.
18. A cache fill computed before an invalidation stored after it (no `cacheGen` check at that site).
19. `reviewRangeCountSlot` single slot per entry clobbered by another window's review
    (`review.go:25-60`).
20. `RunPrepare` runs outside the repo write gate while `worktreeRemove` targets the same worktree
    (`worktree.go:461`, `prepareWorktreeRemove:370`).
21. `GhSyncPlan` per call: uncached `PullFiles` plus `Account` after P167 F2's reload triggers
    (cost, rate-limit breaker) (`ghsync.go:109-169`).
22. `undo_guard_test.go` asserts argv shape only, not real git refusal behaviour.

## 10. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, one pass, in this block order** (state and lifecycle first, so every later block
  reads against known entry, conn and slot semantics). About 10.1k production lines plus 8.8k test
  lines; read tests where they are the sole guard of a claim.
  1. **Lifecycle:** `registry.go`, `entry.go`, `conn.go` (non-walk parts), `subscriber.go`,
     `opslot.go`, `cache.go`; callers `gitsock/server.go` (`handleConn`, `Close`),
     `bridge/gitstream.go` (`ServeGitStream`), `ade/board.go` (`openRepo`, `Close`), `main.go`
     `wireGit` and shutdown. §6.1, §6.11, §6.12, §6.13.
  2. **Walk and reads:** `conn.go` walk parts, `walk.go`, `search.go`, `queries.go`, `refs.go`,
     `status.go`, `working.go`; callers `gitrpc/{graph,detail,refs,search}.go`. §6.2, §6.12, §6.13.
  3. **Ops and undo:** `ops.go` (incl. Part 15-edited regions), `oplog.go`, `preflight.go`,
     `stash.go`, `undo_guard_test.go`, `undo_test.go`; callers `gitrpc/{ops,reset,stash}.go`,
     `ade/setup.go`. Real git probes for refusals and partial failures. §6.3, §6.4, §6.5, §6.10.
  4. **Stack and worktree:** `stack.go`, `worktree.go`; callers `gitrpc/{stack,worktree}.go`.
     §6.4, §6.5, §6.6, §6.14.
  5. **Remote and auto-fetch:** `remote.go`, `autofetch.go`; callers `gitrpc/remote.go`,
     `ade/board.go` `RunRemote`, `gitaskpass` broker contract. §6.6, §6.9.
  6. **Review:** `review.go`, `incremental.go`, `comments.go`; callers
     `gitrpc/{review,incremental,comments}.go`, `ade/review.go`. §6.7.
  7. **GitHub and ADE facts:** `gh.go`, `ghsync.go`, `queuefacts.go`; callers
     `ade/{ghsync,gitfacts,board_facts,integration,rebasecheck,archive}.go`, `bridge/github.go`,
     `gitrpc/gh.go`. §6.8, §6.11.
  8. **Tests and §7:** confirm guard claims cited in findings and every §7 contract check; report a
     test that no longer guards what its name says, a test leaking out of P154 isolation (`GS`
     tests spawn real git under `testx.RunWithTempHomes`; `gitsock` tests import `GS`), or a missing
     guard for a genuinely complex rule (`CLAUDE.md` unit-test bar: concurrency, cache
     invalidation qualify).
- **Resumable:** write `docs/v2.0/plans/P168-part16-findings.md` as blocks finish, and commit it
  after **every** block (`docs(v2.0): P168 Part 16 findings, block <n>`; normal commit, hooks
  green, explicit `git add <path>`). An interrupted run reads the file, resumes at the first block
  not marked done, and never re-derives a committed block.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a
  concrete failure scenario (inputs, sequence, observed outcome), and a proposed fix. Tag
  `needs-other-part-file: <path> (Part N)` when the fix needs another Part's file (§0). Tag
  `design-decision` when it needs one; the fixer turns it into its own `SPEC.md` phase.
- The findings file states base commit, HEAD reviewed, checks run and results, findings, the fate
  of each §9 candidate (reported as `F<n>` or dropped with reason), then coverage per block:
  reviewed, skimmed (with reason), not reached. No unexplained gap. A chunk with nothing real says
  so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 16 findings`, before any fixer starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 16`, under §0's
  routing (Stream B files editable when required, each named in the commit body; Stream A/C files
  never, routed by the orchestrator to `P168-routed-from-streamB.md`). A fix re-runs
  `go build ./apps/kira-space/...`, `go vet` and `go test -race` over `gitsession`, plus `gitrpc`,
  `gitsock`, `ade`, `bridge` when a caller changed. It deletes the findings file when done. Chunk
  lands per pre-plan §3.4 before Part 17's plan starts.

## 11. Out of scope

- Part 14 and 15 packages (closed): report only a Part 16-visible break, tagged.
- `gitrpc` request validation and wire codecs, `gitsock` handshake and pairing, `git-ipc` (Part 17):
  read only where a Part 16 error or event crosses them.
- ADE engine logic (Part 20), `bridge`/`appcore`/`main.go` beyond the wiring and shutdown order
  (Part 22).
- Root `internal/*` (`rpcstream`, `testx`) beyond the contract Part 16 depends on (Part 8, §0 tag
  rule).
- Generated code, docs, excluded files (pre-plan §6).
