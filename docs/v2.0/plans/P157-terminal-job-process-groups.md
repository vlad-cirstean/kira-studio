# P157 — Terminal `Close` and jobs outside the shell's process group: plan

Plan for `docs/v2.0/SPEC.md`'s **P157** row. Planned on branch `v2.0-c2` at `335c2e8f`. Line numbers
are at that commit.

**Status: done.**

**Discovery method, disclosed.** Worktree has no `.codegraph/` index. `codegraph_explore` ran
against the main checkout's index (2 calls: `Session.Close`/`newSession`/`readLoop`/`waitExitCode`,
`TestSessionCloseKillsProcessGroup`/`openTestSession`/`loginShell`/`Registry.CloseAll`). Shown code
matched this worktree. `Read`/`Grep` only for the P153 plan, SPEC, ARCHITECTURE and the test file.
Every claim below is a real run on a scratch copy of the package (`git archive` of `internal/
{terminal,testx,appevent,ipcerr}` plus `go.mod`), 4 vCPU container, go1.27.1, bash 5.2.21, dash,
zsh 5.9 (installed for this: `apt-get install -y zsh`). Nothing was written to the tree except
this file.

---

## 1. Findings

### 1.1 Who survives `Close` today (baseline probe, one run per cell)

Probe: open a session, type `<line>`, wait until the job's comm is `sleep`, `Close`, check
`/proc/<job>/stat` 300 ms later.

| line | dash | bash | zsh |
|---|---|---|---|
| `sleep 300 &` | alive, Close 4.0 s | killed, 1 ms | killed, 1 ms |
| `sleep 300 & disown` | n/a (no builtin) | alive, Close 4.0 s | alive, Close 4.0 s |
| `nohup sleep 300 >/dev/null 2>&1 &` | alive, 0 ms | alive, 2 ms | alive, 1 ms |
| `(trap '' HUP; exec sleep 300) &` | alive, 4.0 s | alive, 4.0 s | alive, 4.0 s |

Two facts, not one:

- **F1 — jobs the shell does not hang up survive.** Expected for `nohup`, `disown` and `trap ''
  HUP` (the user asked for it). For dash it is every job: dash never forwards SIGHUP.
- **F2 — any survivor that still holds the pty slave stalls `Close` 4 s** (`closeGracePeriod` +
  `closeKillWait`). `readLoop` ends only on master EIO, which needs every slave holder gone. The
  shell is long dead; `Close` waits out SIGHUP grace, SIGKILLs an empty group, then force-closes
  `ptmx`. `CloseAll` (app quit) and per-window close pay it.
- **F2b — same root, spontaneous exit.** Bash and zsh, `sleep 3000 & disown; exit`: no `onExit`
  after 5 s. Tab shows "running" with no shell until the job ends.

### 1.2 What real terminals do

From their source as recalled, not re-verified here: VS Code (node-pty `kill()` signals the shell
pid), tmux, kitty, xterm all signal the shell or its process group, close the master, and rely on
the kernel hangup plus the shell's own SIGHUP forwarding. None sweeps the whole session. Kernel
hangup on master close signals the session leader and the foreground group only; a running
background job in an orphaned group gets nothing. So in every one of them a dash background job, a
disowned job and a `nohup` job survive the tab, and the tab closes as soon as the shell exits. That
matches the stated expectation: closing a tab kills its jobs, except `nohup`/`disown`.

### 1.3 The P153 residual load-only flake

Hypothesis checked: is it bash failing to forward under load (an F1 case)? Baseline (no change),
`SHELL=/bin/bash`, compiled `-race` test binary, 1500 back-to-back iterations of the
`sleep 300 &` / `Close` / poll-4-s cycle inside one process, 8 busy loops on 4 vCPU:
`DONE n=1500 fails=0`. Not reproduced, so not attributed. The shape P153 recorded (live `sleep`,
shell gone) is what an unforwarded hangup looks like, but nothing here proves bash skipped it.
§4.3 adds the diagnostics P153 asked for, so a recurrence names its cause. Option (b) would mask
it, not explain it.

---

## 2. Options and decision

**(a) Keep shell-forwarding semantics; document; pin the test to a forwarding shell.** Matches every
real terminal and honours `disown`. Leaves F2/F2b.

**(b) Sweep the session: SIGHUP (then SIGKILL) every process group whose sid is the shell pid.**
Fixes dash. But it kills disowned jobs: from outside the shell a disowned bash job and a dash job
are the same kernel state (own pgrp, same sid, `S`, ppid 1 once the shell dies). No signal, `/proc`
field or flag tells them apart. Breaking `disown` contradicts the expectation and every real
terminal. SIGKILL escalation would also kill `nohup` jobs. Darwin needs `sysctl kern.proc.all`
plus `getsid` per pid, untestable here. Pid-reuse window between enumerate and kill is small but
real (sid match is re-read, not held). Rejected.

**(c) cgroup / subreaper.** cgroup v2 needs a delegated, writable subtree (systemd user slice or
root); unavailable in many sandboxes and absent on darwin. Killing the cgroup kills `nohup` and
`setsid` jobs too, which is worse than (b). `PR_SET_CHILD_SUBREAPER` only reparents orphans to the
app, making the app reap them; it decides nothing about killing and is Linux-only. Rejected.

**Recommended: (a) plus a fix for F2/F2b ("a+").** Session lifetime follows the shell process, not
the slave's last holder: once the shell has exited, drain buffered output briefly, then close the
master. Same as real terminals. Survivors get the kernel hangup on master close (EIO on tty I/O),
nothing more. Bounds `Close` with survivors at ~`exitDrain` instead of 4 s, and ends a tab whose
shell exited. Scratch prototype (§3 design, `exitDrain` 200 ms), same probe as §1.1:

- `sleep 300 & disown` bash/zsh: Close 203/201 ms (was 4.0 s); dash `sleep 300 &`: 201 ms;
  `trap` rows: ~201 ms. Survivors still alive, killed rows still killed.
- `sleep 3000 & disown; exit`: `onExit` after 520 ms (bash), 210 ms (zsh) (was none in 5 s).
- `go test -race -count=20 ./internal/terminal/`: ok with `SHELL=/bin/bash` (25.1 s) and zsh (6.8 s).

F1 for dash is accepted by design, recorded in ARCHITECTURE as behaviour, not an open item.

---

## 3. Design (`internal/terminal/session.go`)

1. New constant beside `closeKillWait`: `exitDrain = 200 * time.Millisecond`. Comment: once the
   shell exits, how long to keep reading output still buffered before closing the master; a job
   left holding the slave (disown, nohup, dash) never sends EIO.
2. `readLoop` (`session.go:135`) starts two goroutines before its read loop:
   - waiter: `code, waitErr = waitExitCode(s.cmd); close(exited)`.
   - closer: `select { case <-readDone: case <-exited: select { case <-readDone: case
     <-time.After(exitDrain): _ = s.ptmx.Close() } }`.
   After the read loop: `close(readDone)`, `<-exited`, then the existing order unchanged (mark
   closed, `ptmx.Close`, `onExit(code, waitErr)`, `close(done)`, `unregister`). `code`/`waitErr`
   are read only after `<-exited` (happens-before via close). Use a `time.NewTimer` and stop it, or
   `time.After`; either is fine at one per session.
   `pty.StartWithSize` sets `cmd.Std*` to the tty `*os.File`, so `Wait` starts no copy goroutines
   and returns at process exit (verified: prototype passes `-race`).
3. `waitExitCode` doc: "the reader goroutine's own call" becomes "the session's waiter goroutine".
4. `Close` (`session.go:212`): logic unchanged. Rewrite its doc and the `closeKillWait` and
   in-body comments: jobs outside the shell's group are deliberately not signalled (shell
   forwarding, as real terminals); a survivor no longer stalls `Close` on Linux because readLoop
   closes the master `exitDrain` after the shell exits; the SIGKILL step remains for a shell that
   ignores SIGHUP; the forced `ptmx.Close` + WARN remains the darwin bound.
5. `newSession` comment at `session.go:100-103`: "dies with the tab" holds for jobs the shell hangs
   up; say so in one clause.

No new file, no new dependency, no exported API change.

---

## 4. Tests (`internal/terminal/`)

Bar: process-lifecycle concurrency, real shells, so they clear CLAUDE.md's test bar. No skips for
flakes, no timeout bumps. Skip only for a shell binary absent from the machine (`exec.LookPath`),
with `t.Skipf("zsh not installed")`.

### 4.1 Shared helper (`session_test.go`)

Extract from `TestSessionCloseKillsProcessGroup` (`session_test.go:138-173`):
`startJob(t, sess, col, line string) int` — writes `line + "\necho started-$!\n"`, parses the pid
(existing LastIndex logic), waits until `procInfo` comm is `sleep`, returns the pid. Plus
`openShellSession(t, shell, id)`: `t.Setenv("SHELL", path)` then `openTestSession`.
`t.Setenv` forbids `t.Parallel`; the package has none.

### 4.2 Forwarding shells kill jobs (portable, `session_test.go`)

`TestSessionCloseKillsProcessGroup` becomes a subtest per shell in `{bash, zsh}`, each pinned via
`SHELL`. Body unchanged otherwise (pgid check, `done` closed on return, poll `processAlive` to
`closeGracePeriod+2s`). This removes the `SHELL=/bin/sh` failure: the test asserts forwarding,
which dash does not do by design.

### 4.3 Failure diagnostics for the P153 residual

On the alive-after-Close failure, print: `Close` duration, child `/proc/<pid>/status` lines
`State|PPid|SigBlk|SigIgn|SigCgt` captured before and after `Close`, the shell's same lines
before `Close`, last 300 bytes of `col.text()`. Linux: read `/proc/<pid>/status` in
`proc_linux_test.go` (new helper `procStatus(pid) string`); `proc_other_test.go` returns `""`.

### 4.4 Survivors, Linux only (new `session_linux_test.go`, `//go:build linux`)

Linux-gated because the fast path needs the pollable master (P153 `ptmx_linux.go`).

- `TestSessionCloseLeavesUnhungJobs`: table `{dash "sleep 300 &"}`, `{bash "sleep 300 & disown"}`,
  `{bash "nohup sleep 300 >/dev/null 2>&1 &"}`, `{zsh "sleep 300 & disown"}`. Each: `startJob`,
  time `Close`, assert `done` closed, elapsed `< closeGracePeriod` (the 4 s stall would fail it;
  real ~200 ms leaves 10x headroom under load), job `processAlive` after 300 ms. `t.Cleanup` SIGKILLs
  the job. Asserts the decision: parity, no stall.
- `TestSessionExitsWhenShellExitsLeavingJob`: bash; `startJob` with `sleep 300 & disown`, then
  write `exit\n`. Assert `done` within
  `closeGracePeriod`, `exitCount() == 1`, exit code 0, job alive; cleanup kills it.

Existing tests stay as they are.

---

## 5. Reproduction recipe (run before the fix, paste decisive lines into Result)

- R1: `SHELL=/bin/sh go test ./internal/terminal/ -run TestSessionCloseKillsProcessGroup -count=3`
  on unchanged code: FAIL, `processes alive after Close`, ~8 s each.
- R2: write §4.4 tests first, run them on unchanged `session.go`: `TestSessionCloseLeavesUnhungJobs`
  fails on elapsed (~4 s); `TestSessionExitsWhenShellExitsLeavingJob` fails on `done` timeout.
- R3: after the fix, both pass and R1's command passes (the test now pins its own shell).

---

## 6. Ownership and commits

Single sequential implementer. Owns `internal/terminal/**` and docs (`docs/v2.0/SPEC.md`,
`docs/ARCHITECTURE.md`, this plan's Result). Conventional Commits, hook must pass, no
`--no-verify`.

1. `fix(terminal): end a session when its shell exits, not when the slave closes` — §3 plus §4.4.
2. `test(terminal): pin the process-group test to forwarding shells, add failure diagnostics` —
   §4.1-§4.3.
3. `docs: record P157 job-survival decision` — ARCHITECTURE, SPEC, Result.

Docs:

- `docs/ARCHITECTURE.md:4269`: delete the first sentence pair of the Known open item (jobs outside
  the group); keep the darwin blocking-master sentence as its own entry, adding that on darwin a
  survivor still stalls `Close` and a shell-exited tab with a survivor stays open. Add one
  behaviour line to the terminal section near `:2516`: `Close` hangs up the shell's group only;
  jobs the shell does not hang up (dash, `disown`, `nohup`, `trap '' HUP`) outlive the tab, as in
  real terminals; the session ends `exitDrain` after the shell exits.
- SPEC: see §9. Also fix the P153 row's stale "P155" cross-ref to "P157".

---

## 7. End checks

1. `go vet ./internal/terminal/` clean; hook green on every commit.
2. `go test -race -count=50 ./internal/terminal/` with `SHELL=/bin/bash`, `SHELL=/usr/bin/zsh`,
   `SHELL=/bin/sh`: all ok (the forwarding test pins its shell, so `SHELL` only changes the other
   tests' shell).
3. Loaded: 8 busy loops on 4 vCPU, compiled `-race` binary,
   `-test.run 'TestSessionCloseKillsProcessGroup|TestSessionCloseLeavesUnhungJobs|TestSessionExitsWhenShellExitsLeavingJob' -test.count=500`:
   PASS. Record any failure's §4.3 diagnostics verbatim; do not retry it away.
4. No leftover jobs: `pgrep -fc '^sleep 300$'` is 0 after the runs.
5. `go test ./... -count=1` ok.
6. `git diff --stat 335c2e8f..HEAD -- . ':!internal/terminal' ':!docs'`: empty.

---

## 8. Acceptance

- Bash and zsh background jobs die on `Close`; `TestSessionCloseKillsProcessGroup` passes under any
  `$SHELL`.
- dash jobs and `disown`/`nohup` jobs survive, by design, and `Close` returns in `< closeGracePeriod`
  on Linux (measured ~200 ms; was 4 s).
- A shell that exits with a survivor ends its session (`onExit` once, code 0) on Linux.
- No session sweep, no cgroup, no new dependency.
- Darwin: not tested here. The waiter/closer code is portable; on darwin the master is blocking,
  so the `exitDrain` close does not interrupt `Read` and F2/F2b remain there, bounded by `Close`'s
  existing WARN path. Survivor tests are `//go:build linux`; the forwarding test runs on both.
  Recorded in ARCHITECTURE's darwin open item.
- P153 residual: either reproduced with diagnostics naming a cause, or recorded as not reproduced
  in §7.3's run count.

---

## 9. SPEC row update

Rename to **P157 Terminal `Close`: keep shell-forwarding job semantics, end the session when the
shell exits**. Status **Done.** text: Decision: no session sweep; jobs the shell does not hang up
(dash, `disown`, `nohup`) outlive the tab, as in VS Code/tmux/kitty. A sweep cannot tell a
disowned job from a dash job. Fixed: a surviving job holding the pty stalled `Close` 4 s and kept a
shell-exited tab open; the session now ends `exitDrain` (200 ms) after the shell exits (Linux;
darwin unchanged). Process-group test pinned to bash/zsh. Plan link.

---

## Result

**Status: done.** Plan option (a+) as written, no deviations.

Commits: `62605c53` fix (readLoop waiter/closer, `exitDrain`, survivor tests); `134bfca2` test
(shared `startJob`/`openShellSession`, per-shell forwarding subtests, `procStatus` diagnostics);
docs commit follows.

**Repro, before the fix.** R1: `SHELL=/bin/sh go test -run TestSessionCloseKillsProcessGroup`:
`processes alive after Close`, 8.11 s, child `sleep` `S` ppid 1. R2: `TestSessionCloseLeavesUnhungJobs`
failed 3 of 4 cases (`Close took 4.002s, want < 2s`; bash nohup passed); `TestSessionExitsWhenShellExitsLeavingJob`:
`session did not end after its shell exited`. R3: after the fix both pass; R1 command passes (test pins its shell).

**End checks.**
1. `go vet ./internal/terminal/` clean (also `GOOS=darwin`); hook green on every commit.
2. `go test -race -count=50 ./internal/terminal/`: ok for `SHELL=/bin/bash` (185.9 s), `/usr/bin/zsh` (154.8 s), `/bin/sh` (180.6 s). zsh is installed here, so no zsh subtest skipped; the tests skip only when the binary is absent.
3. Loaded (8 busy loops, 4 vCPU, compiled `-race` binary, `-test.count=500`, `SHELL=/bin/bash`): `PASS`, `exit=0`. No failure, so no diagnostics to record. P153 residual not reproduced.
4. Leftover `sleep 300` after the run: 0.
5. `go test ./... -count=1`: all ok.
6. `git diff --stat 335c2e8f..HEAD -- . ':!internal/terminal' ':!docs'`: empty.

**Harness note.** A first loaded run launched under `nohup` failed ~300 of 500 iterations
(`Close took 2.2s`, bash child alive with `SigIgn: 1`). Cause: `nohup` makes SIGHUP ignored in the
test binary, and bash/dash and their jobs inherit it. Not a product bug; rerun under `setsid` (`SigIgn` 0) passed.

**Darwin.** Untested. Master stays blocking, so the `exitDrain` close cannot interrupt the read;
ARCHITECTURE keeps that as its own open item.

**Open items.** Darwin entry only.
