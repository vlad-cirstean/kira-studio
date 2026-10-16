# P168 Part 15: review plan, Space git preflight, ops, review, search, prepare, graph store, op log

Chunk B2, Stream B position 2 of 10 (pre-plan `P168-prep-plan.md` §5.14). One Opus reviewer runs
this plan and reports findings. It fixes nothing. One Sonnet fixer follows (§10).
Tree surveyed: `73c7f40` (`p168-stream-b`, rebased onto `v2.0` with Part 14's fixes landed).

Paths repo-relative. `PI` = `apps/kira-space/internal`. Line numbers are as of `73c7f40`; re-read
before citing.

SPEC row names this file `P168-part15-git-ops.md`; the orchestrator named it
`P168-part15-space-git-ops.md`. Same plan, this name wins.

## 0. Gates waived, and the routing tag

User decision for this stream: gates G0 and G1 (pre-plan §3.2) are **waived**. Part 8 (shared Go
base, Stream A) is not yet reviewed. Consequences:

- Root `internal/*` callees (`sqlitex`, `notify`, `kiratime`, `procgroup`, `testx`) are
  **unreviewed callees**. Read them as far as a Part 15 contract depends on them. A bug inside them
  is a valid finding when it breaks a Part 15 caller.
- **Any finding whose fix needs a file owned by another Part** carries
  `needs-other-part-file: <path> (Part N)`. The orchestrator routes it.
  - Stream A or C file (root `internal/**`, `scripts/**` except the two VS Code scripts, root config,
    `packages/{workbench,theme,kira-ui,shared,api-core}`): the Stream B fixer never edits it. The
    orchestrator appends it to `docs/v2.0/plans/P168-routed-to-stream-a.md` (existing file, same
    shape as Part 14 F4's entry).
  - Stream B file (Parts 14, 16-22): same stream, sequential. The fixer may edit it only when a
    Part 15 contract change requires the caller to follow. The tag still names it.

## 1. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Call `mcp__codegraph__codegraph_explore` with
  `projectPath=/home/user/kira-studio-streamB` before any Read/Grep on a symbol, call-path or
  blast-radius question. If the tool is not listed, load it with `ToolSearch "codegraph"`. The
  orchestrator greps the run's tool log for real calls. Index: run `sh scripts/codegraph-setup.sh`
  in the worktree if `.codegraph/` is missing or older than HEAD (synced at `73c7f40` for this
  plan). Seeds per block:
  - `gitprepare`: `osRunner.Run`, `BuildArgv`, `ResolveShell`, `IsExecutableFile`, `BuildEnv`,
    `scrubbedEnvKeys`, `outputCollector` `write`/`tick`/`flush`/`reserveDelivery`/
    `finishDelivery`/`takeBatchIfDueLocked`, `sanitizeLine`, `stripANSI`, `consumeCSI`,
    `consumeOSC`; callers `gitsession.RunPrepare` (`worktree.go`), `ade` `setup.go`/`deploy.go`/
    `runs.go`, `adeagent.Run`.
  - `gitops`: every `*Args` builder (about 60), `sequencerArgs`, `ContinueArgs`/`AbortArgs`/
    `SkipArgs`, `ReadInProgressStateFiles`, `readSequencerTodoKind`, `ClassifyOpError`,
    `classifyOpErrorRules`, `hasConflictLine`, `ClassifyRemoteError`, `ExtractRemoteMessage`,
    `ParsePushPorcelain`, `PushUpdates`, `ProgressParser`; callers `gitsession` `opTable`,
    `RunOp`, `runWriteArgvList`, `validOpArg`, `runPushFamily`, `runRestackPlan`.
  - `gitpreflight`: `ClassifyInProgress`/`InProgressOperation`/`DescribeInProgress`
    (`operation.go`), `ClassifyCheckout`, `ClassifyCherryPick`, `ClassifyRevert`, `ClassifyReset`,
    `ClassifyPull`/`ResolvePullStrategy`/`ResolveRebaseMerges`, `ClassifyPush`, stash classifiers,
    `BuildStacks`/`resolveStackBase`/`flattenStack`/`ClassifyRestack`/`DetectCycleFrom`,
    `SummarizeStatus`/`DirtyPaths`, `UndoSlot`/`UndoRecord.SnapshotFor`, worktree classifiers;
    callers `gitsession/preflight.go` (`predictCherryPick`, `cherryPickCommitPaths`),
    `gitsession/{ops,stack,status,worktree,remote,cache}.go`.
  - `gitreview`: `Store` (`ensureOpen`, `conn`, `Close`, `Put`, `Delete`, `Record(s)`, `Touch`,
    `SetPinned`, `SetObserver`/`notify`, `Lock`/`keyedMutex`), `upsertSession`, `sweepDB`, `Purge`,
    `Branches`, `startReaperLocked`, `migrate`, `normalizeStoredPaths`/`normalizeSessionRepoIDs`,
    `Compress`/`Decompress`, comment CRUD, `FormatComments`/`SortAnchored`, `ProjectRanges` and
    helpers, `Normalize`/`Union`/`Subtract`/`Expand`, `ResolveBase`/`resolveBaseRef`/
    `collectCandidates`/`findRef`; callers `gitsession/{review,incremental,comments,ghsync,gh,
    queuefacts,registry,entry}.go`, `gitrpc/review.go`, `ade/{ghsync,review}.go`.
  - `gitsearch`: `Scan`, `scanRound`, `readScanChunk`, `Compile`, `translate`,
    `hasTopLevelAlternation`, `wrapWholeWord`, `literalMatcher` (`match`, `matchFold`,
    `indexFoldAt`, `boundaryOK`), `MatchFields`; caller `gitsession.Walk.Search`,
    `gitrpc/search.go`.
  - `gitstore`: `Store.Append`/`Clear`/`PackSlice`, `Interner`, `hexToBytes`, `clampTimestamp`,
    `EncodeChunkFrame`, `encodeDecorationRef`, `createUint32VectorLE`, `estimateChunkSize`; callers
    `gitsession/walk.go`, `gitrpc/graph.go`; mirror `packages/git-ipc/src/graphChunkCodec.ts`
    (`fromWire`/`toWire`) and `packages/git-ipc/schema/gitwire.fbs`.
  - `oplog`: `Log.Start`/`Recent`/`Cancel`/`OnUpdate`, `Op.AddCommand`/`SetCancel`/`ClearCancel`/
    `Finish`, `renderCommand`/`quoteArg`; callers `gitsession/oplog.go` (`startOp`, `withOp`,
    `noteWrite`, `finishOpResult`), `gitsession/remote.go`, `bridge/{events,ops}.go`,
    `main.go:559`; TS consumer `packages/workbench/src/state/createOpLogStore.ts`.
- **CodeGraph over-links names.** `Run`, `Scan`, `Store`, `Open`, `Record`, `Finish`, `Classify`,
  `Spec`, `intersect`, `Normalize` also exist in Studio, `ghclient`, `adeagent`, `storage`, and
  `packages/git-core`. Confirm every cross-package claim with `git grep` of Go import lines;
  Go's `internal/` rule makes those authoritative.
- **Real git 2.43.0 probes** (`/usr/bin/git`) in a scratch repo under the session scratchpad for
  every claim that turns on git's behaviour: sequencer and rebase state files, `--continue`/
  `--abort`/`--skip` exit codes and stderr per state, `merge-tree --write-tree` exit codes, push
  `--porcelain` lines, progress output with `\r`, `stash push -m` with a newline, remote and branch
  names starting with `-`. Never assume a shape. Run probes with `HOME` and `GIT_CONFIG_GLOBAL`
  pointed at the scratchpad (P154 isolation).
- **SQLite probes** through a throwaway Go test using `sqlitex.Open` (modernc driver, DSN pragmas
  incl. `_foreign_keys=1`), for any claim about `UPDATE OR REPLACE` and FK cascades, migrations,
  `ON CONFLICT` arms.
- **Scratch probes** in the scratchpad or a throwaway `_test.go` deleted before the findings
  commit, never committed.
- **Checks:** `go vet` and `go test -race -count=1` over
  `./apps/kira-space/internal/{gitpreflight,gitops,gitreview,gitsearch,gitprepare,gitstore,oplog}/...`.
  Both clean at `73c7f40` (7 packages ok, `gitreview/migrations` no tests). Also
  `bun test packages/git-ipc/src` only if a mirror finding needs the TS side exercised. If
  missing deps or bindings fail a check: `bun install --frozen-lockfile` and `bun run setup` (or
  `sh scripts/prepare-worktree.sh`). A red check is a finding.

## 2. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `73c7f40`. **Part 15: no drift.** 98 files, 15,176 code lines,
7,563 test lines, same as `f40cd35`. `git log f40cd35..HEAD` on the seven package paths is empty.

Drift elsewhere since `f40cd35`, none touching a Part 15 file:
- Part 2: 145 to 148 files, 19,684 to 20,159 lines (Part 2 fixes).
- Part 3: 138 to 142 files, 26,401 to 27,722 (tests 8,115 to 8,677; Part 3 fixes).
- Part 8: 16,274 to 16,328 (`internal/sqlitex/reindex.go`, Part 2's fix).
- Part 14: 134 to 135 files, 16,073 to 16,275 (tests 8,546 to 8,691; Part 14 fixes).
- Part 16: 18,789 to 18,773 (Part 14 fixer edits to `gitsession/{queries,remote}.go`, P166/P167).
- Part 20: 20,140 to 20,312 (tests 4,590). Part 21: 17,275 to 17,327. P166/P167 fixes.
- Totals: streams A 255,934, B 182,504; 2,876 owned, 0 orphans, 3,506 tracked (docs 477).

## 3. Own file set (98 files)

59 production files (7,613 lines, incl. 3 SQL migrations, 51 lines), 39 `_test.go` (7,563).
Production lines per package:

- **`PI/gitpreflight`** (2,429; 12 files): `stack` 656, `worktree` 216, `operation` 215, `stash`
  191, `status` 189, `pull` 188, `checkout` 178, `reset` 149, `push` 130, `cherrypick` 112,
  `revert` 108, `undo` 97. No test for `status.go`, `undo.go`.
- **`PI/gitops`** (1,280; 16 files): `errors` 211, `stash` 179, `push` 170, `conflict` 154,
  `progress` 138, `remote` 67, `stack` 67, `branch` 64, `checkout` 47, `worktree` 43, `tag` 31,
  `pull` 30, `fetch` 28, `revert` 19, `cherrypick` 17, `reset` 15.
- **`PI/gitreview`** (1,640; 15 files): `store` 456, `resolve` 221, `comments` 152, `reaper` 129,
  `project` 128, `export` 104, `normalize` 100, `ranges` 99, `db` 75, `snapshot` 63, `migrate` 34,
  `migrations/{0001_g11_review,0002_g13_comments,0003_p150_pin}.sql`, `migrations/embed.go`.
  `main_test.go` is P154's `testx.RunWithTempHomes`.
- **`PI/gitsearch`** (920; 6 files): `dialect` 300, `scan` 225, `literal` 158, `query` 121,
  `matcher` 70, `doc` 46. `scan_test.go` and `differential_test.go` spawn real git.
- **`PI/gitprepare`** (722; 4 files): `output` 335, `runner` 186, `script` 135, `doc` 66.
- **`PI/gitstore`** (382; 5 files): `encode` 141, `store` 99, `pack` 87, `intern` 40, `sha` 15.
  No test for `store.go`, `intern.go`, `sha.go`.
- **`PI/oplog`** (240; 1 file): `log.go`.
- Excluded: `PI/gitwire/**` (generated from `packages/git-ipc/schema/gitwire.fbs`).

## 4. One hop: callers (git grep of import lines)

Production importers, symbol level:

- **`gitpreflight`**: `gitops/conflict.go` (own chunk: `InProgressStateFiles`, `InProgressKind`);
  `gitsession/{cache,entry,ops,preflight,remote,stack,status,worktree}.go` (every classifier,
  `UndoSlot`, `UndoPolicy`, `UndoRecord`, `StackListResult`, `RestackPreflight`,
  `MaxStackedBranches`, `DirtyPaths`); `gitrpc/{refs,remote,reset,stack,stash,wire,worktree}.go`
  (preflight result types, `CherryPickPreflight` in `reset.go`). `gitsock` imports it in tests only.
- **`gitops`**: `gitsession/{autofetch,gh,ops,preflight,queuefacts,remote,stack,stash,status,
  worktree}.go` only. `ClassifyOpError` 31 call sites (`ops.go`, `stack.go`); `ContinueArgs`/
  `AbortArgs` 2 each, `SkipArgs` 3 (`ops.go`); `RebaseOntoArgs` (`stack.go:826`);
  `PushArgs`/`ForcePushArgs` (`remote.go`).
- **`gitreview`**: `gitsession/{comments,entry,ghsync,incremental,queuefacts,registry,review}.go`
  (`Store`, `FileRecord`, `LineRange`, `ProjectRanges`, `ResolveBase`, `Union`/`Subtract`/
  `Expand`/`CountLines`, `MaxSnapshotBytes`, `ContentText`/`ContentTooLarge`); `registry.go:109`
  `NewStore(DefaultPath())`, `registry.go:309` `Close`; `gitrpc/{review,wire}.go`;
  `ade/ghsync.go:211` `SetObserver(onReviewChange)`, `ade/review.go:115,189,193` `SetPinned`,
  `Purge`. `gitsock` in tests only.
- **`gitsearch`**: `gitsession/search.go` (`Compile`, `Scan`, `Deps`, `Options`),
  `gitrpc/search.go` (`Query`, `Result`, `DefaultLimit`, `ErrUnsupportedPattern`,
  `ErrInvalidPattern`).
- **`gitprepare`**: `gitsession/worktree.go` (`NewOSRunner`, `Spec`, `Vars`,
  `DefaultPrepareTimeout`, `Line`); `ade/{board,deploy,runs,setup}.go` (`Runner`, `Spec`, `Vars`,
  `BuildEnv`, `IsExecutableFile`, `Line`); `adeagent/process.go:94-95` (`ResolveShell`,
  `IsExecutableFile`, `BuildArgv`); `ade/runs.go:494` hands `BuildEnv` output to `adeagent`.
- **`gitstore`**: `gitsession/walk.go` (`New`, `Store`), `gitrpc/graph.go` (`EncodeChunkFrame`,
  `PackedChunk`). `gitsock/graphstream_test.go` imports `gitwire` in tests.
- **`oplog`**: `gitsession/{entry,oplog,registry,remote}.go` (`Op`, `Log`, `Meta`, statuses),
  `bridge/{events,ops}.go` (`Log`, `Record`), `main.go:559` (`oplog.New`). TS consumer:
  `workbench/src/state/createOpLogStore.ts` via Space `frontend/src/state/ops.ts`.
- **Drift from pre-plan §5.14's caller list:** `gitsock` imports Part 15 packages in tests only.
  `bridge` and `main.go` (oplog) are callers the pre-plan omits. `adeagent` imports `gitprepare`
  (confirmed). `gitrpc` confirmed.

## 5. One hop: callees

- **Part 14 (closed, fixes landed):** `gitpreflight` imports only `porcelain` (`RefRow`,
  `RefTrack`, `StashEntry`, `StatusResult`, `StatusBranchInfo`, `LeftRightCountArgs`,
  `ParseLeftRightCount`). `gitreview` imports `porcelain` (`DiffHunk`, `LineContext`, `RefRow`)
  and `gitpath.NFC`. `gitsearch` imports `gitclient` (`Runner`, `Spec`, `Process`, `Run`,
  `Classify`) and `porcelain` (`LogScanArgs`, `RecordSplitter`, `FieldGrouper`, `ScanFieldCount`,
  `ParseScanRecord`). `gitstore` imports `porcelain` (`CommitRecord`, `DecorationRef` and kinds).
  **`gitops` imports no Part 14 package** (only `gitpreflight`); its argv reaches git through
  `gitsession`. `gitclient` names in `gitops/{errors,fetch,progress}.go` and
  `gitpreflight/status.go` are comments.
- **Root `internal/*` (Part 8, unreviewed, §0):** `sqlitex` (`Open`, `Migrate`,
  `LoadMigrations`, `MigrationSource`) in `gitreview`; `procgroup` (`Kill`, `GracefulCancel`) in
  `gitprepare/runner.go:74,103`; `notify.Emitter`, `kiratime.NowISO` in `oplog`; `testx` in tests.
- **Drift from pre-plan callee list:** `gitreview/db.go:18,32` imports Space `config`
  (`KiraSpaceHome`, `EnsureLayoutAt`; Part 22, later, same stream). `procgroup` (Part 8) is a
  callee the pre-plan omits. `gitstore` imports `github.com/google/flatbuffers/go` and `gitwire`.
- External: `git`, the user's login shell (`gitprepare`), modernc SQLite, flatbuffers.

## 6. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. Security first: `gitprepare` runs a
shell; `gitops` builds argv that writes to repos and remotes; `gitreview` stores user content;
`gitsearch` compiles user patterns; `oplog` displays argv to every window.

### 6.1 `gitprepare` (shell spawn, security)

- Trust boundary. `doc.go` says the confirmation and sha256 staleness guard live in the VS Code
  extension and `gitsession.RunPrepare`. ADE (`ade/setup.go:327`, `deploy.go:38`, `runs.go:552`)
  and `adeagent` also spawn through this package. Check which guard, if any, covers ADE's scripts
  (repo-supplied workflow or setup text?) and whether `doc.go`'s "one place ... spawns a shell"
  claim is still true. A stale safety doc is a finding when a caller relies on it.
- `osRunner.Run` sets `cmd.Env = spec.Env`: a nil `Env` inherits the whole parent env, askpass
  token included. Check every caller passes `BuildEnv` output.
- `scrubbedEnvKeys` (14 names) versus keys it misses: `GIT_CONFIG_PARAMETERS`,
  `GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`, `GIT_NAMESPACE`, `GIT_EXEC_PATH`, `GIT_SSH_COMMAND`,
  `GIT_PREFIX`, `GIT_QUARANTINE_PATH`. Judge by effect on a script's own `git` calls.
  `ade/runs.go:494` feeds `BuildEnv` to the agent: `KIRA_PREPARE=1`, `TERM=dumb` there.
- `BuildArgv`/`ResolveShell`: `$SHELL` unset, relative, non-executable, a `fish`/`nu` shell that
  rejects `-l -c`; script text with NUL (exec fails), leading `-`.
- Process lifecycle: `Setsid` plus `GracefulCancel`; immediate group SIGKILL after Wait on
  timeout/cancel (P108 Part 15 F8); `ErrWaitDelay` path (F7); `cmd.Start` failure.
- `outputCollector`: `close(tickerDone)` does not wait for an in-flight `tick()`, so a tick's
  `onBatch` may run after `flush`, out of order or after `Run` returns (`Spec.OnBatch` doc says
  never). Ticket ordering via `deliverCond`; a panicking `onBatch` leaves later tickets blocked.
  Caps: 256 KiB / 500 lines retained, `maxUnterminatedBuf`, a line of only ANSI, invalid UTF-8 cut
  mid-rune at the cap, CR-only progress output, OSC terminated by BEL versus ST, a CSI never
  terminated.

### 6.2 `gitops` (argv tables, op semantics)

- **Continue/abort/skip table** (`conflict.go:99-154`) against real git per state: merge
  (`merge --continue` with unresolved paths; with `MERGE_MSG` and `GIT_EDITOR=true`), cherry-pick
  and revert sequences (single and multi-commit, `sequencer/` with `*_HEAD` gone after a skip),
  rebase merge backend versus apply backend, plain `git am` sharing `rebase-apply/` (is it
  classified as rebase, and does `rebase --abort` on an `am` session do the right thing?), bisect
  (`bisect reset` only), `unmergedOnly`. `readSequencerTodoKind`: abbreviated verbs (`p`), `exec`,
  CRLF, a comment-only todo.
- `ReadInProgressStateFiles` reads `gitDir` never `commonDir`: linked worktrees, a `gitdir:` file
  worktree, a bare repo.
- **Argument injection.** About 60 builders take caller strings. A value starting with `-` is an
  option unless it sits after `--` or is rejected first. `gitsession.validOpArg`
  (`ops.go:40`) rejects `""` and leading `-` for the fields it is applied to; map every builder
  parameter to a guard or prove it unguarded and reachable: remote names (`PushArgs`, `FetchArgs`,
  `DeleteRemoteBranchArgs`, `RemoteGetURLArgs`, `RemoteTipArgs`), `RebaseOntoArgs` onto/upstream
  from `branch.<b>.kirastack*` config (user-editable), `StackConfigSetArgs` key/value,
  `WorktreeAdd*Args` paths, `TagCreateArgs` message, `CommitTreeArgs` message,
  `StashStoreArgs` message, `ResetArgs` target, `RevertArgs`/`CherryPickArgs` shas.
- **Partial failure and atomicity.** `runWriteArgvList` runs argv lists under one `Repo.Write`
  (F12): auto-stash then switch fails (stash left, message appended); undo replay lists
  (branch ref plus config writes) failing mid-way; `GlobalStashSetArgs`/`DeleteArgs` old-value
  CAS; tag create plus undo; `CommitTreeArgs` plus `StashStoreArgs` sequences.
- Stash: `StashPushArgs` `:(literal)` pathspecs, `-u` with ignored files, `-m` text with a newline
  (stash list is one reflog line per entry), index-based ops (`stash@{n}`) racing another window's
  stash change (index shifts between preflight and run).
- Push/fetch: `--force-with-lease --force-if-includes` without an explicit lease, protected-branch
  match on the remote name (P108 Part 15 F1, fixed caller-side), `--porcelain` parse
  (`ParsePushPorcelain`: `!` rejects, `=` up to date, `*` new, `-` deleted, hook-declined text,
  no porcelain block on auth failure), `ExtractRemoteMessage` with hostile `remote:` lines.
- `ClassifyOpError`/`ClassifyRemoteError`: substring rules on stderr containing user-controlled
  text (hook output, commit subjects, paths) beyond the F4 conflict anchor; rule order.
- `ProgressParser`: `\r` frames, phase text with `:`, percent over 100, `maxBufferedLine`,
  `remote:` prefixed progress.

### 6.3 `gitpreflight` (prediction versus actual outcome)

- Each classifier's verdict versus what git then does. Cherry-pick (probe 7 rules, merge commit
  mainline, `alreadyApplied`), revert (prediction only for `Shas[0]`, `PredictedFor`; a clean
  verdict when a later sha conflicts), reset (`--keep` with dirty overlap), pull (strategy
  precedence incl. `pull.rebase=merges`/`interactive`, boolean synonyms per F6, `pull.ff=only`),
  push (no upstream, gone upstream, protected), checkout (rewritten-path intersection, case-only
  renames on a case-insensitive FS, submodules, sparse checkout), stash pop/apply/branch,
  worktree add/remove (`ConfirmToken` = `filepath.Base` of a trailing-slash path or `/`).
- Conflict classification: `merge-tree` prediction (in `gitsession/preflight.go`) on a root commit
  (`sha^1` missing), on binary or rename/delete conflicts, `unknown` folding into verdicts.
- `InProgressOperation` precedence when several state files coexist (stale `MERGE_HEAD` plus
  `rebase-merge/`), and the UI gates `CanContinue/CanAbort/CanSkip` versus gitops' second line.
- Stacks (`stack.go`, 656 lines): cycles, dangling parents, `MaxStackedBranches` budget, base
  resolution against remote-tracking refs, restack plan cascade, `checkedOutElsewhere` reporting
  only the first branch, a dirty tree with an empty plan, deterministic ordering.
- `UndoSlot`: replay of an absolute ref write after another window moved the ref; `Take` id race.

### 6.4 `gitreview` (storage, schema, sync)

- **Store lifecycle.** `Close` (`store.go:87-104`) releases `openMu` while waiting for the reaper;
  a second concurrent `Close` sees `reapStop` still set and closes it again (panic?). A `conn()`
  after `Close` reopens the DB and starts a reaper nobody stops (shutdown at `registry.go:309`
  with requests in flight). `conn()` returns a `*sql.DB` that `Close` may close under the caller.
- **Schema and migrations** (`review.db`, separate from `kira.db`, opened with `sqlitex.Open`, not
  `appstorage`): 0001-0003 ordering, `SchemaTooNewError` from a newer build (every review call
  then fails; no startup classification like `kira.db`), `migrate` plus `normalizeStoredPaths`
  run on every lazy open, startup `sweepDB` failure making the store unopenable each call.
- `normalizeSessionRepoIDs` `UPDATE OR REPLACE`: does SQLite run `ON DELETE CASCADE` for the row
  REPLACE deletes (probe), and which row's `pinned` survives a collision.
- **Snapshot storage.** `Compress`/`Decompress` (`snapshot.go`): `io.ReadAll` on a flate stream
  with no bound before the length check (a corrupt row decompressing to gigabytes);
  `MaxSnapshotBytes` 1 MiB enforcement on write; `content_kind` versus NULL content consistency.
- **Content-based since-review diff.** `ProjectRanges` arithmetic (`project.go`): zero-length
  hunks (`@@ -5,0 +6,2 @@`), deletion-only hunks, ranges beyond EOF, `newLineCount` 0, last line
  without newline, CRLF. `Normalize`/`Union`/`Subtract` on adjacent, overlapping, inverted ranges.
  Callers in `gitsession/incremental.go` (Part 16) read only for blast radius.
- **Viewed-state sync.** `Put`/`Delete` notify the observer after commit, synchronously, while the
  caller holds `Store.Lock`. `Delete` notifies `"deleted"` even when no row existed;
  `ade.onReviewChange` then queues a GitHub unmark. `Purge`, the sweep and `ClearComments` never
  notify. Check both directions against `ade/ghsync.go:214-245`.
- `upsertSession` `ON CONFLICT` plus read-back; `keyedMutex` refcount; `Touch` never creating;
  `SetPinned` creating a session; `Purge` versus pinned; `Branches`.
- Comments: anchor fields, `FormatComments` output (Markdown/prompt injection from bodies and
  paths if exported into an agent prompt), `RemoveComment` cross-session id.
- `resolve.go`: `findRef` ambiguity (local branch named `origin/x`), upstream gone, detached HEAD.
- **Test isolation (P154).** `gitreview/main_test.go` uses `testx.RunWithTempHomes`. Confirm no
  Part 15 test reaches `DefaultPath()` or the real `$HOME`/`~/.gitconfig`: `gitsearch` tests spawn
  real git without a `TestMain`; `gitprepare`, `gitops`, `gitpreflight` tests use fakes (verify).

### 6.5 `gitsearch`

- Cancellation: `readScanChunk` returns on `ctx.Done()` after `proc.Close()`; the reader goroutine
  blocked in `Read` (leak?); `Walk.Search` supersede (`searchGen`).
- Budget: `DefaultScanBudget` 5 s checked per chunk or by timer? A git child that emits nothing for
  a long time (huge repo, slow pack) must still stop at the budget.
- Protocol-error paths (`scan.go:122-129`) `Close` without `Wait`, and report the partial record
  before git's own stderr. Part 14 reordered `logsession.finishEOFLocked` the other way (git's
  failure outranks the partial record); check consistency.
- Pattern handling: `translate` JS-to-RE2 (`\s`/`\d`/`\w` Unicode semantics, `\b` around
  non-ASCII, `$`/`^` with newlines in bodies, `(?i)` fold versus JS `i` incl. Kelvin sign, named
  groups, `\u{...}`, lookaround rejection), literal fold path, whole-word boundaries, sha-prefix
  arm. No user text reaches argv (`Options.Args` is `LogScanArgs(spec)`); confirm, incl. pathspec.
- Huge repos: hits cap 200 versus exact `Total`, memory per record, `RecordSplitter` remainder cap.

### 6.6 `gitstore` and the git wire mirror

- `hexToBytes` panics on a malformed sha (`sha.go:9-15`), on the stream goroutine: crash the app?
  Reachability from `porcelain.CommitRecord` (Part 14 parser) incl. SHA-256 repos.
- `shaWidth` fixed by the first record (`store.go:17`): a later record of another width.
- No eviction: memory over a 1M-commit walk; `Clear` versus `Interner` ids and `DictionaryBase`
  across chunks; `subjectOffsets` uint32; `clampTimestamp` negatives.
- **Mirror:** `EncodeChunkFrame` against `graphChunkCodec.ts` `fromWire` and `gitwire.fbs`: field
  order, little-endian uint32 columns, decoration kinds, `From`/`To`, dictionary deltas, empty
  chunk, `estimateChunkSize` underestimate (builder growth).

### 6.7 `oplog`

- Emit outside the lock (`Start` `log.go:91-93`, `Finish` `203-205`): two snapshots of one op can
  reach subscribers out of order (a `running` snapshot after `ok`); check `AddCommand`/`SetCancel`
  emits and `createOpLogStore` merge rules.
- Ring eviction of a still-running op: later `Finish` emits a record no longer in `Recent`;
  `cancels` entry lifetime.
- `Cancel` runs the registered func under `l.mu`; a func that re-enters the log deadlocks. Check
  every `SetCancel` func in `gitsession`.
- `AddCommand` renders argv verbatim to every window: URLs with userinfo (`remote add`/`set-url`,
  push to a URL), tokens; `maxCommandBytes` cut mid-rune; `quoteArg` of newlines and control bytes.

## 7. Part 14 contract changes the callers must handle

Part 14 fixes (`7b44882`..`73c7f40`) changed behaviour Part 15 consumes. Check callers still hold:

- **`porcelain.WalkArgs` now ends with `--`** (`ca85fab`). `LogScanArgs` therefore ends with `--`.
  `gitsession/search.go:62` passes it as-is to `gitsearch.Scan`; confirm nothing appends a rev or
  option after it, and `gitsearch` conformance/differential tests still assert the real argv.
- **`ParseRefRows` NUL-frames every field** (`3137ce5`); `RefRow` shape unchanged. `gitreview/
  resolve.go` and `gitpreflight/stack.go` consume parsed `RefRow`s only; check their tests'
  hand-built rows still match real parser output (worktree path with a newline).
- **`ParseShowBodyAndSignature` NUL-delimited** (`97d444b`); `ParseInventory` NUL-framed. No Part 15
  package calls them directly; note any Part 15 assumption about body text that changed.
- **`catfile`**: `ErrInvalidRev` for revs with a newline, cancellation now returns `ctx.Err()` via
  `failOrCancel`, `ReadOneShot` pins the OID first. No Part 15 package imports `catfile`; the
  review snapshot reads in `gitsession` (Part 16) do. Report a Part 15 contract that depends on
  the old behaviour (e.g. a snapshot `BlobOID` taken from a different resolution than content).
- **`gitclient.ResolveHead`** now fails on a non-1 verify exit instead of reporting unborn;
  `gitpreflight/status.go` names it in comments only; check `SummarizeStatus` inputs.
- **`color.diff=false`** in `configOverrides` (`d5fa91e`) and `--no-color` on patch builders: no
  Part 15 parser reads coloured output; confirm `gitops` progress/porcelain parsers do not depend
  on a user's colour config either.
- **`logsession.finishEOFLocked`** ordering (git failure before protocol error): §6.5 consistency.

## 8. What earlier fixes already changed (do not re-report)

- **P166/P167 fixes edited no Part 15 file.** `git log f40cd35..HEAD` on the seven paths is empty.
  (`743af03` sits behind the shallow boundary for `git log`; `git diff 743af03 HEAD` works.)
- **P143-P165 feature churn (165 lines, the pre-plan's figure), reviewed by P166/P167 as feature
  code:** `gitprepare/runner.go` (`PrepareTimeout` const replaced by required `Spec.Timeout`,
  `DefaultPrepareTimeout`; P145 F2) and its tests; `gitreview/db.go` (`EnsureLayoutAt(dir of
  s.path)`, P154); `gitreview/main_test.go` (new, P154); migration `0003_p150_pin.sql` plus
  `embed.go`; `reaper.go` (`sweepDB` and `Purge` skip pinned); `store.go` (`ReviewChange`,
  `SetObserver`/`notify`, `SetPinned`, notify after `Put` commit and after `Delete`) and its test.
  New code here is in scope; report only a real failure scenario.
- **Part 14 (P168) fixes:** §7. Do not re-report anything in Part 14's own files; route a Part 14
  regression with `needs-other-part-file`.
- `docs/v2.0/plans/P16{6,7}-code-review.md` are gone (fixed). Nothing to skip.
- **P108 Part 15 fixes are in code:** F1 (protected-branch gate on the remote branch,
  `gitsession/remote.go:323,696`), F2/F3 (sequencer todo kind, rebase-apply head-name fallback),
  F4 (`hasConflictLine` anchored first), F5 (`regexp.QuoteMeta` in `PullConfigArgs`), F6 (pull
  boolean synonyms, `ResolveRebaseMerges`), F7 (`ErrWaitDelay` keeps the transcript), F8 (group
  SIGKILL after timeout), F9 (refless stacked parent becomes an orphan). G32 round-3 #6 (review
  paths never NFC-rewritten). Verify they hold; do not re-report them as new.

## 9. Unverified candidates

Leads from planning, **not findings**. Each needs a real scenario, a probe or a code read before
it is reported. Drop any that does not hold; say so in the coverage notes.

1. `gitreview.Store.Close` double-close panic: openMu released while `reapStop` still non-nil
   (`store.go:87-97`).
2. `gitreview` reopen after `Close` starts an orphan reaper (`db.go` `ensureOpen`).
3. `Store.Delete` notifies `"deleted"` with zero rows affected (`store.go:389-394`), triggering a
   spurious GitHub unmark in `ade.onReviewChange`; observer runs under `Store.Lock`.
4. `normalizeSessionRepoIDs` REPLACE: cascade or orphaned `review_file` rows; pin lost.
5. `Decompress` unbounded `io.ReadAll` before the length check (`snapshot.go`).
6. `review.db` `SchemaTooNewError` handling: every review RPC fails with an opaque error.
7. `gitsearch.Scan` protocol-error paths skip `Wait` and mask git's stderr (`scan.go:122-129`).
8. `gitsearch` budget only checked between chunks (stall past 5 s).
9. `gitprepare` tick after flush: `onBatch` after `Run` returns (`runner.go:113-130`).
10. `gitprepare` nil `Spec.Env` inherits the askpass token; scrub list gaps (`script.go:62-77`).
11. `gitprepare` doc safety claims stale since ADE and `adeagent` became callers.
12. `gitops` builders without `--` reachable with a dash-leading remote or stack-config value
    (`RebaseOntoArgs` from `kirastack` config, remote names).
13. `gitops` `rebase --continue`/`--abort` on a plain `git am` session classified as rebase.
14. `gitops` stash `-m` message with a newline corrupting stash list parsing (caller guard?).
15. `gitstore.hexToBytes` panic reachable; mixed `shaWidth`.
16. `oplog` out-of-order emits; evicted running op; `Cancel` under lock; secrets in rendered argv.
17. `ClassifyRestack` reports only the first `checkedOutElsewhere` branch (`stack.go:623-628`).
18. `ClassifyWorktreeRemove` `ConfirmToken` for `/` or a trailing-slash path.
19. Revert verdict `clean` for a multi-sha revert whose later sha conflicts.
20. `ProjectRanges` zero-length or deletion-only hunks at file end.

## 10. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, one pass, in this block order** (process spawn and argv first, so classifiers and
  stores read against known spawn behaviour). About 7.6k production lines plus 7.6k test lines;
  read tests only where they are the sole guard of a claim.
  1. **`gitprepare`:** `runner.go`, `script.go`, `output.go`, `doc.go`; callers
     `gitsession/worktree.go` `RunPrepare`, `ade/{setup,deploy,runs}.go`, `adeagent/process.go`.
  2. **`gitops`:** `conflict.go`, `errors.go`, `progress.go`, `push.go`, then the remaining
     builders; caller `gitsession/ops.go` (`opTable`, `RunOp`, `runWriteArgvList`, `validOpArg`),
     `remote.go`, `stack.go:813-860`. Real git probes for the continue/abort/skip table.
  3. **`gitpreflight`:** `operation.go`, `status.go`, `checkout.go`, `cherrypick.go`, `revert.go`,
     `reset.go`, `pull.go`, `push.go`, `stash.go`, `worktree.go`, `undo.go`, `stack.go`; caller
     `gitsession/preflight.go`.
  4. **`gitreview` store:** `db.go`, `migrate.go`, `migrations/**`, `store.go`, `reaper.go`,
     `snapshot.go`, `normalize.go`, `comments.go`, `export.go`; callers `ade/{ghsync,review}.go`,
     `gitsession/registry.go`.
  5. **`gitreview` logic:** `ranges.go`, `project.go`, `resolve.go`; caller
     `gitsession/incremental.go` for blast radius.
  6. **`gitsearch`:** `scan.go`, `query.go`, `dialect.go`, `literal.go`, `matcher.go`; caller
     `gitsession/search.go`.
  7. **`gitstore` and mirror:** `store.go`, `intern.go`, `sha.go`, `pack.go`, `encode.go` against
     `packages/git-ipc/src/graphChunkCodec.ts` and `schema/gitwire.fbs` (Part 17, read).
  8. **`oplog`:** `log.go`; callers `gitsession/oplog.go`, `bridge/{events,ops}.go`,
     `createOpLogStore.ts`.
  9. **Tests and §7:** confirm the guard claims cited in findings and the Part 14 contract checks;
     report a test that no longer guards what its name says, a test leaking out of P154
     isolation, or a missing guard for a genuinely complex rule (`CLAUDE.md` unit-test bar).
- **Resumable:** write `docs/v2.0/plans/P168-part15-findings.md` as blocks finish, and commit it
  after **every** block (`docs(v2.0): P168 Part 15 findings, block <n>`; normal commit, hooks
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
- Final commit `docs(v2.0): P168 Part 15 findings`, before any fixer starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 15`, under
  §0's routing (Stream B one-hop callers editable only when a Part 15 contract change requires
  it; Stream A/C files never, routed by the orchestrator to `P168-routed-to-stream-a.md`). A fix
  re-runs `go build ./apps/kira-space/...`, `go vet` and `go test -race` over the seven packages,
  plus `gitsession`, `gitrpc`, `gitsock`, `ade`, `adeagent`, `bridge` when a caller changed. It
  deletes the findings file when done. Chunk lands per pre-plan §3.4 before Part 16's plan starts.

## 11. Out of scope

- `gitsession` logic (Part 16): `incremental.go`, `preflight.go`, `ops.go`, `worktree.go`,
  `search.go`, `walk.go` are read only to size a finding or prove an input is guarded.
- Part 14 packages (`gitclient`, `porcelain`, `catfile`, `logsession`, `ghclient`, `gitaskpass`,
  `gitpath`), closed: report only a Part 15-visible break, tagged.
- `gitrpc`/`gitsock` validation and `git-ipc` (Part 17), `git-core` search/store twins (Part 18),
  ADE (Part 20), Space `config` (Part 22).
- Root `internal/*` beyond the contract Part 15 depends on (Part 8, §0 tag rule).
- Generated `gitwire`, docs, excluded files (pre-plan §6).
