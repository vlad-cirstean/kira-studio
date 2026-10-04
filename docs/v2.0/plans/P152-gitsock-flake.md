# P152 — gitsock integration test flake: plan

Plan for `docs/v2.0/SPEC.md`'s **P152** row. Planned on branch `v2.0` at `79af0ca8`. Line numbers
are at that commit.

**Status: implemented.**

**Discovery method, disclosed.** `codegraph_explore` ran before `Read`/`Grep` for: gitsock test
harness (`newIntegrationServerWithRunner`, `pairAndReady`, `recvEvent`, `drainStragglerEvents`);
`storage.Open`/`OpenAt`/`KiraSpaceHome`; `gitsession.NewRegistry`/`gitreview.DefaultPath`/`Store`;
`catfile` session lifecycle (`watchCtx`, `request`, `requestPipelined`, `fail`); `rpcstream`
request dispatch (`handleRequest`); watcher `classify` and `subscriber.run`. Reproductions below
are real runs on this 4 vCPU container. "Under load" means 4-6 `while :; do :; done` busy loops
alongside the run. The catfile repro used `go test -overlay` (a virtual test file); nothing was
written to the tree.

---

## 1. Root causes

Three independent defects. Each alone produces intermittent, load-sensitive failures that vanish
under `-run '^Name$'`. Fix all three; a fix for one does not hide another.

### RC1 — catfile `watchCtx` closes a healthy persistent process after a request succeeds

The `E_INTERNAL: read |0: file already closed` error. `|0`/`|1` are Go's names for the read/write
ends of `os.Pipe` (here `exec.Cmd.StdoutPipe`/`StdinPipe`).

- `internal/rpcstream/session.go:196-197`: `handleRequest` calls `entry.cancel()` on the request's
  ctx the instant `Request` returns, success or not.
- `apps/kira-space/internal/gitclient/catfile/session.go:106-116`: `watchCtx` starts a goroutine that
  `select`s on `ctx.Done()` vs `done`. `stop()` only closes `done`; it never waits for the goroutine.
- Race: request succeeds, `stop()` closes `done`, handler returns, rpcstream cancels ctx. If the
  watcher goroutine has not run its `select` yet, both cases are ready. Go picks uniformly at
  random. Half the time it runs `proc.Close()` on the persistent `cat-file --batch[-check]`
  process. `persistentProcess.proc` still points at the dead process.
- Next request on that repo: `execProcess.Close` (`gitclient/runner.go:524-537`) closes stdout
  first, then stdin, then kills. Depending on where the next request lands in that sequence, its
  write fails (`write |1: file already closed`) or its read fails (`read |0: file already
  closed`). `fail()` then respawns, so only one request fails. Every `file.read`,
  `review.*`, `review.comment.*` call goes through catfile; hence "different test each run".
- Load widens the window: the watcher goroutine waits longer to be scheduled.

**Reproduced deterministically, no load needed.** Overlay test in `catfile_test` package: 300 x
`ctx, cancel := WithCancel; sess.Read(ctx, "HEAD:hello.txt"); cancel()` on one session.

```
-count=3:        1/300 Reads failed; first: write |1: file already closed   (2 of 3 runs)
-race -count=5:  6, 1, 4, 1, 1 /300 Reads failed; first: write |1: file already closed
```

Same mechanism, both variants (`read |0` / `write |1`). `requestPipelined` (`:154-190`) has the same
watcher. No other `watchCtx`-style async closer exists: `logsession.readChunkLocked`
(`logsession/session.go:330`) and `gitsearch.readScanChunk` (`gitsearch/scan.go:206-225`) select
synchronously in the caller, so they cannot fire after return.

### RC2 — gitsock tests share the real `~/.kira-space` (kira.db and review.db)

- `storage.Open()` reads `KIRA_SPACE_HOME` (`internal/config/paths.go:15`). `remote_test.go:177`,
  `recovery_test.go:36` and the helper (`recovery_support_test.go:53,61,142`) set `KIRA_HOME`, which
  nothing reads. Every remote/recovery test and the SIGKILL helper open `~/.kira-space/kira.db`.
  Confirmed: `~/.kira-space/kira.db` and `review.db` exist in this container, mtime of the last test
  run. Effects: cross-run/cross-worktree schema skew (`schema_version (9) is newer`, P145 Result),
  `SQLITE_BUSY` contention with any other concurrent `go test` process, and recovery tests that do
  not actually reopen the killed helper's own DB (both sides happen to land on the same real file,
  so the test passes for the wrong reason).
- `gitsession.NewRegistry` (`gitsession/registry.go:109`) defaults `Review` to
  `gitreview.NewStore(gitreview.DefaultPath())` = `$KIRA_SPACE_HOME/review.db`. No gitsock harness
  overrides it (`integration_test.go:295`, `remote_test.go:192`, `recovery_test.go:65`,
  `recovery_support_test.go:72`, plus `revoke_test.go`/`matrix_*` if they build their own). So every
  parallel review/comment test in the package — and every concurrent `go test` process in
  gitrpc/gitsession/ade — opens its own `*sql.DB`, migrator and reaper on one shared file.
  `Registry.Review`'s own doc comment (`registry.go:73-77`) says tests must override it under
  `t.TempDir()`; gitsock never did.

### RC3 — test client assumes watcher event order and reads without deadlines

Found by the first load run (§2). Not the reported error, but the same "different test each run"
shape, and the likely source of the 10-minute hang.

- `git commit` writes `.git/index` (→ `worktreeChanged`) then the ref (→ `refsChanged`).
  `subscriber.run` (`gitsession/subscriber.go:60-80`) emits refs first only when both flags are set
  on the same wake. Under load the index write's wake is delivered before the ref write lands, so
  `worktreeChanged` arrives first. Both events are correct product behaviour.
- Tests assert the first `repo.changed` is `refsChanged`: `integration_test.go:595,648-650`,
  `revoke_test.go:299`, `waitForRefsChanged` (`incremental_test.go:135-142`, used widely). These fail
  under load:

```
--- FAIL: TestIntegration_RepoChangedReachesEveryHolder  event = {... Kind:worktreeChanged}, want {... refsChanged}
--- FAIL: TestIntegration_RefcountAndDisconnectTeardown  client B event = {... Kind:worktreeChanged}, want refsChanged
--- FAIL: TestRevoke_DoesNotDisturbAnotherClient (x2)    B's event after A was revoked = {... worktreeChanged}
--- FAIL: TestIntegration_PartialRangesSurviveAnInsertion event = {... worktreeChanged}, want refsChanged
```

- `drainStragglerEvents` (`incremental_test.go:148-162`) drains with a 50 ms read deadline. Two
  defects: a straggler arriving after 50 ms (load) survives into the next `recvEvent`; and a
  deadline that fires mid-frame leaves `readFrame`'s `io.ReadFull` (`frame.go:46-60`) having
  consumed part of a header/body, desyncing the stream for every later read.
- `testClient.request` (`integration_test.go:159-175`) silently discards `evt` frames. A test that
  mutates the repo, then calls `request`, then `recvEvent` loses the event if it arrived during the
  request, and `recvEvent` blocks forever.
- No test-side read has a deadline (`recvHandshake`, `request`, `recvEvent`, `readStreamFrame`). A
  lost event or stalled server costs the full `go test -timeout` (10 m) instead of a named failure.
- The reported hang "in `TestBroker_QueueBoundedAgainstUnlimitedEnqueue`": that test is
  deterministic (fake clock, no I/O; `pairing_test.go:302-339`). It calls `t.Parallel()`. Go's
  timeout panic lists every running test, and parallel tests stay "running" while paused until the
  serial phase ends. 34 gitsock tests are serial (`remote_test.go`, `recovery_test.go`, `matrix_test.go`,
  `revoke_test.go` remote ones, `perf_test.go`). So the hang was most likely a serial test blocked on
  a deadline-less read (RC3) or `SQLITE_BUSY`-stalled shared DB (RC2), with the broker test merely
  listed. Not reproduced on demand (P145 also could not, `-run Broker -count=20`). The test does
  leak `maxQueueLen` (200) goroutines blocked on `<-entry.result` forever; fix that too (§3.3.7).

---

## 2. Reproduction recipe

Run from `apps/kira-space`. Record exact counts in the Result.

```sh
# RC1, direct (fast, no load needed). Overlay keeps the tree clean pre-fix; post-fix, the real
# regression test (§3.1) replaces it.
S=$(mktemp -d); cat > $S/repro_test.go <<'EOF'
package catfile_test
import ("context";"testing";"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient";"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/catfile")
func TestP152Repro(t *testing.T) {
	skipWithoutGit(t); dir := initRepo(t)
	s := catfile.NewSession(catfile.Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir}, 0)
	defer s.Close()
	for i := 0; i < 300; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		if _, _, err := s.Read(ctx, "HEAD:hello.txt"); err != nil { t.Fatalf("iter %d: %v", i, err) }
		cancel()
	}
}
EOF
printf '{"Replace":{"%s/internal/gitclient/catfile/p152_repro_test.go":"%s/repro_test.go"}}' "$PWD" "$S" > $S/o.json
go test -race -overlay $S/o.json -run P152Repro -count=5 ./internal/gitclient/catfile/

# RC2, evidence: real home touched by tests.
ls -la ~/.kira-space/          # kira.db / review.db mtime == last gitsock run

# RC3 + everything, under load (pre-fix: FAILs listed in §1 RC3 within one -count=4 run).
for i in 1 2 3 4; do timeout 900 sh -c 'while :; do :; done' & done
go test -race -count=4 -timeout 15m ./internal/gitsock/
kill %1 %2 %3 %4
```

Pre-fix measurements (this plan's own runs, `79af0ca8`):
- No load, `-race -count=1 ./internal/gitsock/`: pass, 60 s.
- 4 busy loops, `-race -count=4`: FAIL, 5 failures (§1 RC3 list), 371 s.
- 6 busy loops, `-race -count=6 -run 'Comment|FileRead|Review|Incremental|Partial|Blob|File'`:
  FAIL, 4 failures in 131 s. Three are error responses (`file.read`, `review.comment.list`,
  `review.mark`); one is RC3 (`worktreeChanged`, want `refsChanged`).
- Same with `requestOK` patched via overlay to print `*resp.Error`, `-count=8 -run
  'Comment|Review|Incremental|Partial'`: `TestIntegration_RefsChangedDoesNotDropReviewState:
  review.fileDiff: error {Code:E_INTERNAL Message:read |0: file already closed}` — the reported
  error, exact — plus 2 RC3 failures.
- RC1 overlay repro: fails every `-race` run, 1-6 of 300.

---

## 3. Fix

Single sequential implementer. Order below is commit order.

### 3.1 RC1 — make `watchCtx` synchronous on stop (`catfile/session.go`)

Rewrite `watchCtx` over stdlib `context.AfterFunc` (Go ≥1.21; no hand-rolled goroutine):

- `AfterFunc(ctx, f)` where `f` closes `proc` and then closes a `fired` channel.
- Returned `stop() (fired bool)`: if `AfterFunc`'s own stop returns true, `f` never ran → false.
  Otherwise `f` started; wait on `fired` (so `Close` has fully finished) → true.
- `request`/`requestPipelined`: drop `defer stop()`. Call `stop()` explicitly, under `mu`, before
  every return:
  - success path: if `stop()` reports fired, the reply already read is valid. Return it, but drop
    the now-dead process (`p.proc, p.stdin, p.reader = nil, nil, nil`) **without** incrementing
    `failures` — a cancellation is not a process fault and must not trip the circuit breaker.
  - error paths: `stop()` first, then the existing `fail()` (idempotent `Close`). Keep current
    failure counting there, unchanged.
  - `requestPipelined`'s F8 ordering (`fail()` before draining `writeErrCh`) stays: `stop()` goes
    before `fail()`, never after the drain.
- Add a pre-check at the top of both: `if err := ctx.Err(); err != nil { return err }` before
  `ensureStarted`, so an already-cancelled request never kills a healthy process.
- Update the doc comment on `watchCtx` (it currently claims Close is only ever triggered by a
  genuinely interrupted call). One line on the rpcstream cancel-after-return interaction.

Regression test in `catfile/catfile_test.go` (concurrency/cancellation — inside CLAUDE.md's test
bar): the §2 loop, 300 iterations, real git, fails on the first error. Also assert the circuit
breaker is not tripped by 300 post-success cancels (one more `Read` with a background ctx
succeeds). Must fail on `79af0ca8` under `-race -count=5`, pass after.

Commit: `fix(gitclient): stop catfile ctx watcher synchronously so a post-success cancel cannot kill the session`.

### 3.2 RC2 — isolate every gitsock test from the real home

1. New `internal/gitsock/main_test.go`: `TestMain` sets `KIRA_SPACE_HOME` to `os.MkdirTemp`,
   runs `m.Run()`, removes it, exits. Belt-and-braces: anything still reaching a default path lands
   in a per-process temp dir, never `~/.kira-space`. The SIGKILL helper child inherits it via
   `os.Environ()`.
2. Replace `storage.Open()` with `storage.OpenAt(kiraHome)` in `remote_test.go:179`,
   `recovery_test.go:54`, `recovery_support_test.go:61`. Delete both `t.Setenv("KIRA_HOME", …)`
   lines and their now-false comments (`recovery_test.go:31-35`).
3. Helper process: replace the `KIRA_HOME` env handoff with a gitsock-specific constant
   (`envGitsockHelperHome = "KIRA_GITSOCK_HELPER_HOME"`, beside `envGitsockHelper`), read it, pass
   to `OpenAt`. The child and `TestRecovery_AfterSIGKILLWithRepositoriesOpen` now genuinely share one
   per-test DB, which is what that test claims to prove.
4. Every gitsock-built `gitsession.Registry` gets a per-test review store:
   `reg.Review = gitreview.NewStore(filepath.Join(kiraHome, "review.db"))`. One small helper
   (e.g. `isolatedRegistry(runner, kiraHome)`) used by all harnesses
   (`newIntegrationServerWithRunner`, `newRemoteIntegrationServerWithRunner`, recovery's fresh
   server, the helper, and any other `NewRegistry` call in gitsock tests — grep, do not trust this
   list). `Server.Close` → `Registry.Close` already closes `Review`, so no extra cleanup. The
   `FullPairingAndRPCLifecycle`/`SecondInstance` second registries get the same store path
   treatment (separate `Store` on the same per-test file is fine; they never serve review calls).
   Do not touch the replaced default store: construction opens nothing (`gitreview/store.go:28-31`).

Verify: after a full run, `~/.kira-space` mtimes unchanged (`stat` before/after) — or delete
`~/.kira-space` first and confirm it is not recreated by `go test ./internal/gitsock/`.

Commit: `test(gitsock): isolate kira.db and review.db per test, never the real KIRA_SPACE_HOME`.

### 3.3 RC3 — event-tolerant, deadline-bounded test client

All in gitsock test files.

1. `testClient` gets an event inbox: `request` (and `readStreamFrame`) append skipped `evt` frames
   to `c.events` instead of discarding them — mirrors the production client (`rpc.ts`), which
   dispatches by frame `T`. Stream reads currently rely on `drainStragglerEvents` to keep `evt`
   frames out; with this they simply skip-and-queue.
2. One awaiting primitive, e.g. `c.awaitRepoChanged(kind string) repoChangedPayload`: consume from
   the inbox first, then read frames; skip (drop) `repo.changed` events of another kind; queue other
   `evt` methods; fail on any non-`evt` frame. Bounded by one overall deadline (§3.3.4).
3. Replace every "first event must be refsChanged" read with `awaitRepoChanged("refsChanged")`:
   `integration_test.go:595,648`, `revoke_test.go:299`, `waitForRefsChanged`, and every other
   `recvEvent("repo.changed")` + `Kind` assertion (grep all). Where a test genuinely asserts
   `worktreeChanged`, await that kind. Keep assertions on `RepoID` exactly as strict.
   `recvEvent` itself stays only if some caller needs "next frame, whatever it is"; otherwise delete.
4. Deadlines: every test-side frame read (`recvHandshake`, `request`, `awaitRepoChanged`,
   `readStreamFrame`) runs under `nc.SetReadDeadline` (one constant, e.g. 30 s — generous; it is a
   hang guard, not a timing assertion). On timeout: `t.Fatalf` naming what was awaited (method/id/
   kind). This is not a retry or skip; a lost event becomes a fast, named failure.
5. Delete `drainStragglerEvents` (and its call sites) once 1-2 land: its 50 ms timing guess and
   its mid-frame desync are both gone with it. If any test relies on asserting "no further event",
   say so in the Result and implement it with the inbox plus a bounded wait, never a partial read.
6. Failure messages name the server's error: `requestOK` (`graphstream_test.go:158-165`) and
   every sibling `T != "res" || !*OK` check (grep `got %+v`) print `*resp.Error` when non-nil.
   Today they print the pointer address, which hid the `E_INTERNAL` text in every flake report.
7. `TestBroker_QueueBoundedAgainstUnlimitedEnqueue`: `t.Cleanup(b.Shutdown)` and, after Shutdown,
   drain every `done` channel (each must yield `PairingAborted`) so the 200 goroutines exit.
   Same check for sibling broker tests that leave requests queued (`DenyPurges…` etc. — grep for
   `b.Request(` goroutines without resolution).

Commits: one for 3.3.1-6 (`test(gitsock): await repo.changed by kind with deadlines; queue events seen during requests`),
one for 3.3.7 (`test(gitsock): release queued broker goroutines in pairing tests`).

### 3.4 Hang follow-through

After 3.1-3.3, run the load recipe with `-timeout 6m` (deliberately below the 10 m default) for
at least 3 full passes. If anything still times out, the Go timeout panic includes the goroutine
dump: identify the blocked test goroutine (not the paused parallel list), root-cause it, fix it in
the same pass, record it in the Result. If no hang recurs, say so plainly; do not invent one.

---

## 4. Scope and ownership

**Owns (zero overlap with P146 Streams — `ade/`, `bridge/`, storage migrations, frontend):**
- `apps/kira-space/internal/gitsock/**` — test files only, plus new `main_test.go`. No gitsock
  production change is expected; if one proves necessary, name it in the Result.
- `apps/kira-space/internal/gitclient/catfile/session.go` and `catfile_test.go` — the one
  non-gitsock production file. RC1 lives there, not in gitsock. Nothing else touches catfile.

**Does not touch:** `storage/`, migrations, `bridge/`, `ade/`, `gitsession/`, `gitrpc/`,
`rpcstream/`, `config/`, frontend, `SPEC.md`.

**Out of scope, flagged for the orchestrator (not a P152 line item):** `gitrpc`, `gitsession`,
`ade` and `bridge` tests also call `gitsession.NewRegistry` without overriding `Review` (23 test
files; list via `grep -rln "NewRegistry(" --include=*_test.go apps/kira-space/internal | xargs grep -L "\.Review = "`),
so they too open `~/.kira-space/review.db`. Same RC2 class, different packages, two of them owned
by P146 right now. Recommend a SPEC follow-up row after P146 lands (e.g. per-package `TestMain`
setting `KIRA_SPACE_HOME`, or a shared `testx` helper). User/orchestrator's call.

---

## 5. End checks

Run from `apps/kira-space`. All must pass on the final tip; quote one decisive line each in the
Result.

1. `go build ./... && go vet ./internal/gitsock/ ./internal/gitclient/catfile/`
2. `gofmt -l internal/gitsock internal/gitclient/catfile` empty; repo lint hook green on a normal
   (non-`--no-verify`) commit.
3. RC1: `go test -race -count=20 -run <new catfile regression test> ./internal/gitclient/catfile/`
   pass; full `go test -race -count=3 ./internal/gitclient/...` pass.
4. `go test -race -count=20 ./internal/gitsock/` pass, no load.
5. Load: 4 busy loops + `go test -race -count=4 -timeout 15m ./internal/gitsock/` pass, 3 consecutive
   times. Also once concurrently with `go test -race ./internal/gitsession/ ./internal/gitrpc/`
   (the cross-process contention case).
6. Real home untouched: `rm -rf ~/.kira-space` before check 4; it must not exist after.
7. Before/after evidence on `79af0ca8`: §2 RC1 overlay repro fails, new regression test fails;
   both pass on tip.
8. No test skipped, excluded, retried or weakened: `git diff 79af0ca8 -- '*_test.go' | grep -E 't\.Skip|-run|retry|Retry'`
   shows no new skip/retry; every changed assertion still checks the same `RepoID`/kind/outcome.

## 6. Acceptance

- RC1, RC2, RC3 each fixed at its root as §3 describes; no retry loop, skip, exclusion, or
  `-count`/`-p` reduction anywhere.
- Catfile regression test exists, fails pre-fix, passes post-fix.
- No gitsock test opens anything under the real `KIRA_SPACE_HOME`.
- Every test-side socket read is deadline-bounded with a named failure.
- §5 checks 1-8 pass and are quoted in the Result.
- Commits per §3 grouping, Conventional Commits, hook green, no `--no-verify` on anything shipped.

## Result

Branch `v2.0-p152` off `v2.0` `69274703`. Commits, in order:

- `c236796e` fix(gitclient): stop catfile ctx watcher synchronously so a post-success cancel cannot kill the session (RC1; `session.go`, regression test `TestSession_CancelAfterSuccessDoesNotKillProcess`)
- `7ca262a0` test(gitsock): isolate kira.db and review.db per test, never the real KIRA_SPACE_HOME (RC2; `main_test.go`, `isolatedRegistry`, `envGitsockHelperHome`)
- `fcc21793` test(gitsock): release queued broker goroutines in pairing tests (3.3.7)
- `13741138` test(gitsock): await repo.changed by kind with deadlines; queue events seen during requests (RC3)
- `f946eecf` test(gitsock): wait for broker queued-count emissions instead of racing onEnqueued (found by check 4, see below)

No gitsock production file touched. Only production change: `catfile/session.go`.

### Deviations

- Event-order and deadline work (RC3): `wireFrame.String()` prints the server error text, so every existing `%+v` failure message names it (covers all `got %+v` sites without editing each). `readStreamFrameIgnoringEvents` and `requestIgnoringEvents` collapsed into `readStreamFrame` / `request`. Goroutine readers and "expect closed" reads call `armReadDeadline` rather than `readRaw`.
- Not deadline-bounded: `handshake_test.go` `clientReceive` (in-process `net.Pipe`, no socket). No test asserts "no further event" via drain; `matrix_test.go` cross-repo leakage check keeps its own 300 ms read deadline.
- Extra finding, fixed in `f946eecf`: `TestBroker_QueuedCountChangeIsEmittedEvenBehindAPresentedHead` read its subscriber slice right after `onEnqueued`, which runs before the emit (`pairing.go:187-202`). Failed 1 of 20 passes in check 4 (`got [1 2], want [1 2 3]`). Test-only race; now waits on a channel.

### Broker hang finding (3.4)

`TestBroker_QueueBoundedAgainstUnlimitedEnqueue` is deterministic (fake clock, no I/O); it was only listed in the timeout dump because it is parallel and paused. Likely cause of the 10-minute hang: a serial test blocked on a deadline-less read (RC3) or a `SQLITE_BUSY`-stalled shared DB (RC2). Not reproduced on demand before or after. After the fixes: 3 load passes (4 busy loops, `-race -count=4`) plus one concurrent with gitsession/gitrpc, all passed, no timeout, no hang. Nothing to root-cause; none invented. The test also leaked 200 goroutines; fixed (`fcc21793`).

### End checks

1. Build/vet: `go build ./... && go vet ./internal/gitsock/ ./internal/gitclient/catfile/` clean.
2. `gofmt -l internal/gitsock internal/gitclient/catfile` empty; every commit passed the pre-commit hook, none with `--no-verify`.
3. `go test -race -count=20 -run CancelAfterSuccess ./internal/gitclient/catfile/` ok (5.97s); `go test -race -count=3 ./internal/gitclient/...` all ok.
4. `go test -race -count=20 ./internal/gitsock/` ok on the final tip (22m33s). First attempt failed once on the broker race above; fixed and rerun clean.
5. Load, 4 busy loops, `-race -count=4 -timeout 15m`: pass 1 ok 474s, pass 2 ok 310s, pass 3 ok 400s. Concurrent with `go test -race ./internal/gitsession/ ./internal/gitrpc/`: gitsock ok 320s, gitsession ok 25s, gitrpc ok 18s.
6. Real home: `rm -rf ~/.kira-space` then a `-count=1` run: not recreated. A later `-count=20` run left `~/.kira-space/{kira.db,review.db,logs}` with mtimes mid-run, but P146 stream worktrees were running ade/bridge tests concurrently (see open item). Proof it is not gitsock: `HOME=$(mktemp -d) GIT_CONFIG_GLOBAL=/root/.gitconfig go test -race -count=1 ./internal/gitsock/` ok and `$HOME/.kira-space` absent.
7. Before/after: on `69274703` (session.go reverted), `go test -race -count=5 -run CancelAfterSuccess` passes with no load (window too narrow here), but with 4 busy loops and `-count=20` it fails: `iteration 52: write |1: file already closed` and `iteration 44: ...`. On the tip it passes `-count=20`.
8. `git diff 69274703 -- '*_test.go' | grep -E '^\+.*(t\.Skip|retry|Retry)'` empty. Every `RepoID`/kind assertion kept; kind checks moved from "first event" to `awaitRepoChanged(kind)`.

### Open item

23 test files in `gitrpc`, `gitsession`, `ade` and `bridge` still call `gitsession.NewRegistry` without overriding `Review`, so they open the real `~/.kira-space/review.db` (and `ade`/`bridge` tests likely `kira.db`). Same RC2 class, outside P152 ownership; two of those packages are owned by P146. List: `grep -rln "NewRegistry(" --include=*_test.go apps/kira-space/internal | xargs grep -L "\.Review = "`. Recommend a follow-up row after P146 lands (per-package `TestMain` setting `KIRA_SPACE_HOME`, or a shared `testx` helper).
