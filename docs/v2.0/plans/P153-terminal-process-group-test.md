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

Run first, before any edit, and paste the decisive line of each into `## Result`.

```sh
cd /home/user/kira-studio-c
S=<scratchpad>   # never the tree

# R1 — baseline, plain go test. Expect PASS, ~2s per run (PID-1 reap wait).
time go test ./internal/terminal/ -run '^TestSessionCloseKillsProcessGroup$' -count=20

# R2 — RC1 deterministic, slow subreaper. Wrapper source below.
go test -c -o $S/terminal.test ./internal/terminal
REAP_EVERY=100ms $S/reaper/reaper $S/terminal.test -test.run '^TestSessionCloseKillsProcessGroup$' -test.count=3  # PASS
REAP_EVERY=6s    $S/reaper/reaper $S/terminal.test -test.run '^TestSessionCloseKillsProcessGroup$' -test.count=3  # FAIL :171

# R3 — RC1 under load: 2x nproc busy loops alongside, plain go test and the compiled binary.
for i in $(seq 8); do (while :; do :; done) & done
go test ./internal/terminal/ -run '^TestSessionCloseKillsProcessGroup$' -count=30
$S/terminal.test -test.run '^TestSessionCloseKillsProcessGroup$' -test.count=30
kill %1 %2 %3 %4 %5 %6 %7 %8

# R4 — parallel packages (P151's shape): whole Go tree, terminal included.
go test ./... -count=1 2>&1 | grep -E '^(FAIL|ok).*internal/terminal'

# R5 — RC2 + §1.3, shell variant. Expect FAIL :171 plus the WARN line, ~10s per run.
SHELL=/bin/sh go test ./internal/terminal/ -run '^TestSessionCloseKillsProcessGroup$' -count=3 -v
```

Slow subreaper (`$S/reaper/main.go`, own `go.mod`, `go build -o reaper .`):

```go
package main

import ("os"; "os/exec"; "syscall"; "time")

func main() {
	syscall.RawSyscall(syscall.SYS_PRCTL, 36, 1, 0) // PR_SET_CHILD_SUBREAPER
	d, _ := time.ParseDuration(os.Getenv("REAP_EVERY"))
	cmd := exec.Command(os.Args[1], os.Args[2:]...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	cmd.Start()
	go func() {
		for {
			time.Sleep(d)
			for {
				var ws syscall.WaitStatus
				p, _ := syscall.Wait4(-1, &ws, syscall.WNOHANG, nil)
				if p <= 0 {
					break
				}
				if p == cmd.Process.Pid {
					os.Exit(ws.ExitStatus())
				}
			}
		}
	}()
	select {}
}
```

R1/R3/R4 may pass; RC1 is reaper-latency-bound, and this container's reaper is ~2s. R2 is the
deterministic proof. If R2 does not fail pre-fix, stop and re-plan; §1 RC1 is then wrong.

---

## 3. Fix

### 3.1 RC1 — liveness means "not a zombie" (`session_test.go`)

- Add test helper `processAlive(t, pid) bool`. Gone or zombie means dead.
  - Linux (`proc_linux_test.go`): read `/proc/<pid>/stat`. Missing file means dead. Parse the
    state field after the last `)` (comm can contain spaces and parens). `Z` or `X` means dead.
  - Other unix (`proc_other_test.go`, `//go:build !linux`): `ps -o stat= -p <pid>`. Exit status
    1 with empty output means dead; first char `Z` means dead. Darwin ships `ps`; no new
    dependency, no `go.mod` edit.
- `TestSessionCloseKillsProcessGroup`: replace both `Kill(pid,0)` checks with `processAlive`.
- Deterministic hardening a real race would trip:
  - Before `Close`: assert child is in a different process group than the shell
    (`syscall.Getpgid`). Fails loudly if a shell change ever stops job control, which would
    silently turn this into a single-group test.
  - After `Close` returns: assert `sess.done` is closed (non-blocking select). Close returning
    without `done` means the F1 fallback ran, which this test must never need.
  - On failure, `t.Fatalf` includes both pids' `/proc` state line (or `ps` line), not only
    "condition not met".
- No timeout change. No skip. No retry.

### 3.2 RC2 — keep `ptmx` pollable (`session.go`)

- `newSession`, after `pty.StartWithSize` succeeds: `syscall.Dup(int(ptmx.Fd()))`,
  `syscall.SetNonblock(fd, true)`, close the original `*os.File`, `os.NewFile(uintptr(fd),
  "/dev/ptmx")`. `os.NewFile` sees `O_NONBLOCK` and registers with the poller. Any error on these
  steps: close what was opened, kill and reap `cmd`, return the error. No half-open session.
- `Resize`: stop calling `pty.Setsize` (its `Fd()` flips the shared file description back to
  blocking; `O_NONBLOCK` is per description, so a second dup does not escape it). Use
  `s.ptmx.SyscallConn()` + `Control` + `syscall.Syscall(SYS_IOCTL, fd, syscall.TIOCSWINSZ,
  &winsize)` with `pty.Winsize`. `syscall.TIOCSWINSZ` exists on linux and darwin. No `x/sys`
  direct dependency.
- Grep the package for any other `Fd()` on `ptmx` after setup; none allowed.
- Darwin: kqueue pollability of a pty master is not verifiable in this sandbox. Check
  `creack/pty` issue history around v1.1.20-v1.1.21 (non-blocking ptmx introduced, then reverted)
  before deciding. If darwin support is not clearly documented as working, gate the rewrap behind
  a `//go:build linux` helper and keep darwin's current path. Then rewrite the
  `session.go:232-237` comment to state the true per-OS behaviour. Record the choice and its
  source in `## Result`.
- Rewrite the `session.go:232-237` comment either way; the current Linux claim is false.
- No regression test for RC2 under bash, since it needs an escaped job. Its check is R5 (§5):
  `Close` returns with `done` closed and no WARN line. A dedicated test that spawns
  `sh -c 'trap "" HUP; …'`-style escape is optional only if it can be made deterministic in
  one shell-independent `Command`; otherwise none (CLAUDE.md unit-test bar).

---

## 4. Scope and ownership

- Single sequential implementer. Owns `internal/terminal/**` only.
- Docs it may touch: this plan's `## Result`, `docs/v2.0/SPEC.md` (P153 row, new follow-up row),
  `docs/ARCHITECTURE.md` `## Known open items` (one entry for §1.3).
- Not touched: ADE paths (P149), other packages' test homes (P154), `go.mod`, workflows.
- Commits (Conventional Commits, each passing the hook without `--no-verify`):
  1. `test(terminal): treat zombie as dead in process-group close test` (§3.1).
  2. `fix(terminal): keep pty master pollable so Close can unblock the reader` (§3.2).
  3. `docs(v2.0): P153 result and follow-up row`.
- Follow-up row, appended at the end of the SPEC phase table, next free `P` number after scanning
  every chapter's `SPEC.md` (P155 if nothing newer exists), status **Proposed**: "Decide whether
  terminal `Close` kills jobs outside the shell's process group". Body: §1.3's evidence, the
  dash deterministic failure, the semantics trade-off (dash/disowned/`NO_HUP` jobs vs.
  real-terminal behaviour), option: SIGHUP then SIGKILL every process group whose session id is
  the shell's pid (Linux `/proc/*/stat` field 6; darwin `getsid` over `kern.proc.all`). No other
  phase renumbered.
- `ARCHITECTURE.md` Known open items: "Terminal `Close` does not reach background jobs a non-
  forwarding shell (dash, disowned bash job, zsh `NO_HUP`) leaves in another process group; they
  outlive the tab. Follow-up P<n>."

---

## 5. End checks

All on this container, post-fix. Paste the decisive line of each into `## Result`.

1. `go vet ./internal/terminal/` and the repo's pre-commit hook: clean.
2. `go test -race -count=50 ./internal/terminal/ -run '^TestSessionCloseKillsProcessGroup$'`:
   PASS. Wall time per run drops from ~2s to well under 1s (no reaper wait).
3. `go test -race -count=50 ./internal/terminal/`: PASS (whole package).
4. Loaded: R3 with `-race -count=50`, both `go test` and compiled binary: PASS.
5. R2 with `REAP_EVERY=6s` and `REAP_EVERY=60s`: PASS (proves reaper independence).
6. R4: whole tree, `internal/terminal` `ok`.
7. R5 (`SHELL=/bin/sh`): still FAILs on the child-alive assertion (§1.3, deferred), but `Close`
   returns in ~4s, `done` closed, no `WARN … did not exit after SIGKILL` line. Linux only; if
   §3.2 gated darwin, state so.
8. `git diff --stat 2387223f..HEAD -- . ':!internal/terminal' ':!docs'`: empty.

---

## 6. Acceptance

- R2 fails pre-fix and passes post-fix at `REAP_EVERY=6s` and `60s`.
- End checks 1-8 as stated, real output quoted in `## Result`.
- No skip, exclude, retry loop, or timeout bump in any test.
- `session.go` comment on the F1 fallback matches measured behaviour.
- SPEC P153 row reads **Done** with a one-line cause and fix; follow-up row present and
  **Proposed**; Known open items entry present.
- If R2 does not reproduce pre-fix: do not ship §3.1 as "the fix". Ship §3.1's hardening as
  diagnostics only, ship §3.2, record "not reproduced" with R1-R4 evidence in `## Result`, and
  mark the P153 row accordingly.

---

## Result

_Pending implementation._

### Reproduction (pre-fix)

### Deviations

### End checks

### Open item
