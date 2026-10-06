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
