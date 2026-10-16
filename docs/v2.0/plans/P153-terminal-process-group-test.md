# P153 — `internal/terminal` TestSessionCloseKillsProcessGroup failure: plan

Plan for `docs/v2.0/SPEC.md`'s **P153** row. Planned on branch `v2.0-c` at `2387223f`. Line numbers
are at that commit.

**Status: planned.**

**Discovery method, disclosed.** Worktree `/home/user/kira-studio-c` has no `.codegraph/` index.
`codegraph_explore` ran against the main checkout's index instead (`internal/terminal/session.go`
diffed byte-identical to this worktree's copy first): `Session.Close`, `readLoop`, `newSession`,
`Registry.Open`, `openTestSession`, `collector`, `loginShell`, `sessionEnv`,
`TestSessionCloseKillsProcessGroup`. `Read`/`Grep` only for this plan's format, `go.mod`, and the
`creack/pty` v1.1.24 module source. Every claim below is a real run on this 4 vCPU Firecracker
container (`SHELL=/bin/bash`, `/bin/sh` -> dash, go1.27.1). Probes ran on a scratch copy of the
package; nothing was written to the tree.

---

## 1. Root causes

Two independent defects, plus one design gap recorded as a follow-up (§1.3).

### RC1 — test treats a dead, unreaped child as alive (the observed flake)

`session_test.go:171-173` waits for `syscall.Kill(pid, 0) != nil` on both shell and `sleep 300`.
`kill(pid, 0)` succeeds on a zombie. Sequence on SIGHUP under bash:

1. `Close` sends `SIGHUP` to `-shellPID`. Bash forwards `SIGHUP` to its jobs, then exits.
2. Bash often exits before reaping `sleep`. `sleep` becomes an orphaned zombie, reparented to PID 1
   (or nearest `PR_SET_CHILD_SUBREAPER` ancestor).
3. Zombie stays `kill(pid,0)`-visible until that reaper calls `wait`.

Evidence:

- Probe, 6/6 runs: right after `Close` returns, child is `Z ppid=1`, shell gone. `Close` took
  0.5-1.3ms (SIGHUP path, `done` fired).
- PID 1 here is `process_api`. Orphan reap latency measured 1144/1890/1891/1891ms. So each passing
  run of the real test takes ~2s: it waits on PID 1's reap poll, not on any kill.
- Budget is `closeGracePeriod+2s` = 4s after `Close`. Any reaper slower than 4s fails the test.
  Under CPU load, or under a harness that sits between test and PID 1 (mutation tool, CI
  runner, `docker --init`-less container, a subreaper), it fails. Fits P151's single unexplained
  failure and the 4 clean reruns.
- Deterministic repro (§2): slow subreaper wrapper. `REAP_EVERY=100ms` PASS; `REAP_EVERY=6s` FAIL
  `session_test.go:171: condition not met within 4s`.

Production unaffected: the child is dead. Reaping orphans is the reaper's job, never the app's.
The test asserts the wrong property. Fix is in the test (§3.1), not a skip or a longer timeout.

### RC2 — `Close`'s F1 fallback never unblocks `readLoop` on Linux (production bug)

`session.go:232-238` claims closing `ptmx` "reliably unblocks a pending Read on Linux". False.
`creack/pty` v1.1.24 `ioctl.go:9` calls `f.Fd()` for every ioctl (`StartWithSize` -> `Setsize`,
and our own `Resize` -> `pty.Setsize`). `os.File.Fd()` switches the fd to blocking mode and drops
it from the netpoller. A blocked `read(2)` then survives `ptmx.Close()`; Go defers the real close
until that read returns.

Evidence (`SHELL=/bin/sh`, escaped child, §1.3): `Close` took 6.004s, logged
`WARN terminal: session did not exit after SIGKILL and ptmx close`, `done=false`. `done` only
closed after the test killed the child by hand. So the reader goroutine, the master fd and the
unreaped shell zombie leak until every slave holder exits. Every `Close` caller (app-quit
`CloseAll`, window close) pays the full 6s per stuck session.

Fix verified on scratch copy (§3.2): dup the master fd, set `O_NONBLOCK`, re-wrap with
`os.NewFile` (pollable), stop calling `Fd()` afterward. Same dash probe: `Close` returned in
4.003s with `done=true`, no WARN. `go test -race -count=3` on the package green.

### 1.3 Design gap, not fixed here — jobs outside the shell's process group survive `Close`

Interactive (`-i`) shells run each background job in its own process group, same session.
`Kill(-shellPID, …)` reaches only the shell's group. Bash and zsh (default `HUP` option) forward
`SIGHUP` to jobs; dash does not, and nor does bash for a `disown`ed job or zsh with `NO_HUP`.

Evidence: under `SHELL=/bin/sh`, `TestSessionCloseKillsProcessGroup` fails deterministically
(3/3), child `S ppid=1 pgrp=<own> sid=<shell's>` after `Close`.

Fixing it means signalling every process group in the session. That changes semantics a real
terminal emulator has (closing Terminal.app does not kill a dash background job or a disowned
bash job). That is a user design decision, not a P153 fix (CLAUDE.md: "a real design decision"
becomes its own named follow-up phase). §4 adds it as a proposed row. RC2's fix still matters
there: it bounds `Close` whatever that decision is.

---

## 2. Reproduction recipe

Run first, before any edit, and paste the decisive line of each into `## Result

Status: implemented. Commits: `3e664b51` test helper, `352262e1` Close fix, `cc0c3262` exec-wait.

### Reproduction (pre-fix)

- R1: `-count=20` PASS, 39.8 s (~2 s per run, PID-1 reap wait).
- R2: `REAP_EVERY=100ms` PASS; `REAP_EVERY=6s` `session_test.go:171: condition not met within 4s`. RC1 confirmed.
- R5 (`SHELL=/bin/sh`): FAIL 10.09 s plus `WARN terminal: session did not exit after SIGKILL and ptmx close`. RC2 confirmed.

### Deviations

- Third cause, not in the plan: test closed right after the pid printed, so SIGHUP could land in the child's fork-to-exec window, where bash's own handler swallows it. Evidence: under 8 busy loops, original code with a 100 ms reaper failed 9/200 (live `sleep`, shell gone, `Close` 1 ms). Fix: wait until `/proc/<pid>` comm is `sleep` (`procInfo`). After: 0/1200 in two batches, but 1 failure each in ~200 and ~700 runs (live `sleep`, same shape) while a 4-vCPU box ran 8 busy loops. Cause not found. Not retried, skipped or timeout-bumped. Open: if it recurs, capture the shell's output and `/proc/<shell>/status` at failure.
- Darwin gate: `creack/pty` v1.1.24 README documents manual `syscall.SetNonblock` for `Close` interrupting `Read`, with no per-OS claim and no darwin evidence. Rewrap gated to Linux (`ptmx_linux.go`; `ptmx_other.go` keeps `pty.Setsize` and the blocking fd). Comment in `Close` rewritten.
- Failure message prints `procInfo` lines for both pids (via a local poll loop instead of `waitFor`).

### End checks

1. `go vet ./internal/terminal/` clean; pre-commit hook passed without `--no-verify` on all 3 code commits.
2. `-race -count=50` single test: `ok 13.272s` (was ~2 s/run, now ~0.27 s).
3. `-race -count=50` whole package: `ok 76.690s`.
4. Loaded (8 busy loops): `go test` `ok 34.666s`; compiled binary `PASS` (50 runs). One earlier loaded run of each failed on the residual above.
5. `REAP_EVERY=6s` and `60s`: PASS.
6. `go test ./... -count=1`: `ok internal/terminal 1.210s`.
7. `SHELL=/bin/sh`: still FAIL (child alive, §1.3, deferred); no WARN; `Close` ~4 s, `done` closed. Linux only.
8. `git diff --stat 2387223f..HEAD -- . ':!internal/terminal' ':!docs'`: empty.

### Open item

Residual load-only flake above. Jobs outside the process group: P157 (SPEC), ARCHITECTURE Known open items.
