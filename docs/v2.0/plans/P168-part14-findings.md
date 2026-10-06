# P168 Part 14: findings, Space git process layer

Plan: `P168-part14-space-git-process.md`. Reviewer: one Opus pass, report only.
Base commit: `fbf725e` (tree surveyed by plan). HEAD reviewed: `18a9afc` (plan commit only on top;
no Part 14 code change between them).

## Checks

- `go vet ./apps/kira-space/internal/{gitclient,ghclient,gitpath,gitaskpass}/...`: clean.
- `go test -race -count=1` same packages: 7 packages ok.

## Block status

- Block 1 (spawn seam and gate): done.
- Block 2 (askpass): done.
- Block 3 (catfile, logsession): done.
- Block 4 (porcelain): done.
- Block 5 (gh client): done.

## Findings

### F1 (low) `ResolveHead` reports a cancelled verify as an unborn branch

`apps/kira-space/internal/gitclient/repo.go:291-301`. `Run` on the buffered path returns a killed
child as `Result{ExitCode: -1}` with a nil error (`bufferedExecProcess.reap`, `runner.go:577`:
`ProcessState` is set, `ExitCode()` is -1 for a signal). `ResolveHead` branches on
`verifyRes.ExitCode == 0` and treats every other code as "unborn", without `Classify`.

Scenario: `symbolic-ref -q HEAD` exits 0 (`refs/heads/main`). The caller's ctx is cancelled (or
`gracefulStopDelay` kill lands from Close) while `rev-parse -q --verify HEAD` runs. `ResolveHead`
returns `HeadState{Kind: "unborn", Name: "main"}, nil`. `Identify` returns a summary with an unborn
head and no error; `gitsession` head refresh after a ref change publishes "unborn" for a repo with
commits until the next refresh. Same misread for any non-ctx signal kill.

Every other `ExitCode`-branching caller checked (`gitsession/queries.go` `runAllowingExit`,
`remote.go`, `preflight.go`, `incremental.go`, `comments.go`) routes an unexpected code through
`Classify`, which checks ctx first; `ResolveHead` is the one gap in this block.

Fix: accept exit 1 only as "unborn" (rev-parse `-q --verify` exits 1 for a missing ref); route any
other non-zero code through `Classify(ctx, verifyArgs, verifyRes, nil)`.

### F2 (low) `revParseLine` drops `rev-parse` from `Error.Command`

`apps/kira-space/internal/gitclient/repo.go:257`. `Classify(ctx, args, …)` gets only the flags,
not the full argv. A failure renders as `git --show-toplevel failed (notARepository): …` and
`Error.Command` lacks the subcommand, so a log or a caller matching on `Command[0]` sees a flag.
`ResolveHead` and `capabilities.go` pass full argv; this helper is the odd one out.

Fix: pass the same slice handed to `Spec.Args` (`append([]string{"rev-parse"}, args...)`).

### F3 (low) `coreAskPass` caches a failed read as "no core.askPass" for the entry's life

`apps/kira-space/internal/gitsession/remote.go:105-110` (Stream B one-hop caller, Part 16 file).
`askPassChecked = true` is set whether or not the read succeeded. Any error from
`runAllowingExit` (ctx cancelled while waiting on the `Repo.Read` gate or during the spawn,
`ErrCancelled`, a transient spawn failure) leaves `askPassValue == ""` and marks it checked.

Scenario: user has `core.askPass=/usr/local/bin/my-gui-askpass`. They start a fetch and hit Stop
while a `Repo.Write` holds the gate, so the first `coreAskPass` read returns `ErrCancelled`. From
then on `ShouldInterpose("")` is true for every remote op on that entry: Kira's shim is set as
`GIT_ASKPASS`, which git prefers over `core.askPass`, so the user's helper is bypassed until the
entry is evicted. D10's "never override a user's own core.askPass" is broken by a cancel.

Fix: set `askPassChecked` only when `err == nil` (exit 0 or 1). On error return `""` uncached (the
spawn that follows fails on the same ctx anyway).

### F4 (low) `localsock.Serve` calls `wg.Add` concurrently with `Close`'s `wg.Wait`

`internal/localsock/localsock.go:87-91,102-104`. `Serve` does `Accept` then `wg.Add(1)`. `Close`
closes the listener then `wg.Wait()`. A connection accepted just before `Close` can reach
`wg.Add(1)` after `Wait` has observed a zero counter. `sync.WaitGroup` requires a positive `Add`
at zero to happen before `Wait`; here it does not.

Scenario: at app shutdown (`main.go:227` `askpassBroker.Close()`) a helper connects in the same
instant. `Wait` returns, `os.RemoveAll(Dir)` deletes the socket and shim, and `handleConn` keeps
running past `Close`'s documented "waits for every in-flight one" contract (up to `b.timeout+5s`
on an unanswered prompt). Same shape in `agenthooks`. Low impact: the handler only answers a
prompt; no data loss.

Fix: track the in-flight count under a mutex with a `closed` flag checked before `Add`, or do the
`Add` before `Accept` returns control (for example `wg.Add(1)` before `Accept`, `wg.Done()` on
Accept error).
`needs-stream-A-file: internal/localsock/localsock.go`

### F5 (high) A ctx cancel mid-read counts toward catfile's circuit breaker and kills the Session for good

`apps/kira-space/internal/gitclient/catfile/session.go:146-155` (`request`), `194-211`
(`requestPipelined`). When the request's ctx fires, `watchCtx` closes the process, the blocked
`readResp` (or write) returns an I/O error, and the error branch calls `stop()` then `p.fail()`
without checking whether `stop()` reported fired. `fail()` increments `failures`. `drop()` (the
no-count path, whose doc says "a ctx cancel is not a process fault and must not trip the circuit
breaker") is reached only when the reply was already fully read. After 3 such cancels in a row,
`ensureStarted` returns `errCircuitOpen` forever: `failures` resets only on a success, and no
success can happen. The caller also gets `read |0: file already closed` instead of `ctx.Err()`, so
`gitclient.Classify`-style cancel handling upstream sees a generic error.

Reproduced (throwaway test, deleted): `GitPath` = a script that sleeps, `Check` with a 50 ms
timeout, four times:
`call 0..2: err=read |0: file already closed failures=1..3`,
`call 3: err=catfile: process failed 3 consecutive times, refusing to restart`.

Real scenario: blobless partial clone (`--filter=blob:none`). Each `Read` of a not-yet-fetched
blob triggers a promisor fetch lasting seconds. The user clicks through three files in the commit
detail pane; rpcstream cancels each superseded request mid-read. Every later blob read, file diff,
size lookup (`blobSizeOrNil`), ghsync head check and undo check on that repo fails with
`errCircuitOpen` until the `RepoEntry` is evicted. Same with a slow disk on a cold cache.

Fix: in every error branch, `if stop() { p.drop(); return ctx.Err() }` before `p.fail()`. A fired
watcher means the process was killed by us, not that it misbehaved.

### F6 (low) `ReadOneShot` size gate and read resolve the rev in two separate spawns

`apps/kira-space/internal/gitclient/catfile/session.go:403-431`. `cat-file -s <rev>` checks the
size, then `cat-file blob <rev>` reads it through buffered `Run` with uncapped stdout. For a mutable
rev (`HEAD:<path>`, the shape `codeworkspace/diff.go:75` and `gitsession/queries.go:451` pass) the
object can change between the two spawns. `Read` re-checks the second process's own header size
(F9); `ReadOneShot` has no second check.

Scenario: a path containing a newline at `HEAD:<path>` is 1 KiB when `-s` runs; a checkout (in
app or external) moves HEAD to a commit where that path is a 3 GiB blob before the `blob` spawn.
The whole 3 GiB lands in a `bytes.Buffer`. Narrow (newline paths only, local actor), hence low.

Fix: resolve once with `rev-parse --verify <rev>` (already `CheckOneShot`), then run `-s` and
`blob` against the returned OID. A post-read length check is too late; the OID must be pinned.

### F7 (low) `logsession.finishEOFLocked` protocol-error path leaves the child unreaped and masks git's error

`apps/kira-space/internal/gitclient/logsession/session.go:262-267`. On an unterminated trailing
field or partial record at EOF it returns before `s.proc.Wait()`, leaves `s.proc` set, and does
not mark `failed`. `Flush` cleared both buffers. The next `ReadPage` reads EOF again, flushes
nothing, waits and classifies. 

Scenario: `git log` dies mid-walk on a missing object in a shallow or partial clone (`fatal: bad
object`); stdio flush at `exit()` leaves half a record. The first `ReadPage` returns
`unterminated trailing field at EOF` (stderr's real reason is lost, the child is a zombie until
the next call or `Close`), and `gitsession/walk.go` treats it as a resumable error because
`Failed()` is false. Only the retry surfaces `fatal: bad object`. If git ever exited 0 with a
trailing partial, the retry would report `Exhausted` and silently drop the record.

Fix: on either Flush violation, `Wait` the child first; if its exit is non-zero return the
classified git error, else `failLocked` the protocol error.

### F8 (medium) A user's `color.diff=always` breaks patch-id containment

`apps/kira-space/internal/gitclient/porcelain/containment.go:29-37`; root cause
`apps/kira-space/internal/gitclient/runner.go:135`. `configOverrides` sets only `color.ui=false`.
`color.diff` takes precedence over `color.ui`, so a user's `color.diff=always` (common for people
piping into `less -R`) still colors porcelain diff output. `ThreeDotDiffArgs` (`git diff`) and
`LogPatchArgs` (`git log -p`) pass no `--no-color`; every other patch builder does
(`FileDiffArgs`, `WorktreeDiffArgs`, `NoIndexDiffArgs`).

Reproduced with real git 2.43:
`git -c color.ui=false -c color.diff=always log --no-merges -p -n 2 HEAD | git patch-id --stable`
prints nothing (lines start with `\033[1mdiff --git`, so `patch-id` sees no patch).
`gitsession/queuefacts.go` `DiffPatchID` then returns `""` and `RecentPatchIDs` returns no ids,
so `ade/integration.go:121-127` never detects a squash-merged branch: the queue shows it as
unmerged forever. Silent, no error.

Fix: add `--no-color` to both builders, and add `-c color.diff=false` to `configOverrides` so a
future patch builder cannot regress.

### F9 (low) LF-framed `for-each-ref` output breaks on a worktree path containing a newline

`apps/kira-space/internal/gitclient/porcelain/refs.go:45,60,206-211` (`HeadsRefsArgs`,
`SingleRefArgs`, `parseRefRowsLF`) and `inventory.go:107` (`ParseInventory`). Records are framed
by LF, but `%(worktreepath)` is emitted raw. Probed: after
`git worktree add -b wt $'/tmp/w\nx'`, `for-each-ref --format='%(refname)%00%(worktreepath)'`
emits `refs/heads/wt\0/tmp/w\nx\n`. The trailing `x` line parses as a 1-field record, so
`ParseRefRows` fails with `ref record has 1 fields, want 11` and `ParseInventory` with
`inventory record has 1 fields, want 8`.

Scenario: a user (or a script) creates a linked worktree under a directory name containing a
newline. The branches pane (`refs.list`), single-ref lookups and the queue inventory fail for that
repo until the worktree is removed. Self-inflicted and rare, hence low; the tags path already
solved this framing (`TagRefsFormat`, trailing `%00`, leading-LF strip).

Fix: use the `parseRefRowsNUL` framing for `RefsFormat` and `InventoryFormat` (append `%00`, strip
the leading LF of each later record).

### F10 (low) Rev arguments without `--` fail when a worktree file has the same name

`apps/kira-space/internal/gitclient/porcelain/log.go:68` (head scope emits bare `HEAD`, consumed by
`LogSessionArgs:88`, `LogScanArgs:117`, `logsession/session.go:382` `rev-list --count`) and
`workingdiff.go:31,38` (`git diff --numstat|--name-status HEAD`, base `"HEAD"` from
`gitsession/working.go:23`). Probed with a file named `HEAD` at the repo root:
`git log … HEAD`, `git rev-list --count HEAD` and `git diff --numstat -z HEAD` all fail with
`fatal: ambiguous argument 'HEAD': both revision and filename`. Ranges (`a..b`, `a...b`) and
`rev-parse` are unaffected.

Scenario: a repo tracks a file named `HEAD` (or the user creates one). The working-changes pane
fails, and the graph fails when the repo's graph scope is "head". Rare, hence low.

Fix: append `--` after the revision arguments in `LogSessionArgs`, `LogSessionSkipArgs`,
`LogScanArgs`, `countTotal`'s argv and both `Working*Args`.

### F11 (low) A 0x1f in a trailer value or GPG signer name corrupts commit-detail body and trailers

`apps/kira-space/internal/gitclient/porcelain/show.go:22,130`. `bodyAndSignatureFormat` uses 0x1f
between four fields, but only `%b` (last) is safe. `%(trailers:…)` and `%GS` are not last and
can carry 0x1f. Probed: a commit whose message ends `Reviewed-by: x\x1fy` yields
`N\x1f\x1fReviewed-by: x\x1fy\n\x1fbody text…`. `SplitLimitedFields(…, 4)` gives trailers
`[Reviewed-by: x]` and a body of `y\n\x1fbody text…`: a stray `y` and a raw 0x1f at the top of
the body in commit detail. Any pushed commit can carry this; display corruption only.

Fix: make the format NUL-delimited (`%G?%x00%GS%x00%(trailers…)%x00%b`) and split with
`splitOneNULRecord(raw, 4)`, the F3 approach `LogFormat` already uses. Probe in block 4 showed git
truncates message text at an embedded NUL, so no field can contain NUL.

### F12 (low) `ParseBlameLine` fails on a content line longer than 1 MiB

`apps/kira-space/internal/gitclient/porcelain/blame.go:73`. `bufio.Scanner` with a 1 MiB max
token reads `--line-porcelain` output, whose last line is the blamed content prefixed by a tab. A
line over 1 MiB (minified bundle, generated JSON on one line) makes `Scan` stop with
`bufio.ErrTooLong`, so blame on that line returns `porcelain: blame: bufio.Scanner: token too
long`. Only the content line can be that long, and the parser never uses its text.

Fix: walk `raw` with `bytes.IndexByte(raw, '\n')` and stop at the first line starting with a tab,
without a token limit (the whole output is already in memory).

### F13 (low) A revision containing a newline desyncs the persistent catfile stream for every later caller

`apps/kira-space/internal/gitclient/catfile/session.go:270,303,342` (`Check`, `CheckMany`, `Read`
append `rev+"\n"` unvalidated). Callers that build `<rev>:<path>` route newline revs to the
one-shot path, but `gitsession/ghsync.go:129` passes `files.HeadSha` straight from
`ghclient.PullFiles` (`graphql.go`, `pr.HeadRefOid`, unvalidated GitHub JSON). A newline in the
rev makes git answer twice; the second answer stays in the pipe and is read by the next, unrelated
request on that persistent process.

Reproduced (throwaway test, deleted) on a scratch repo: `Check("HEAD\nHEAD~1")` returns HEAD's
info; the next `Check("doesnotexist")` returns `{OID: <HEAD~1>, Type: commit}, nil` instead of
`ErrMissing`. Every request after that is off by one until the process fails.

Scenario: a GHES host the user is logged in to (or a compromised one) returns
`headRefOid: "<sha>\nHEAD"`. Afterwards blob reads, diffs and size lookups in that repo silently
return the previous request's object: wrong file content shown or written into review state.
Needs a hostile GitHub host, hence low; the defect is that the line protocol trusts its callers.

Fix: in `request`/`requestPipelined` (or `Check`/`CheckMany`/`Read`), reject any rev containing
`\n` with an error (callers needing such revs already use the one-shot path). Also validate
`HeadRefOid` as 40 or 64 hex in `PullFiles`.

### F14 (low) `PullFiles` pagination has no page bound

`apps/kira-space/internal/ghclient/graphql.go:126-158`. The loop stops only at 3,000 files, at
`hasNextPage == false`, or at an empty `endCursor`. A response with `hasNextPage: true`, a
non-empty `endCursor` and zero nodes (GitHub incident, GHES bug, or a cursor that does not advance)
loops forever, one `gh` spawn per iteration (each up to 30 s), bounded only by the caller's ctx.
A repeated cursor with nodes fills the result with duplicates until 3,000.

Fix: cap iterations at `maxPullFiles/pullFilesPageSize + 1` and stop (as truncated) when a page has
no nodes or returns the same cursor as the previous one.

### F15 (low) `https://` remotes with userinfo, a port or an uppercase host are never recognised as GitHub

`apps/kira-space/internal/ghclient/remote.go:62-73`. `parseURLForm` takes everything before the
first `/` as the host, so `https://vlad@github.com/o/r.git` yields host `vlad@github.com`,
`https://x-access-token:TOKEN@github.com/o/r` yields `x-access-token:TOKEN@github.com`, and
`https://GitHub.com/o/r` yields `GitHub.com`. `parseSSHURLForm` already strips userinfo and port.
`gitsession/gh.go:259` `IsGitHubHost` compares to `"github.com"` case-sensitively first, so these
repos silently get no PR status, sync or badges. No `gh` call is made for such a host (it is
never in `Hosts()`), so the embedded token does not reach a `gh` argv today; it is kept in
`RepoEntry.gh.repo.Host` only.

Fix: in `parseURLForm`, cut userinfo at the last `@` and lowercase the host (keep the port only if
GHES support needs it); add the three shapes to `remote_test.go`'s table.

### F16 (low) `gh` REST responses over 4 MiB are truncated into "unreadable response"

`apps/kira-space/internal/ghclient/runner.go:132-154`, consumer `pr.go:160` (`OpenPulls`,
`per_page=100`). Stdout is buffered whole in an unbounded `bytes.Buffer`, then cut at 4 MiB, and
`get` reports the cut JSON as `GitHub returned an unreadable response`. The cap bounds retention,
not memory, and turns a large valid answer into a hard failure. The REST pull list returns full
`head.repo`/`base.repo`/`user` objects and the PR `body` for each of 100 items. Estimate, not
measured (no authenticated `gh` here): about 15-25 KiB per item before the body, so a page of
bot PRs with long bodies (Dependabot release notes) can exceed 4 MiB. Page 1 failing fails the
whole snapshot (`OpenPulls` returns the error for page 1).

Fix: add `--jq` projecting only the fields `rawPull` reads (about 200 bytes per PR), and replace
the post-hoc cut with a bounded writer that reports "response too large" distinctly.

## Coverage

### Block 1: spawn seam and gate

Reviewed in full: `GC/runner.go`, `errors.go`, `repo.go`, `discovery.go`, `capabilities.go`,
`client.go`, `clock.go`, `PI/gitpath/gitpath.go`; callee `internal/procgroup/procgroup.go`
(`Kill`, `GracefulCancel`).

Verified, no finding:
- `buildArgv`: `configOverrides` first, nothing caller-supplied before or between `-c` pairs;
  `--no-optional-locks` precedes the subcommand.
- `buildEnv`: strip before append, so hygiene and `Spec.Env` cannot reintroduce a redirect key.
  Missing keys judged by effect: `GIT_CONFIG_PARAMETERS`/`GIT_CONFIG_COUNT` carry `-c` style
  config, but argv `-c` is parsed after them and wins for the six overridden keys; other inherited
  keys are equivalent to user config (block 4 judges builders against user config).
  `GIT_EXTERNAL_DIFF` and textconv are judged per builder in block 4.
- Process lifecycle: `GracefulCancel` sets `WaitDelay`; `stopEscalate` runs only after `cmd.Wait`
  (happens-after `Cancel`), so its unsynchronised `escalate` read is safe. `killAndWait` disarms its
  own timer after reap. `execProcess.reap` waits `stderrDone` before `cmd.Wait`, so `OnStderr`
  never fires after `Wait`. Go 1.20+ `Start` closes created pipes on failure (no fd leak).
  `startBuffered` refuses `Stdin`. `WaitDelay` rescues the buffered path; streaming spawns are
  reads only (no hook can background a grandchild there).
- `Repo` gate: `pendingWriters` decremented and `notifyLocked` called on every Write exit,
  including `ErrCancelled`; readers decrement and notify on exit. Writer priority can delay readers
  under continuous writes; writes are user-driven ops, acceptable.
- `Classify` ctx first (F20 holds). `Discovery` skips cache on caller cancel (G31 #1 holds); no
  singleflight on a cold cache (concurrent callers each probe once, bounded by 5 s), not a defect.
- `versionTriple` handles `2.43.0.windows.1`, `-rc1`, Apple suffix.

### Block 2: askpass

Reviewed in full: `PI/gitaskpass/{broker,helper,interpose,prompt,wire}.go`; callers
`gitsession/remote.go` `repoPrompter`/`coreAskPass`/`withAskpass`, `gitops.CoreAskPassArgs`,
`main.go:62-67,227,572`; callee `internal/localsock/localsock.go`.

Verified, no finding:
- Shim: every helper argv element single-quoted (`'\''` idiom); `"$1"` only. Shim 0700 inside
  a `MkdirTemp` 0700 dir, socket 0600, dir removed on `Close`. A crash leaves the dir behind in
  per-user `TMPDIR`; contents unusable without the live process (token in memory only).
- Protocol: constant-time token compare; unknown op id fails closed; per-conn deadline
  `timeout+5s`; ask bounded by op ctx and broker timeout; `WithOp` unregisters via `defer` on every
  path. Pre-auth line read is unbounded but only same-uid can connect (0700 dir), so not a
  boundary.
- Helper: every error path exits 1 with nothing on stdout; F19 `none`/`confirm` holds; confirm
  never prints the answer.
- Token/op id exposure: both live in the env of remote-op children (hooks, credential helpers,
  ssh). A long-lived child (credential-cache daemon) keeps the token but op ids are 16 random bytes,
  registered only for the op's life. A hook during its own op can raise a prompt in Kira's UI, but
  a hook is already arbitrary code as the user, so no new capability. No log, error or
  `Error.Command` carries env or answers (grep of `slog` in `gitaskpass`, `remote.go`: none).
- `ShouldInterpose`: inherited `SSH_ASKPASS` without `GIT_ASKPASS` is overridden (upstream D10
  rule, by design). Staleness after a user edits `core.askPass` is the documented per-entry cache;
  F3 covers the failure-caching defect only.

### Block 3: persistent and streaming processes

Reviewed in full: `GC/catfile/{batch,session}.go`, `GC/logsession/session.go`; caller guards in
`codeworkspace/diff.go`, `gitsession/{incremental,queries,stack,ghsync,ops}.go` for newline revs.

Verified, no finding:
- `watchCtx` (`context.AfterFunc`, synchronous stop): a fired watcher's `Close` runs
  `killAndWait`, which reaps through `Wait`, so the `drop()` path leaves no zombie.
  `requestPipelined` drains `writeErrCh` on every path; F8 ordering holds.
- `Session.Close` cancels `spawnCtx` first, so an in-flight read gets EOF and `close()` acquires
  `mu`. A request after `Close` fails to spawn (cancelled ctx) and trips the breaker, which is
  fine for a closed session.
- `readHeader`: `missing`/`ambiguous` suffix rule holds for inputs with spaces; other non-found
  replies (`excluded`, `dangling`, `loop`, `notdir`) need `--filter`/`--follow-symlinks`, which
  are never passed. `Read` re-checks the `--batch` header size (F9 holds) and consumes oversized
  content to keep framing.
- Newline revs: every `Check`/`Read`/`CheckMany` caller that builds `<rev>:<path>` routes a newline
  to the one-shot path. `ghsync.go:129` passes `files.HeadSha` from GitHub JSON unguarded; judged
  in block 5 (`ghclient` validation).
- One-shot argv without `--`: reached only for newline revs; a dash-leading value with a newline
  cannot equal a `cat-file`/`rev-parse` option name, and `--opt=value` forms either error or are
  harmless (`--path=`), so no injection.
- `logsession`: ctx cancel kills the child and keeps `readCount` exact (splitter and grouper reset
  on resume); bytes discarded by a lost select race are re-read via `--skip`. A reclaim timer
  that fired while `ReadPage` held `mu` can kill the next, non-idle process once; the resume path
  handles it (snapshot check, `--skip`), so only a wasted respawn. `Remaining` holds `mu` across
  `rev-list --count`, serialising it with `ReadPage`: a latency cost, not a defect.
- `RecordSplitter`/`FieldGrouper` (`records.go`, read here for logsession): copies records, caps
  remainder at 64 MiB, `Flush` clears.

### Block 4: porcelain

Reviewed in full: `records.go`, `types.go`, `log.go`, `refs.go`, `refsnapshot.go`, `inventory.go`,
`status.go`, `show.go`, `stash.go`, `blame.go`, `diff.go`, `difftree.go`, `workingdiff.go`,
`mergetree.go`, `worktree.go`, `reset.go`, `review.go`, `containment.go`. Testdata captures not
re-derived; all porcelain tests pass and every parser claim above was probed against real git 2.43.

Verified, no finding:
- NUL in commit or tag messages: git truncates `%s`, `%b`, `%(contents:*)` at the NUL (probed),
  so NUL-fielded formats (`LogFormat`, `ScanFormat`, `TagRefsFormat`) cannot be shifted.
  0x1f in names/emails is harmless there (F3 holds).
- Ref names cannot contain space, control bytes or 0x1f (`check-ref-format`), so `%D` ", "
  splitting, `ParseRefSnapshot` 0x1f split and status `# branch.*` headers are safe. Unknown `%D`
  words (`grafted`, `replaced`) are skipped.
- Stash list: reflog normalises tabs to spaces in `%gs` (probed `stash push -m $'a\tb\t'`), so a
  header cannot pose as a rename numstat record. Rename path records are consumed before header
  detection.
- `status --porcelain=v2 -z`: path is the absorbing last field; `2` record takes the next record
  as original path; unborn `(initial)` and `(detached)` handled.
- Diff parsing: `-z` patch headers C-quote control characters, so no raw LF from a path enters
  `ParseFileDiffBody`; blank context lines (F4 override holds), `\ No newline`, LFS pointer,
  binary and mode-only cases handled; `diff.noprefix`/`mnemonicPrefix` only change header text the
  parser ignores. `textconv` does not affect `--numstat` (probed).
- Inherited config: `--format` overrides `format.pretty`/`log.decorate`; explicit `--unified=3`,
  `--no-renames`/`-M -C`, `--no-ext-diff`, `--no-textconv` cover `diff.context`, `diff.renames`,
  `diff.external`, textconv on every patch builder except F8's color gap.
- Argv injection: builders without `--` take server-derived shas or caller-validated refs.
  Spot-checked guards: `gitrpc/detail.go:75` (`commit.detail` sha), `gitrpc/graph.go`
  `rangedWalkSpecFrom` (range base/branch), `gitsession/preflight.go` `resolveCommit` and
  `revertMergeParents` (`validOpArg`), `review.resolveBase`. `containment.go` inputs come from
  ADE tips (shas). No unguarded client string reaches a dash-sensitive position.
- `SHA-256`: `isHexObjectID` and `IsUncommittedBlameSHA` accept 40 or 64 hex; empty tree derived
  via `hash-object` (F18 holds).

### Block 5: gh client

Reviewed in full: `PI/ghclient/{api,discovery,doc,errors,graphql,pr,remote,runner,status}.go`;
callers `gitsession/gh.go` (`IsGitHubHost`, `githubRepo`), `gitsession/ghsync.go:120-135`.

Verified, no finding:
- GraphQL argv: every string variable (`owner`, `name`, `cursor`, `pr`, `p<n>` paths) goes via
  `-f` (no `@file` read); only ints use `-F`. Paths travel as variables, never in the query text.
  `--hostname <host>`: pflag takes the next token as the value even when it starts with `-`, and
  the host comes from a parsed remote gated by `IsGitHubHost`.
- REST paths: owner/name `url.PathEscape`d, sha `PathEscape`d, branch and owner `QueryEscape`d.
- Rate limits: GraphQL `errors[]` without data matched on "rate limit"; REST 403 with "rate
  limit" and 429 classified; secondary limits carry "rate limit" in stderr. `gh` exits 1 on
  GraphQL errors; `graphql()` inspects the body regardless of exit code, so per-alias errors beside
  data reach `SetFilesViewed`.
- `SetFilesViewed`: 50-alias chunks; alias index bounds-checked; a whole-chunk failure marks that
  chunk and all later paths failed. `Truncated` at exactly 3,000 is correct (`hasNextPage` or
  over-count).
- Env: `GH_REPO=` cleared; inherited `GIT_DIR` is irrelevant because every call passes
  `--hostname` and an explicit path, never a `{owner}` placeholder; `GH_TOKEN`/`GITHUB_TOKEN`
  pass through by design and no log, `Status.Reason` or error echoes them.
- Discovery: per-host cache, caller-cancel not cached (G31 #5 holds), `notOKTTL` asymmetric.
  `classify`'s timeout text says "10s" also for the 30 s GraphQL timeout: cosmetic, not reported.
