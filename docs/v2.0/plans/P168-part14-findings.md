# P168 Part 14: findings, Space git process layer

Plan: `P168-part14-space-git-process.md`. Reviewer: one Opus pass, report only.
Base commit: `fbf725e` (tree surveyed by plan). HEAD reviewed: `18a9afc` (plan commit only on top;
no Part 14 code change between them).

## Checks

- `go vet ./apps/kira-space/internal/{gitclient,ghclient,gitpath,gitaskpass}/...`: clean.
- `go test -race -count=1` same packages: 7 packages ok.

## Block status

- Block 1 (spawn seam and gate): done.

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
