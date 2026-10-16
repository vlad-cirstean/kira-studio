# P168 Part 14: review plan, Space git process layer

Chunk B1, Stream B position 1 of 10 (pre-plan `P168-prep-plan.md` §5.13). One Opus reviewer runs
this plan and reports findings. It fixes nothing. One Sonnet fixer follows (§8).
Tree surveyed: `fbf725e` (`p168-stream-b`, equal to current `v2.0` tip).

Paths repo-relative. `PI` = `apps/kira-space/internal`. `GC` = `PI/gitclient`. Line numbers are
as of `fbf725e`; re-read before citing.

SPEC row names this file `P168-part14-git-process.md`; the orchestrator named it
`P168-part14-space-git-process.md`. Same plan, this name wins.

## 0. Gates waived, and what that means for findings

User decision for this stream: gates G0 and G1 (pre-plan §3.2) are **waived**. Stream B starts
now, before Part 8 (shared Go base, Stream A) is reviewed or landed. Consequences:

- Root `internal/*` callees (`toolexec`, `procgroup`, `localsock`) are **unreviewed callees**.
  Read them as far as a Part 14 contract depends on them. A bug inside them is still a valid
  finding when it breaks a Part 14 caller.
- **Any finding whose fix must edit a Stream A file** (root `internal/**`, `scripts/**` except
  the two VS Code scripts, root config, `packages/{workbench,theme,kira-ui,shared,api-core}`)
  carries the tag `needs-stream-A-file: <path>`. The Stream B fixer does not edit it. The
  orchestrator routes it to Stream A (pre-plan §3.3).
- One-hop callers in Stream B files (Parts 15-22) are editable by this chunk's fixer (same
  stream, sequential) when a Part 14 contract change requires it.

## 1. Method for the reviewer

- **`codegraph_explore` first, mandatory.** Load it with `ToolSearch "codegraph"`, then call it
  with `projectPath=/home/user/kira-studio-streamB` before any Read/Grep on a symbol, call-path or
  blast-radius question. The orchestrator greps the run's tool log for real calls. Index: run
  `sh scripts/codegraph-setup.sh` in the worktree if `.codegraph/` is missing (built at `fbf725e`
  for this plan). Seeds:
  - Spawn seam: `Spec`, `Runner`, `Run`, `execRunner.Start`, `startStreaming`, `startBuffered`,
    `execProcess` `Wait`/`Close`/`drainStderr`, `killAndWait`, `buildEnv`, `buildArgv`,
    `stripEnvKeys`, `configOverrides`, `hygieneEnv`, `gitRedirectEnvKeys`, `boundedWriter`.
  - Gate and identity: `Repo` `Read`/`Write`/`Writing`/`notifyLocked`, `Identify`,
    `WorktreeIdentity`, `ResolveHead`, `revParseLine`; `Discovery` `Status`/`Locate`,
    `capabilities.go`, `Classify` (`errors.go`).
  - `catfile`: `persistentProcess` `ensureStarted`/`request`/`requestPipelined`/`fail`/`drop`/
    `close`, `watchCtx`, `Session` `Check`/`CheckMany`/`Read`/`CheckOneShot`/`ReadOneShot`,
    `readHeader`, `readContent`.
  - `logsession`: `Session` `Next`/`fillLocked`/`finishEOFLocked`/`spawnOrResumeLocked`/
    `snapshot`/`countTotal`/`Remaining`, reclaim timer (`disarmReclaimLocked`).
  - `porcelain`: `RecordSplitter`, `FieldGrouper`, each `*Args` builder and `Parse*` function.
  - `ghclient`: `execRunner.Run`, `buildEnv`, `Discovery`, `classify`, `commonArgv`, `graphql`,
    `graphqlArgv`, `PullFiles`, `SetFilesViewed`, `viewedMutation`, `ParseRemote`, `Repo.Path`.
  - `gitaskpass`: `New`, `buildShim`, `shellQuoteSingle`, `Env`, `WithOp`, `handleConn`,
    `RunHelper`, `exchange`, `lookupEnv`, `ShouldInterpose`; callers
    `gitsession.RepoEntry.withAskpass`, `coreAskPass`, `repoPrompter`, `main.go` argv shim.
  - Watchers: `RepoWatcher` `run`/`emit`/`Close`, `classify`, `resolveOrKeep`, both backends.
- **CodeGraph over-links names.** `Run`, `Start`, `Read`, `Classify`, `Spec`, `buildEnv`,
  `RecordSplitter` also exist in `ghclient`, `gitprepare`, `adeagent`, `startupfail`, Studio
  adapters and `packages/git-core` (`nulSplit.ts`). Confirm every cross-package claim with
  `git grep` of import lines. Go's `internal/` rule makes those authoritative.
- **Real git 2.43.0 probes** (`/usr/bin/git`) in a scratch repo under the session scratchpad,
  for every parser claim that depends on git's output shape. Never assume a shape. `gh` is at
  `/usr/local/bin/gh` but unauthenticated: probe `gh` argv and error text only, never a real API
  call.
- **Vendored source** where a claim turns on library behavior: Go 1.27.1 `os/exec`
  (`WaitDelay`, `Cancel`, `*Pipe()` versus direct `io.Writer`), `context.AfterFunc` stop
  semantics, `fsnotify v1.10.1`, `fsevents v0.2.0`, `golang.org/x/text v0.42.0` `norm`.
- **Scratch probes** in the scratchpad or a throwaway `_test.go` deleted before the findings
  commit, never committed.
- **Checks:** `go vet` and `go test -race -count=1` over
  `./apps/kira-space/internal/{gitclient,ghclient,gitpath,gitaskpass}/...`. Both clean at
  `fbf725e` (7 packages ok). `watcher_fsevents_darwin.go` is darwin and cgo only: review by
  reading, plus `GOOS=darwin go vet` if it builds without cgo, else note it as unverified. If
  missing deps or bindings fail a check: `bun install --frozen-lockfile` and `bun run setup` (or
  `sh scripts/prepare-worktree.sh`). A red check is a finding.

## 2. Ownership re-run (pre-plan §8) and drift

Re-ran the §8 script verbatim at `fbf725e`. **Part 14: no drift.** 134 files, 16,073 code
lines, 8,546 test lines, same as `f40cd35`.

Drift elsewhere since `f40cd35`, none touching a Part 14 file:
- Part 2: 145 to 148 files, 19,684 to 20,159 lines (Part 2 fixes, Stream A).
- Part 8: 16,274 to 16,328 lines (`internal/sqlitex/reindex.go`, Part 2's fix).
- Part 16: 18,789 to 18,792. Part 20: 20,140 to 20,312 (tests 4,585 to 4,590). Part 21:
  17,275 to 17,327. All from P166/P167 fixes.
- Totals: streams A 254,613, B 182,321; 2,871 owned, 0 orphans, 3,500 tracked (docs 476).

Since Part 3's plan (`e6691b2`): Part 20 moved again (20,207 to 20,312) and Part 21 (17,275 to
17,327), from P167 fixes now on `v2.0`.

## 3. Own file set (134 files)

46 production `.go` files (7,527 lines), 34 `_test.go` (8,546), 54 testdata files. Production
lines per package:

- **`GC`** (2,046; 10 files): `runner.go` 597, `repo.go` 315, `discovery.go` 291,
  `watcher.go` 274, `watcher_fsnotify.go` 182, `watcher_fsevents_darwin.go` 152, `errors.go` 121,
  `capabilities.go`, `client.go`, `clock.go`.
- **`GC/porcelain`** (2,833; 18 files): `stash` 379, `diff` 359, `log` 291, `refs` 264,
  `difftree` 223, `status` 190, `records` 174, `show` 141, `inventory` 118, `blame` 113,
  `worktree` 111, `mergetree` 102, `containment` 51, plus `refsnapshot`, `reset`, `review`,
  `types`, `workingdiff`. 40 `*Args` builders. New since P108 Part 14: `inventory.go` (P129),
  `containment.go` (P143-P165 scope).
- **`GC/catfile`** (503): `batch.go`, `session.go` 438.
- **`GC/logsession`** (459): `session.go`.
- **`PI/ghclient`** (1,186; 9 files): `discovery` 246, `graphql` 212 (new since P108), `pr` 179,
  `runner` 165, `remote` 139, `errors` 107, `api`, `status`, `doc`.
- **`PI/gitaskpass`** (454): `broker` 239, `helper` 137, `interpose`, `prompt`, `wire`.
- **`PI/gitpath`** (46): `gitpath.go` (`CleanNFC`, `norm.NFC`).
- **Testdata:** `porcelain/testdata/{blame,diff,diffTree,handAuthored,keys,log,mergeTree,refs,
  show,stash,status,workingDiff}/**` (`.bin` captures plus a fixture signing key pair),
  `ghclient/testdata/*.json` (3).

## 4. One hop: callers (git grep of import lines, production files)

- **`gitclient`** (27 files): `gitsession/{conn,entry,oplog,ops,queries,queuefacts,refs,registry,
  remote,stack,status,subscriber,walk,worktree}.go`, `gitrpc/{handlers,wire}.go`,
  `gitsearch/scan.go`, `codeworkspace/{enumerate,files,import,session}.go`,
  `bridge/codeworkspace.go`, `ade/{board,rebasecheck}.go` (`Runner`, `GitStatus` types only),
  `main.go` (`wireGit`: `NewExecRunner`, `NewDiscovery`, `NewPlatformLocator`, `NewRealClock`).
  Own subpackages `catfile`, `logsession` also import it.
- **`porcelain`** (38 files): 20 `gitsession` files (`cache, comments, conn, incremental, ops,
  preflight, queries, queuefacts, refs, remote, review, search, stack, stash, status, walk,
  working, worktree`), `gitrpc/{detail,graph,incremental,wire}.go`,
  `gitpreflight/{stash,status}.go`, `gitreview/{project,resolve}.go`,
  `gitstore/{encode,pack,store}.go`, `gitsearch/scan.go`, `codeworkspace/files.go`,
  `ade/{board_facts,gitfacts,integration,review,setup}.go`. `containment.go` builders are called
  only from `gitsession/queuefacts.go` (`CherryArgs`, `ThreeDotDiffArgs`, `LogPatchArgs`,
  `PatchIDArgs` through `pipePatchID`). `InventoryArgs`/`ParseInventory` only from
  `queuefacts.go`.
- **`catfile`** (8 files): `codeworkspace/{diff,session}.go`,
  `gitsession/{entry,ghsync,incremental,ops,queries,stack}.go`. `ReadOneShot`/`CheckOneShot`:
  `codeworkspace/diff.go:75`, `gitsession/incremental.go:178,217,264,268`, `queries.go`.
- **`logsession`**: `gitsession/walk.go`, `gitrpc/graph.go`.
- **`ghclient`** (5 files): `gitrpc/wire.go`, `gitsession/{entry,gh,ghsync,registry}.go`.
  `bridge/github.go` names it in a comment only (reaches it through the gitsession registry).
- **`gitpath`** (12 files, 5 own): `gitreview/normalize.go`,
  `gitrpc/{detail,graph,handlers,search,settings,worktree}.go`; own `GC/repo.go`, `watcher.go`,
  `porcelain/{inventory,refs,worktree}.go`.
- **`gitaskpass`** (5 files): `gitsession/{conn,remote}.go` (`withAskpass`, `repoPrompter`,
  `coreAskPass`), `gitrpc/handlers.go`, `ade/board.go` (`Deps.Askpass`, passed to
  `RunRemote` at `board.go:644,787`), `main.go:66` (argv shim `askpass` before Wails) and
  `main.go:572` (`gitaskpass.New`).
- **Drift from pre-plan §5.13's caller list:** `gitops`, `gitprepare`, `gitvsix` import nothing
  from this chunk. `gitops` builds argv that `gitsession` feeds to `gitclient.Run`
  (`CoreAskPassArgs` and the op argv); `gitprepare` and `adeagent` mirror `ghclient`'s runner
  shape (`procgroup.GracefulCancel`) without importing it. Review them only for that contract.
  `ade` imports `gitclient`, `porcelain`, `gitaskpass`, not `ghclient`. `gitsock` imports
  nothing from this chunk.
- **Caller-side argument guards** a Part 14 builder may rely on: `gitrpc/review.go:19`
  `validRefArg`, `gitsession/ops.go:40` `validOpArg`, `gitpreflight/stash.go:143`
  `validateRefName`. Read them only to decide whether a builder without `--` is reachable with a
  dash-leading value.

## 5. One hop: callees

- **Root `internal/*` (Part 8, unreviewed, §0):** `toolexec.IsExecutable`
  (`GC/discovery.go:90`, `ghclient/discovery.go:51`); `procgroup.Kill`, `procgroup.GracefulCancel`
  (`GC/runner.go:288,342`, `ghclient/runner.go:108,130`); `localsock.Listen`, `Listener`,
  `Options`, `RandHex` (`gitaskpass/broker.go:55,84,86,162`). `testx` in tests only.
- **Drift:** `pathsafe` and `kirapaths` are not imported by this chunk at `fbf725e` (pre-plan
  callee list is wrong on both). Drop them.
- External: user's `git` and `gh` binaries, `fsnotify v1.10.1`, `fsevents v0.2.0` (darwin),
  `golang.org/x/text v0.42.0`, Go `os/exec`.

## 6. Edge cases and failure modes to weight

Freeform: any kind of issue or bug counts. Weight edge cases. Security first: this chunk spawns
processes with caller strings, relays credentials and parses attacker-influenced output (commit
text, ref names, paths, hook and remote stderr, GitHub JSON).

### 6.1 Argument injection and argv construction

- Every `*Args` builder that takes a caller string: refs, revs, paths, remotes. A value starting
  with `-` becomes an option unless it sits after `--` or the caller rejects it. Check each of the
  40 builders plus `catfile` `ReadOneShot` (`cat-file -s <rev>`, `cat-file blob <rev>`) and
  `CheckOneShot` (`rev-parse --verify <rev>`), and `containment.go` (`cherry`, `diff a...b`,
  `log -n N <ref>`), none of which use `--`. Then decide reachability: `git check-ref-format`
  forbids a leading `-` for branch names created locally, but a hostile remote can advertise
  `refs/heads/-x`, and a `<rev>:<path>` path is user data. Trace each to `validRefArg`/
  `validOpArg` or show it is unguarded.
- `configOverrides` precede the subcommand; check nothing caller-supplied lands before them or
  between `-c` pairs. `--no-optional-locks` placement with `ReadOnly`.
- `ghclient`: `--hostname <host>` from a parsed remote URL (`ParseRemote`), REST path and query
  escaping of owner, repo, sha and branch in `pr.go`/`Repo.Path`, GraphQL `-f` versus `-F` (`-F`
  reads `@file`; check every string var goes via `-f`, including `cursor` and paths in
  `SetFilesViewed`), a host beginning with `-`.

### 6.2 Porcelain and plumbing parsing

- NUL-delimited `-z` records and `FieldGrouper` field counts: a field holding 0x1f or LF where
  the format uses them (author/committer/tagger names and emails, stash reflog subjects,
  `for-each-ref` LF framing in `refs`/`inventory`), CRLF subjects, empty subjects and bodies,
  bodies that are all trailers, signed commits (`log.showSignature=false` override), unknown
  `%D` decorations (`grafted`, `replaced`, `HEAD -> ` forms).
- Paths: spaces, leading/trailing whitespace, newlines, non-UTF-8 bytes (`core.quotepath=false`
  emits raw bytes; check where Go converts to `string` and where JSON later mangles invalid UTF-8),
  NFD versus NFC (`gitpath.CleanNFC` on directory paths only), quoted paths in any non-`-z` output
  (`merge-tree --name-only`, `blame`, `diff --git a/... b/...` headers, `cherry`, `patch-id`).
- Renames and copies (`R100`, `C75`, two-path records under `-z`), type changes (`T`), unmerged
  status codes (`DD AU UD UA DU AA UU`), submodules (gitlink `160000` mode, `Subproject commit`
  diff bodies, `status` submodule states), symlinks, mode-only changes, binary and LFS pointer
  diffs, `\ No newline at end of file`, `diff.suppressBlankEmpty` (override present; verify).
- Repo states: unborn branch (no `HEAD` commit; `rev-parse HEAD` fails, `status` `# branch.oid
  (initial)`), detached HEAD, `symbolic-ref --short` ambiguity (`heads/<b>` when a tag shares the
  name), bare repos, linked worktrees (`gitDir != commonDir`), shallow clones, SHA-256 object
  format (`EmptyTreeSHA`, `UncommittedBlameSHA`, 40-hex literals, `isHexSha40`).
- Large output: `RecordSplitter` `maxRemainderBytes` and `ErrRecordTooLarge` recovery; buffered
  `Run` stdout is **uncapped by design** (`runner.go:100-104` comment) for callers that read whole
  outputs (`diff`, `log -p` into `patch-id`, `ReadOneShot`'s second spawn after its size check);
  check each such caller has another bound. `ParseCherry`/`ParsePatchIDs` on huge output.
- Parse-error recovery in streaming consumers: what `logsession` and `gitsearch` leave after one
  bad record (live child, `readCount` drift, splitter remainder, `--skip` resume against a changed
  ref snapshot).

### 6.3 Process lifecycle and cancellation

- `execRunner.Start`: `Setpgid` versus `Setsid`, `GracefulCancel` SIGTERM then SIGKILL, the
  `stopEscalate` timer stopped after exit (pid reuse), `killAndWait` timer, `WaitDelay` reach on
  the buffered path versus the `*Pipe()` streaming path (a hook's `cmd &` grandchild holding
  stdout open), `drainStderr` finishing before `Wait` returns, `OnStderr` never after `Wait`.
- `Close` idempotence and concurrency with an in-flight `Read`/`Write` on the same process
  (`catfile.watchCtx` relies on it), zombies when a caller drops a `Process` without `Wait`,
  stdin pipe left open (`Spec.Stdin`), `cmd.Start` failure after pipes were created (fd leak).
- `catfile` (P143-P165 change): `watchCtx` now uses `context.AfterFunc` with a synchronous stop
  that waits for `Close`. Check: `request` returning nil after `stop()` reports fired (the
  response was fully read, then the process is dropped without `Wait`: zombie or leaked child?);
  `drop` versus `fail` accounting and the circuit breaker (`maxConsecutiveFailures`) reset;
  `requestPipelined` writer goroutine drained on every path; the `ctx.Err()` pre-check;
  persistent processes spawned on the Session's own `spawnCtx`, cancelled by `Close`.
- `catfile` size gate across two processes (TOCTOU on a mutable rev like `HEAD:<path>`;
  `Read` re-checks `batchInfo.Size`), non-`missing` replies (`ambiguous`, `<rev> excluded`),
  `ReadOneShot` gate between `cat-file -s` and `cat-file blob` on a mutable rev, and its type
  assumption (`-s` succeeds on a tree; `blob` then fails as `ErrMissing`).
- `logsession` reclaim timer racing `Next`/`Close`, cancellation reaching a blocked read,
  `finishEOFLocked` `Wait` after a kill.
- `Repo.Read`/`Write` slot accounting on cancellation (`ErrCancelled` before admission,
  `pendingWriters` decrement on every path, `notifyLocked` waking both queues), writer starvation
  under continuous reads (F17 fix), reader starvation under continuous writes, `maxConcurrentReads`.
- Timeouts: discovery `versionProbeTimeout`; `ghclient` three named timeouts plus
  `graphqlTimeout` 30 s; any `gitclient` spawn with only an undeadlined caller ctx.

### 6.4 Credentials, askpass and environment

- Askpass token and op id exposure: `KIRA_ASKPASS_TOKEN`/`KIRA_ASKPASS_SOCK` live in the env of
  every git child and everything it spawns (hooks, credential helpers, `ssh`, `ProxyCommand`).
  Weigh what a hook can do with them (impersonate a prompt to the broker for another op? token
  is per-broker, op id per op). Logs, error messages and `Error.Command` must never carry an
  answer.
- Shim (`buildShim`, `shellQuoteSingle`): quoting of the executable path (spaces, `'`, `$`,
  backtick, newline), 0700 dir and file modes, temp dir location, `Close` removal, a crash
  leaving the shim and socket behind.
- Broker protocol (`handleConn`, `wire.go`): unknown op id, duplicate connections per op, request
  size limits, read deadlines, a helper that connects and never writes, concurrent prompts in one
  op, `WithOp` unregister on every path, ctx bounding the prompt.
- Helper (`RunHelper`, `exchange`): fail-closed on every error path (exit non-zero, nothing on
  stdout), `SSH_ASKPASS_PROMPT` `none`/`confirm` (F19), answer with a newline or NUL, partial
  write to stdout.
- `ShouldInterpose` precedence: a user's `core.askPass` or inherited `GIT_ASKPASS`;
  `SSH_ASKPASS` inherited but `GIT_ASKPASS` not; `credential.helper` interplay; `coreAskPass`
  cached once per entry (stale after the user edits config).
- Env sanitisation: `gitRedirectEnvKeys` strip (F16) versus keys it misses
  (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`, `GIT_CONFIG_GLOBAL`,
  `GIT_CONFIG_NOSYSTEM`, `GIT_EXEC_PATH`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CEILING_
  DIRECTORIES`, `GIT_TRACE*` writing to a file or fd, `GIT_SSH_COMMAND`, `GIT_EXTERNAL_DIFF`,
  `GIT_REPLACE_REF_BASE`, `GIT_SHALLOW_FILE`, `GIT_QUARANTINE_PATH`). Judge each by whether it
  changes output shape or retargets a repo, not by listing.
  `ghclient.buildEnv` strips nothing: `gh` shells out to git, so an inherited `GIT_DIR` reaches
  it. `GH_TOKEN`/`GITHUB_TOKEN` pass through unread by design; confirm no log or error echoes
  them. `GH_HOST`, `GH_ENTERPRISE_TOKEN`, `GH_CONFIG_DIR` inheritance.
- Inherited user config that changes output shape despite `configOverrides`: `status.*`,
  `log.decorate`, `log.abbrevCommit`, `diff.noprefix`, `diff.mnemonicPrefix`, `diff.renames`,
  `diff.external` (builders pass `--no-ext-diff`?), `core.abbrev`, `blame.*`,
  `format.pretty`, `core.commentChar`.

### 6.5 `gh` client

- Auth gate per call (`discovery.Status` cached per host?), unauthenticated and token-expired
  classification, GHES hosts.
- Rate limit: GraphQL `errors[]` without `data` detects "rate limit" by substring; `errors[]`
  beside `data` and a REST 403/429 with `X-RateLimit-Remaining: 0` (classify path); secondary
  rate limits.
- GraphQL pagination in `PullFiles`: loop bound when `hasNextPage` stays true with an empty page
  or a repeated cursor (no page cap other than 3,000 files), `Truncated` arithmetic at exactly
  3,000, `pr == nil` mid-pagination, files changing between pages. `SetFilesViewed` 50-alias
  chunks: partial failure mapping per alias, path count versus chunk boundaries.
- `ghclient.execRunner.Run` buffers stdout and stderr in unbounded `bytes.Buffer` and truncates
  after exit (`runner.go:132-154`): the 4 MiB cap bounds retention, not memory. Truncated JSON
  then fails to parse; check the reported status.
- `ParseRemote`: SSH, HTTPS, `ssh://` with port, scp-like, GHES, trailing `.git`/`/`, user info,
  non-GitHub hosts, uppercase hosts.

### 6.6 Watchers and discovery

- `RepoWatcher` `Close` against a `run` goroutine parked mid-forward, `emit` after close,
  fsnotify refs-tree growth (new ref directories watched?), `.lock` suffix handling, NFC
  classification, packed-refs, linked worktree gitDir versus commonDir, fsevents (darwin) stop
  sequence.
- Discovery: `git.path` setting pointing at a non-git or slow binary, version parse of vendor
  strings (`git version 2.43.0.windows.1`, Apple Git), PATH lookup order, cached status
  invalidation.

### 6.7 Concurrency

- Shared mutable state: `Discovery` caches, `ghclient` status cache, broker `ops` map, catfile
  `persistentProcess.mu` held across a blocking read (head-of-line blocking for every caller of
  one repo), `logsession.Session.mu` across spawns. Run `-race` on the touched packages.

## 7. What earlier fixes already changed (do not re-report)

- **P166/P167 fixes edited no Part 14 file.** `git log f40cd35..HEAD` on the four package paths
  is empty. (`743af03` sits behind this clone's shallow boundary, so `git log 743af03..HEAD` is
  not usable here; `git diff 743af03 HEAD` on the paths works and gives the 449-line churn.)
- **P143-P165 feature churn in this chunk (449 lines, the pre-plan's figure), reviewed by P166
  and P167 as feature code:** `ghclient/graphql.go` (+212, new: `PullFiles`, `SetFilesViewed`)
  and its test; `ghclient/api.go` `Client.Account` (+5); `catfile/session.go` (+58/-15:
  synchronous `watchCtx` on `context.AfterFunc`, `drop`, `ctx.Err()` pre-checks) and its test;
  `porcelain/containment.go` (+51, new).
- **P166 F7** (`PullFiles.Truncated` ignored) was fixed caller-side in `gitsession/ghsync.go`
  (`684a17e`). **P167 F2** (sync plan refetch on every board push, `PullFiles` uncached) was fixed
  in the frontend (`076bd81`). Do not re-report either. `PullFiles` itself still has no cache;
  report that only with a new failure scenario.
- `docs/v2.0/plans/P16{6,7}-code-review.md` are gone from this branch and `v2.0` (both fixed).
  Nothing to skip.
- **P108 Part 14 fixes are in code:** F3 (`FieldGrouper` for NUL field streams), F4
  (`diff.suppressBlankEmpty=false`), F5 (buffered `Run` path so `WaitDelay` rescues orphaned
  pipes), F11 (catfile ctx), F12 (`ReadOneShot` size check first), F16 (`gitRedirectEnvKeys`),
  F17 (`pendingWriters` reader gate), F19 (`SSH_ASKPASS_PROMPT` variants), F20 (`Classify` ctx
  first). G31 round 2 #11 (`stopEscalate`). Verify they hold; do not re-report them as new.

## 8. Rubric, order and outputs

- **One Opus reviewer**, freeform "any kind of issue or bug", edge cases weighted. Not three
  dimension reviewers (user deviation from `CLAUDE.md`'s recipe, P168 only).
- Reports only. Fixes nothing, edits no code.
- **Whole chunk, one pass, in this block order** (spawn seam first, so every consumer reads
  against a known runner). About 7.5k production lines plus 8.5k test lines; one agent pass covers
  it if tests are read only where they are the sole guard of a claim.
  1. **Spawn seam and gate:** `GC/runner.go`, `errors.go`, `repo.go`, `client.go`, `clock.go`,
     `capabilities.go`, `discovery.go`, `PI/gitpath`.
  2. **Askpass:** `PI/gitaskpass/**`, with `gitsession/remote.go` `withAskpass`/`coreAskPass`
     and `main.go:62-67,572` read as callers.
  3. **Persistent and streaming processes:** `GC/catfile/**`, `GC/logsession/**`.
  4. **Porcelain:** `records.go`, `types.go`, then `log`, `refs`, `refsnapshot`, `inventory`,
     `status`, `show`, `stash`, `blame`, `diff`, `difftree`, `workingdiff`, `mergetree`,
     `worktree`, `reset`, `review`, `containment`; testdata captures against real git 2.43
     output where a claim depends on it.
  5. **`gh` client:** `PI/ghclient/**`.
  6. **Watchers:** `GC/watcher.go`, `watcher_fsnotify.go`, `watcher_fsevents_darwin.go`.
  7. **Tests:** confirm the guard claims cited in findings; report a test that no longer guards
     what its name says, or a missing guard for a genuinely complex rule (`CLAUDE.md` unit-test
     bar).
- **Resumable:** write `docs/v2.0/plans/P168-part14-findings.md` as blocks finish, and commit it
  after **every** block (`docs(v2.0): P168 Part 14 findings, block <n>`; normal commit, hooks
  green, explicit `git add <path>`). An interrupted run reads the file, resumes at the first
  block not marked done, and never re-derives a committed block.
- Each finding: id (`F<n>`), severity (high/medium/low), `file:line` on the current tree, a
  concrete failure scenario (inputs, sequence, observed outcome), and a proposed fix. Tag
  `needs-stream-A-file: <path>` when the fix must edit a Stream A file (§0). Tag
  `design-decision` when it needs one; the fixer turns it into its own `SPEC.md` phase.
- The findings file states base commit, HEAD reviewed, checks run and results, findings, then
  coverage per block: reviewed, skimmed (with reason), not reached. No unexplained gap. A chunk
  with nothing real says so; never manufacture a finding.
- Final commit `docs(v2.0): P168 Part 14 findings`, before any fixer starts.
- Then one Sonnet fixer: one commit per group of related findings, naming `P168 Part 14`, under
  pre-plan §3.3 edit scope as amended by §0 (Stream B one-hop callers editable; Stream A files
  never, routed by the orchestrator). A fix re-runs `go build ./apps/kira-space/...`, `go vet`
  and `go test -race` over the four packages plus `gitsession`, `gitrpc`, `codeworkspace`,
  `gitsearch`, `ade` when a caller changed. It deletes the findings file when done. Chunk lands
  per pre-plan §3.4 before Part 15's plan starts.

## 9. Out of scope

- `gitsession` logic (Part 16), `gitrpc`/`gitsock` validation and pairing (Part 17),
  `gitpreflight`/`gitops`/`gitreview`/`gitsearch`/`gitstore` (Part 15), ADE (Part 20),
  `codeworkspace` and `bridge` (Part 22): read only to size a finding's blast radius or prove a
  builder's input is guarded.
- Root `internal/*` beyond the Part 14 contract it serves (Part 8, §0 tag rule).
- `packages/git-core` `nulSplit.ts` (Part 18), the TS twin of `RecordSplitter`.
- Generated `gitwire`, docs, excluded files (pre-plan §6).
