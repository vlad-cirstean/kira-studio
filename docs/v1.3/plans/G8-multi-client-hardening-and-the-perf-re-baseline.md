# G8 — Multi-client hardening: the two-windows/two-repos matrix, teardown, revocation, recovery, and the perf re-baseline

> **What this phase is.** The eighth phase of `docs/v1.3/SPEC.md`'s headless-git chapter, and the
> last one before Ship (G9). Its job is not to add a git feature — it is to *stress everything
> G1–G7 built* against the one requirement SPEC §6 opens with and no upstream phase ever had:
> **"multiple simultaneous VS Code windows/extensions connect to one backend at once, whether
> pointed at the same repo or different repos."** SPEC's own G8 row lists five deliverables
> (two-windows/two-repos matrix, disconnect teardown, revoke-while-connected, stale-socket
> recovery, perf re-baseline) and covers **"new"** — there is genuinely no upstream P-number to
> port (confirmed: `/home/user/vlad-cirstean/kira-version-vscode`'s `docs/plans/` holds P0–P11,
> P15, P16 and nothing about multiple windows, a shared backend, or a socket).
>
> **In one line: this phase writes the concurrency tests nobody has written yet, fixes the five
> real bugs those tests already found while this plan was being written — one of which leaks a
> `RepoEntry` on 12 attempts out of 12 over the real socket — proves stale-socket recovery across
> a real process kill for the first time, and re-measures the transport under the load G4–G7 added
> on top of what G3 measured.**
>
> **This is a test-and-fix phase, and it says so out loud.** It ships **no new product surface**,
> **no new RPC method**, **no new wire type**, and **no `CONTRACT_VERSION` bump** (D1). Every Go
> file it touches outside `*_test.go` is touched to fix a bug this phase's own probes reproduced.
> If an implementer finds themselves designing a feature, they have left the phase.
>
> **The findings section is dominated by things that were RUN, not read.** Every `Fn` below that
> claims a bug carries the command that reproduces it and the output it produced in this
> container. Two decisions (D14, D15) are flagged for a human before implementation starts (§11).

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

Authored against the tree as it stands at `claude/feature-v1-3-headless-git` (`80b5f3f2`, the whole
of G1–G7). Every claim below was checked against source read, or a command run, **in this
container** — including G1–G7's own plans, which are records of intent and are verified against the
code they produced rather than trusted.

| Claim | Evidence |
|---|---|
| G7 landed in full | `git log --oneline`: `bc13f652`…`80b5f3f2`; `internal/gitaskpass/` exists (broker/helper/prompt/interpose), `gitsession/remote.go` (671 lines), `gitsession/autofetch.go` (137) |
| `CONTRACT_VERSION` is 16 in all three hand-maintained places | `gitrpc/contract.go:13`, `packages/git-ipc/src/validate.ts:7`, `tests/e2e-real/git-pairing-real.spec.ts:93` |
| The scoped race suite is green today, in ~54 s | `time go test -race` over SPEC's own scoped list + `gitreview` + `gitaskpass` → every package `ok`, `real 0m54.413s`, of which `gitsock` alone is **47.5 s** |
| The git tiers are already large: 71 top-level tests in `gitsock`, 54 in `gitsession` | `grep -c '^func Test' …/gitsock/*_test.go …/gitsession/*_test.go` |
| **No test anywhere opens two *different* repositories at once** | `grep` across `internal/gitsock`, `internal/gitsession`: every fixture builder returns one repo dir per test, and every multi-client test (`RepoChangedReachesEveryHolder`, `WalksArePrivatePerConnection`, `UndoSlotIsSharedAndAttributed`, `TwoConnectionsReviewIndependently`, `SecondRemoteOpIsRefusedAndCancelIsHonest`, `RefcountAndDisconnectTeardown`) points both clients at the **same** repository |
| `tests/e2e-real/multiwindow-real.spec.ts` is **not** a git spec | its own header: "P8 §6.2 — the real multi-window proof this sandbox *can* run"; it drives two browser pages at `/?window=w-one`/`w-two` against **SQLite** and asserts each keeps only its own **tabs**. It contains the string `git` nowhere. It is v1.2's *studio* multi-window proof and has no bearing on this chapter |
| So there is **no** git multi-window coverage at the e2e tier at all | `grep -rn "git" apps/kira-studio/tests/e2e-real/*.spec.ts` → only `git-pairing-real.spec.ts`, which drives **one** socket client |
| `rpcstream.Serve` returns **without waiting for in-flight handler goroutines** | `session.go:306-315` — `for { raw, err := s.conn.Receive(); if err != nil { return } ; s.handleRaw(raw) }`; `handleRaw` (`:271`, `:279`) dispatches `go s.handleRequest(...)` / `go s.handleOpen(...)`. `defer s.close()` cancels their contexts but joins nothing |
| `gitsock.handleConn` therefore runs `gconn.Close()` while request handlers may still be running | `server.go:188` `defer gconn.Close()`, `:198` `sess.Serve()` |
| `Conn.Close()` swaps in **fresh** `held`/`walks` maps and is guarded by `closeOnce` **only for `done`** | `conn.go:253-270` |
| `RepoEntry.teardown()` sets `e.subs = nil` and closes every remaining subscriber | `entry.go:235-241` |
| `Registry.Close()` tears down every entry **regardless of refcount** | `registry.go:148-160` — no `refs` check, unlike `expire` (`:133-144`) |
| The refs / detail / range-count caches and the head-stale flag are dropped in **exactly one place** | `entry.go:113-124` `note()`, reached only from `pump()` (`:106-111`), reached only from the fsnotify watcher's `Signals()` channel. `grep -n "refs.drop\|detail.dropAll\|rangeCount.drop\|headStale = true"` finds no other writer |
| `RunOp` and `RunRemote` never drop them | `ops.go:323-383`, `remote.go:288-376` — both call `statusAndInProgress` + `Head` (which *set* head) and nothing else |
| `startAutoFetch` is called from exactly one place: `newRepoEntry` | `grep -rn "startAutoFetch"` → `entry.go:98` and its own definition |
| `Setsid` is **opt-in per spec**, set on remote-op spawns only — G7 D6 was narrowed by the orchestrator to §11.3's alternative | `runner.go:51-57` ("narrowed to remote ops only per the …"), `:230-233` (`Setsid` → `SysProcAttr{Setsid:true}`, else `Setpgid:true`); the only `Setsid: true` in the tree is `remote.go:186` |
| Pull's **integrate** spawn (a local write) therefore has no `Setsid` and no askpass env | `remote.go:522-540` — a plain `gitclient.Run(...Spec{Dir, Args: integrateArgv, ReadOnly:false})` inside `Repo.Write` |
| `gitclient.Discovery` is a **single-slot** cache keyed by `configuredPath` | `discovery.go:206-238` — one `cached`/`cachedConfigured` pair, not a map |
| Every `gitrpc` call passes `""` as `configuredPath` today | `gitrpc/handlers.go`'s `handleAppInit`/`handleRepoOpen` → `Status(ctx, "")`. `kiraVersion.git.path` has no server-side reader (G7 §10 hands it here) |
| The remote-op slot's claim is a real mutex CAS | `remote.go:30-37` — `claim` under `s.mu`, `if s.kind != "" { return false }` |
| `Broker.WithOp` keys each in-flight op by 16 fresh `crypto/rand` bytes, and the socket token is compared with `subtle.ConstantTimeCompare` | `gitaskpass/broker.go:180-195`, `:118` (`randHex(32)`) |
| There is **no single-instance guard** anywhere in `main.go` | `grep -rn "SingleInstance\|singleInstance"` across `apps/kira-studio/` → nothing. SPEC §3.2 explicitly supports a second instance ("this instance does not listen") |
| `bridge.GitClientsService.Revoke` goes to `gitsock.Server.Revoke`, which closes only **this** server's live connections | `server.go:227-241`; a non-listening `Server` has `s.conns` permanently empty |
| G1–G4's plans hand multi-client items forward to **"G11"** — the pre-reorder number for this phase | G1 §10/§11, G2 §9/§10, G3 §9/§10, G4 §10 all say G11; G5/G6/G7 say G8. SPEC's own "Reordered 2026-09-07" note is why |
| Upstream has no equivalent phase to port | `/home/user/vlad-cirstean/kira-version-vscode` @ `0ea4cfe`: `docs/plans/` = P0–P11, P15, P16, plus P4b/P4c/P6a. Nothing about windows, sockets or a shared backend |
| The toolchain here: Go 1.27.0, git 2.43.0, bun 1.3.11, node 22, `node_modules` present | run here |
| `go build ./apps/kira-studio/internal/...` is clean | run here |
| `go.mod`'s direct block already contains test-only modules (`go-cmp`, `testcontainers-go`) | `go.mod:16`, `:23-28` |

### 0.2 Scope

1. **Fix the five bugs this plan's own probes reproduced** (F1–F5 → D3–D7), each as its own commit
   with its own regression test.
2. **Build the concurrency unit tier** the matrix rests on — tests designed to fail only under real
   concurrent access, run at `-count=10` (§3.5, D9).
3. **Build the two-windows/two-repos matrix** end to end over the real socket: M1–M4 (§3.6, D8).
4. **Revoke-while-connected**, against a connection holding a graph walk, a review walk, an
   in-flight remote op and a pending credential prompt: M5 (§3.7).
5. **Stale-socket recovery across a real process kill**, with repositories open — proven in this
   container for the first time, via a helper process (§3.8, D11): M6.
6. **The perf re-baseline** — an opt-in `KIRA_GIT_PERF=1` probe set extending G3 D22's, measuring
   the load G4–G7 added on the same transport, asserting nothing (§3.9, D12).
7. **Close, or explicitly accept, each caveat G2/G6/G7 handed forward to this phase** (§10, D13).
8. Prove it (§7), and say precisely which macOS gaps block G9 and which do not (§7.2).

### 0.3 Not in this phase

Everything in §9's table, but the ones most likely to be mistaken for G8 work:

- **Any new RPC method, event, stream, param or wire type.** `CONTRACT_VERSION` stays **16** (D1).
  A hardening phase that needs a contract change has found a design gap, not a version bump —
  §11.2 is where the one candidate is raised rather than landed quietly.
- **`stash.list`** — still the last of G3 F16's four rejections. G12.
- **`op.run`'s `tagPush`/`tagDeleteRemote`**, reset, cherry-pick, search, PR links, worktrees,
  stacked branches. G12–G17.
- **Making `kiraVersion.git.path` server-owned** (G7 §10's hand-off). D13(e) *records* why it must
  not become a per-window setting and leaves the move to G9+; building a settings leaf here is
  product surface this phase does not ship.
- **A toolbar marker for a self-disabled auto-fetch** (G7 §10). `packages/git-ui` may not change.
  D13(d) answers the question G7 actually asked ("did anyone notice") and stops there.
- **`review.end`** (G6 §11.1). D13(c) settles it with the matrix in front of it, and the answer is
  still no — which is a *finding*, not a deferral.
- **Any change to `packages/git-ui`, `packages/git-core`, `packages/git-ipc` or
  `apps/kira-studio-vscode`.** This phase changes **no TypeScript at all** (§4).
- **Editing `docs/v1.3/SPEC.md`.** `docs/v1.1/README.md`'s standing rule: a chapter spec is not
  retro-edited by a phase. Everything this plan settles that the SPEC left open is settled *here*.

### 0.4 Ground rules

- Every decision in §2 cites a finding; every finding in §1 cites something read or **run** here,
  with the command and its output.
- `AGENTS.md` applies in full: **no stubbed error handling, no `TODO: fix later`, no skipped
  validation.** Scope left out is left out entirely.
- **Comments very concise, only where the code cannot say it itself.**
- **Tests only where `AGENTS.md`'s bar is met** — and this phase is squarely inside the bar's own
  first-named category ("concurrency (ordering, backpressure, cancellation, races)"), which is why
  it is almost entirely tests. D9 states what still does *not* earn one.
- **Fixture repositories scope their git config to themselves** — `git -C <tmpdir>`, `--local`,
  per-spawn `-c`, or `GIT_CONFIG_GLOBAL=/dev/null`+`GIT_CONFIG_SYSTEM=/dev/null` env, **never
  `git config --global`** (G4 D15). Every new fixture builder in this phase copies
  `remote_test.go`'s existing `fixtureEnv()`, never `os.Environ()`.
- Commits are Conventional Commits, granular, landing as work completes; each one compiles and its
  own tests pass (§6).

---

## 1. Findings

Every finding in this section that claims a defect was **reproduced in this container** with a
throwaway probe written against the real production types. The probes are not part of the
deliverable — §3's tests are their permanent form — but their exact output is quoted so the
implementer can confirm they are seeing the same thing.

### F1 — A `repo.open` that completes after its connection closed leaks the `RepoEntry`, permanently, 12 times out of 12 over the real socket

**The mechanism.** `rpcstream.Serve` (`session.go:306-315`) returns the moment `Receive` errors and
joins **nothing** — `handleRaw` dispatched every request onto `go s.handleRequest(...)`
(`session.go:271`). `gitsock.handleConn`'s `defer gconn.Close()` (`server.go:188`) therefore runs
while a `repo.open` handler may still be inside `gitsession.Conn.Open`. `Conn.Close`
(`conn.go:253-270`) swaps in a **fresh** `held` map; the in-flight `Open` then writes its hold into
that fresh map (`conn.go:199`) and **nothing ever calls its `release`**.

The `closeOnce` guard on `conn.go:254` protects only `close(c.done)` — it does not make `Close`
final for the hold set.

**Reproduced at the unit tier**, against the real `Conn`/`Registry`:

```
=== RUN   TestProbe_OpenAfterCloseLeaksHold
    after Close-then-Open: entry present=true refs=1 heldLen=1
    LEAK CONFIRMED: entry still holds 1 ref(s) after the connection closed
=== RUN   TestProbe_OpenRacingCloseLeaksHold
    leaked holds in 200 Open/Close races: 160
```

**Reproduced end to end over the real socket**, with a real `git init` fixture, real pairing, and a
real `repo.open` frame sent immediately before `net.Conn.Close()` — asserting through a counting
`Registry.NewWatcher` that a later open of the same repository builds a *second* watcher (no leak)
rather than reusing the first (leak):

```
=== RUN   TestProbe_DisconnectDuringRepoOpenLeaksTheEntry
    entries still held after a disconnect during repo.open: 12/12
    LEAK CONFIRMED end to end in 12/12 attempts
```

The control is the existing `TestIntegration_RefcountAndDisconnectTeardown`, which does the same
thing but **waits for the `repo.open` response** before closing the socket — and passes
(`--- PASS ... (0.92s)`). The single difference between pass and leak is whether the response was
awaited.

**What leaks, per occurrence:** one `RepoEntry` — an `fsnotify` watcher (on macOS, one file
descriptor per file in every watched `refs/` directory, G2 F10), the `pump()` goroutine, one
`subscriber` goroutine, the detail/diff/refs caches, the undo slot, the range-count slot, a
`cat-file --batch`/`--batch-check` process pair if one was ever started, and — if the server-owned
interval is non-zero — a **running auto-fetch timer that keeps fetching that repository forever**.

**Reachability is high, not theoretical.** `apps/kira-studio-vscode/src/extension.ts` calls
`repo.open` on reaching `connected`, and the connection manager re-dials with backoff on every
drop; a VS Code window reload, a window close, or a Kira Studio restart all produce exactly this
interleaving. This is the most serious thing in the phase and D3 fixes it first.

### F2 — `RepoEntry.teardown()` is not safe against a concurrent subscribe, and crashes the process two different ways

`teardown()` (`entry.go:235-241`) sets `e.subs = nil` and closes every subscriber still in the map.
Nothing marks the entry as torn down, so:

**(a) `Subscribe` after teardown writes to a nil map.**

```
=== RUN   TestProbe_SubscribeAfterTeardownPanics
    PANIC CONFIRMED: Subscribe after teardown: assignment to entry in nil map
```

**(b) An `unsubscribe` after teardown closes the same subscriber a second time.**

```
=== RUN   TestProbe_UnsubscribeAfterTeardownDoubleCloses
    PANIC CONFIRMED: unsubscribe after teardown: close of closed channel
```

Both are reachable through `Registry.Close()`, which — unlike `expire` (`registry.go:133-144`) —
tears entries down **without checking `refs`** (`registry.go:148-160`). `Server.Close()` does
`s.wg.Wait()` first (`server.go:270`), but `wg` counts only `acceptLoop`/`expireLoop`/`handleConn`,
and `handleConn` returns without joining the request goroutines it spawned (F1's same root cause).
So a `repo.open` or a `repo.close` still in flight when the user quits Kira Studio can take the
process down with a panic on the way out.

Neither is reachable through `expire()`, which re-checks `refs == 0` under the registry lock and
deletes the entry from the map before tearing it down — an `Acquire` can never be handed an entry
`expire` is about to destroy. `Registry.Close` is the only bypass.

### F3 — `RepoEntry.CatFile()` after teardown starts a `cat-file` pair nothing will ever close

```
=== RUN   TestProbe_CatFileAfterTeardown
    catfile before teardown=<nil>, after CatFile()=true (a fresh session nothing closes)
--- PASS
```

`CatFile()` (`entry.go:198-211`) is lazy and unguarded: it constructs a session whenever
`e.catfile == nil`, including after `teardown()` already closed one and after the entry has left
the registry. Every subsequent read on that entry then holds two orphaned `git cat-file` processes
for the life of the app.

Its most likely real trigger is not shutdown but **auto-fetch**: `autoFetchTick`
(`autofetch.go:73-113`) runs on `context.Background()` and `RunRemote`'s post-op read-back
(`remote.go:366-373`) calls `statusAndInProgress` and `Head` on the entry *after*
`remoteOp.forceCancel()` has already fired in `teardown()`. Same class as F2, same fix.

### F4 — Turning auto-fetch on never arms the timer for a repository that is already open

`startAutoFetch` has exactly one caller, `newRepoEntry` (`entry.go:97-99`); `rescheduleAutoFetch`
is only ever called from *inside a tick* (`autofetch.go:87`, `:93`, `:106`, `:112`). So if
`Registry.Settings` reports `autoFetchMinutes == 0` when the entry is created, no timer is ever
armed, and no later settings change can arm one — the user must close every window on that
repository and wait out the five-minute linger (G2 D12) before auto-fetch can start.

G7 D23's own text says "a setting change takes effect within one interval, with no need to recreate
the entry". That is true only in the on→different-interval direction. The off→on direction, which
is the one a user actually performs (the default is `0`, "off" — G7 D23's own last line), never
takes effect.

`disabled` is sticky after a genuine fetch failure, and `startAutoFetch` already respects it
(`autofetch.go:29`), so re-arming on open cannot resurrect a timer G7 deliberately killed.

### F5 — The shared caches have exactly one invalidation source, and it is the watcher — so a write is not reflected for ~210 ms, and never at all if a watch was lost

`refs`, `detail`, `rangeCount` and the head-stale flag are dropped in one place only:
`RepoEntry.note()` (`entry.go:113-124`), reached only from `pump()`, reached only from the
`fsnotify` watcher. Neither `RunOp` nor `RunRemote` drops any of them.

Measured, against a real repository, with the real watcher:

```
=== RUN   TestProbe_RefsCacheStaleAfterOwnWrite
    branches before: [doomed main]
    branches immediately after branchDelete: [doomed main]
    STALE CACHE CONFIRMED: refs.list still lists the branch op.run just deleted
    watcher closed the stale window after ~209.991075ms
```

**This is not a user-visible bug through the shipped UI, and the plan says so rather than
overstating it.** `packages/git-ui/src/state/refs.ts:61-64` reloads *only* on `repo.changed`, and
`entry.go:117-124` drops the caches **before** the fan-out (G4 D7's own ordering rule), so the
reload the UI performs always sees fresh data. The exposure is (a) any client that calls
`refs.list` on its own initiative inside the window, and (b) — the one that matters — **the case
where the watcher signal never arrives at all**: `fsnotify`'s `Add` can fail with `EMFILE` and G2
D10 deliberately logs-and-skips that one directory, and `ErrEventOverflow` is a documented state.
On macOS, kqueue costs one descriptor per *file* in every watched directory (G2 F10), which is
exactly where `EMFILE` comes from.

So the design is "correct as long as the watcher is perfect", with no second line of defence. D10
adds one, cheaply.

### F6 — G7 D6 was narrowed to remote ops, and the narrowing leaves exactly one interactive-capable spawn uncovered

`runner.go:51-57` and `:230-233` show the shipped shape: `Spec.Setsid` is opt-in, and
`remote.go:186` is the only setter. G7 §11.3 offered exactly this as "the alternative" and the
orchestrator took it — a legitimate scoping call, recorded in the code's own comment ("per the
orchestrator's own scoping call").

Re-examined here with the matrix in front of it, the narrowing is **safe for reads** by
construction: a read spawn (`rev-parse`, `for-each-ref`, `log`, `cat-file`, `status`, `diff-tree`)
cannot invoke `ssh`, a credential helper, or a pinentry. It is **not** fully safe for local
*writes*. The concrete case:

- Pull's integrate phase (`remote.go:522-540`) runs `merge`/`rebase` through a plain
  `gitclient.Run` with no `Setsid` and no askpass env.
- On a repository with `commit.gpgsign=true` and a passphrase-protected key — which **this
  container's own global git config has** (G4 F13 found and documented exactly that) — a merge
  commit invokes `gpg`, which invokes `pinentry`, which reads `/dev/tty` when one exists.
  `GIT_TERMINAL_PROMPT=0` governs git's own prompts, not gpg's.
- In a packaged GUI launch there is no controlling terminal and the spawn fails instead of
  hanging. In a `bun run dev` launch there is one, and it hangs — holding `Repo.Write`, which
  blocks **every read in every window** (G7 F8).

The same argument applies to G5's `op.run` write spawns (`merge --continue`, a `revert` that
commits, a signed `tagCreate`). It does **not** apply to any read. D6 proposes the one-word,
writes-only extension; §11.1 flags it, because it changes behaviour for code five phases already
proved.

### F7 — Revocation from a second Kira Studio instance writes `revoked_at` and severs nothing

SPEC §3.2 explicitly supports a second instance ("Lock already held: another instance is serving;
this instance does not listen"), and there is no single-instance guard anywhere in `main.go`. A
non-listening instance still:

- opens the same `kira.db` (`storage.Open` on the same file — SQLite permits it),
- binds `bridge.GitClientsService` with a `*gitsock.Server` whose `s.conns` is permanently empty
  (`server.go:44`; `addConn` is only reached from `handleConn`, which only the listening instance
  runs),
- renders a fully functional *Connected editors* pane.

So `Revoke` from that instance writes `revoked_at` (`server.go:229`) and then closes **zero**
connections (`server.go:232-238`). The paired VS Code window keeps its live, already-authenticated
session — able to read every repository and run every write — until it happens to re-handshake.
G1 D18's ordering ("write `revoked_at` **first**, then close") is still correct; it is the "then
close" half that has nothing to close.

This is the only *security-shaped* finding in the phase. It is narrow (it needs two Kira Studio
instances, which macOS's LaunchServices makes awkward but `open -n` and a dev build alongside a
packaged one both produce) and it has no cheap complete fix — cross-process revocation would need a
channel between instances that this chapter does not have. §11.2 puts the call to a human with a
recommended minimal answer.

### F8 — `Revoke` is asynchronous in a way G1 D18's wording does not admit

`Server.Revoke` closes the `net.Conn` and returns. Teardown of that connection's session state —
`Conn.Close()`, disposing walks, releasing refs — happens on the `handleConn` goroutine whenever it
next notices (`server.go:188`, reached after `sess.Serve()` returns). G1 D18 says revocation
"closes every live connection holding that id" *before the call returns*, which is true of the
socket and false of everything behind it.

That is fine as a design — a revoked client cannot issue anything new once its socket is gone — but
it is not what a test asserting "revoke severs cleanly" should assume, and it interacts with F1: a
revoke landing during a `repo.open` leaks the entry exactly as a disconnect does. M5's tests are
written against the true guarantee (D8's own wording), not the plan-doc one.

### F9 — The remote-op slot is genuinely airtight, and already has a concurrent test; what is missing is the *simultaneous* case

`remoteOpSlot.claim` (`remote.go:30-37`) is a mutex-guarded compare-and-set on `s.kind`, and
`TestIntegration_SecondRemoteOpIsRefusedAndCancelIsHonest` (`remote_test.go:827`) already drives it
with a *genuinely in-flight* fetch (a sleeping git shim, a `started` channel, then B's `remote.run`
on the same repository from a second connection) — not a sequential fake.

What no test does is fire N `remote.run`s at the *same instant* and assert exactly one wins. That
is the one shape a CAS can still get wrong (a double-release, a lost cancel, a slot left claimed
after an early return), and it is cheap at the `gitsession` tier under `-race -count=10`. M2 adds
it; the plan explicitly does **not** rewrite the existing test, which is good and stays.

### F10 — `Walk.Stream` holds the walk's mutex across `emit`, which parks on credits — a per-connection stall, never a cross-window one

`walk.go:47` (`mu sync.Mutex // serialises every operation on this walk, including Stream's own
emit`) and G3 §10's own hand-forward both state it. `emit` calls `gate.acquire(ctx)`
(`rpcstream/session.go:205`), which blocks until the client grants a credit.

Traced through: a client that opens `graph.stream` and stops granting credits holds `w.mu` until its
stream's ctx is cancelled — by a `cancel` frame, or by `Session.close()` on disconnect
(`session.go:291-300`). A concurrent `graph.loadMore` **on the same connection** then queues behind
it. Because `Walk` is per-`(connection, repository)` (SPEC §6), **no other window is affected** —
and `Conn.Close()`'s `disposePair` → `w.dispose()` → `w.mu.Lock()` cannot deadlock, because
`Serve`'s deferred `s.close()` has already cancelled the stream ctx by the time `gconn.Close()`
runs (`server.go` defers are LIFO: `gconn.Close` → `removeConn` → `nc.Close`).

The one reachable hang is `repo.close` arriving while that connection's own stream is parked on
credits: `Conn.CloseRepo` blocks in `disposePair`, and the `repo.close` never answers.
`RepoState.close()` has no caller in `packages/git-ui` (G6 F9), so it is unreachable through the
shipped UI — but it is a real property to pin with a test rather than to rediscover. M4 pins it.

### F11 — Nothing is shared across repositories except three process-wide objects, and each is safe today for a stated reason

Checked directly, because "no cross-repo leakage" (SPEC's matrix scenario 3) is a claim, not a
default:

| Process-wide object | Keyed by | Safe because |
|---|---|---|
| `gitsession.Registry.entries` | `RepoID` (worktree root, or git dir for a bare repo — G3 D7) | one entry per repository; two repos never share a `RepoEntry`, a watcher, a cache, an undo slot or a remote-op slot |
| `gitaskpass.Broker.ops` | a fresh 16-byte `crypto/rand` op id | a git child of repo A cannot address repo B's prompter without guessing B's op id; the socket token is a separate 32-byte secret compared with `subtle.ConstantTimeCompare` |
| `gitclient.Discovery` | **a single slot** keyed by `configuredPath` (`discovery.go:206-238`) | every caller passes `""` today, so the slot never thrashes |

The third row is a latent hazard rather than a current bug, and it is *why* `kiraVersion.git.path`
must not become a per-window setting: two windows configuring different git paths would make every
`app.init` a cache miss and re-probe. D13(e) records it against G7 §10's hand-off.

`gitrpc.Router` holds no per-repo state (`handlers.go:40`, `type Router struct{ deps Deps }`), so
nothing there can leak across repositories either.

### F12 — G3's perf harness still runs, and its numbers say first paint is bounded by the page read, not by the transport

Run here, unchanged:

```
$ KIRA_GIT_PERF=1 go test -run TestGraphStreamPerf ./apps/kira-studio/internal/gitsock/ -v
TestGraphStreamPerf: n=20000 chunks=10 firstChunk=248.070416ms total=249.916742ms
                     meanBytesPerChunk=42167 totalBytes=421676
```

Three things fall straight out, and they shape D12:

1. **`firstChunk ≈ total`.** All ten chunks leave within 2 ms of each other because `Walk.Stream`
   reads a whole page (`logsession.DefaultPageSize = 5000`, `logsession/session.go:23`) into the
   store *before* emitting anything. The dominant cost of first paint is `git log` + parsing 5000
   records, not the socket and not FlatBuffers.
2. **A page is 10 chunks of 500 rows** (`walk.go:214` `chunkRows = 500`) and ~422 KB total, ~42 KB
   per chunk — three orders of magnitude under the 8 MiB frame cap, which is the distribution
   figure G3 §10 asked this phase to record.
3. SPEC's own known open item ("perf budgets need re-measurement, not re-derivation") is therefore
   answerable for the graph, in this container, today: **~250 ms to a 5000-row first page**,
   against upstream's ≤300 ms `postMessage` budget. What has *not* been measured is everything
   G4–G7 added on the same transport, or anything at all under two concurrent connections.

### F13 — The scoped race suite is green and costs ~54 s, of which `gitsock` is 47.5 s

```
$ time go test -race -count=1 <SPEC's scoped list + gitreview + gitaskpass>
ok  …/gitsock  47.518s      …  real 0m54.413s
```

That fixes the shape of this phase's own exit criterion (D16): `-count=10` over the whole scoped
list would be ~9 minutes of mostly-irrelevant repetition of `gitsock`'s existing 71 integration
tests, whose slowness is real sleeps and real `git` spawns, not contention. The honest run is
`-count=1` over the scoped list **plus** a second, `-run`-filtered `-count=10` pass over this
phase's own concurrency tests.

### F14 — There is no cross-process test of stale-socket recovery anywhere, and the harness for one already exists

G1 §8.1(b) item 7 proves only the *in-process* half: a second `Server.Start()` against the same
`KIRA_HOME` does not listen and does not unlink the first's socket. Nothing anywhere kills a
serving process and restarts against its leftovers — which is the actual scenario SPEC §3.2 was
written for, and the one G2–G7's much larger `Registry` state has never been exercised against.

It is provable here. `acquireLock` (`lock.go:16-29`) holds an `flock` on an fd the kernel releases
on process death; a `SIGKILL`ed process leaves the `git.sock` inode behind because nothing runs
`net.UnixListener.Close`. And this repo already has the helper-process idiom
(`remote_test.go:127` `TestAskpassHelperProcessForGitsock`, the stdlib `os/exec` pattern), so a
child process that starts a real `gitsock.Server`, opens a real repository, prints its readiness and
then waits to be killed is a ~60-line addition, not a new mechanism.

### F15 — Orphaned git children after a hard kill are self-limiting, and the claim is worth pinning rather than assuming

Reasoned from the code and worth one test rather than one sentence: every long-lived child this
chapter spawns is attached to the parent by a pipe (`logsession`'s paused `git log` writes to
stdout; `catfile`'s pair reads from stdin). When the parent is `SIGKILL`ed the kernel closes those
fds, so the paused walk takes `SIGPIPE` on its next write and the `cat-file` pair sees EOF on stdin.
A mid-transfer `git fetch` is `Setsid` (F6) and reparents to init, but its own progress writes to a
closed stderr end the same way.

So recovery should find no squatting children — but "should" is exactly what M6 is for, and Linux
gives a cheap check (`/proc/<pid>` after the kill, plus a scan for `git` processes whose cwd is the
fixture repo). Stated as a finding so the test asserts a *reasoned* expectation rather than
recording whatever it happens to see.

---

## 2. Decisions

### D1 — Zero contract change: `CONTRACT_VERSION` stays 16, and `packages/*` are byte-for-byte unchanged

The standing rule since G1 D20 is "bump when a wire method, event, stream or param is added,
changed or removed". This phase adds none. Every bug in §1 is behind the wire, and every fix is a
Go-side lifecycle correction that a correctly-behaving client cannot observe except by no longer
being harmed.

The prompt's own instruction is the check: *if you find yourself wanting a bump, treat it as a
signal to re-examine scope*. Exactly one candidate came up — a `repo.changed`-adjacent signal so a
client could learn that a *different* window wrote — and it is refused in §11.2 rather than
smuggled in: the existing `repo.changed` already carries it, via the watcher, for every holder.

**Checklist item, not a hope:** `git diff --stat` for this phase must show **no** file under
`packages/` or `apps/kira-studio-vscode/`, and no change to `gitrpc/contract.go`.

### D2 — Everything this phase builds is a test or a fix; the four scenario groups are named M1–M6 and each is a file

SPEC's phrase is "two-windows/two-repos matrix". Read literally that is a 2×2 (windows × repos),
which is four cells; the prompt's own enumeration adds disconnect, revocation and recovery. This
plan fixes the matrix as **six named scenario groups**, each with an explicit list of assertions,
so "the matrix" is never a word an implementer has to interpret:

| # | Scenario | Where |
|---|---|---|
| **M1** | Two connections, **one** repository, independent work: private walks, shared caches, shared undo slot, cross-window write visibility | `gitsock/matrix_test.go` |
| **M2** | Two connections, **one** repository, an **exclusive** operation: the remote-op slot under simultaneous attempts, from both tiers | `gitsession/concurrency_test.go` + `gitsock/matrix_test.go` |
| **M3** | Two connections, **two different** repositories: full independence, no cross-repo signal, no shared cache, no goroutine or process growth | `gitsock/matrix_test.go` |
| **M4** | One connection disconnects **mid-operation** while another stays live on the same repository: a write in flight, a stream open, a remote op running, a credential prompt pending | `gitsock/matrix_test.go` |
| **M5** | **Revoke while connected**, against a connection holding each of those four things | `gitsock/revoke_test.go` |
| **M6** | **Stale-socket recovery** across a real `SIGKILL`, with repositories open in the killed instance | `gitsock/recovery_test.go` |

M1–M4 land in one file because they share one fixture shape (two paired clients, one or two
repositories) and one set of helpers; M5 and M6 are separate because each brings its own mechanism
(revocation through the `Server` API; a helper process).

### D3 — `Conn` gets a `closed` flag, and `Open` releases rather than storing when it loses the race

Fixing F1. The smallest correct change, and the one that keeps `Close` a single source of truth:

```go
// Conn
closed bool // guarded by mu; set by Close. Open must not store a hold on a closed connection —
            // rpcstream.Serve returns without joining its own request goroutines (session.go:306),
            // so a repo.open can and does complete after handleConn's deferred Close ran, and a
            // hold stored then is never released by anyone (F1).
```

- `Close()` sets `c.closed = true` **inside** the same critical section that swaps the maps.
- `Open()`'s final critical section (`conn.go:189-200`) gains a first arm: if `c.closed`, unlock,
  `unsubscribe()`, `release()`, and return the summary it identified. **The caller still gets a
  correct answer** — the repository really was identified — and the response is simply never
  delivered (`rpcstream.removeActiveWork` already drops it, `session.go:163-171`), which is exactly
  SPEC §6's "the result is simply not delivered anywhere".
- `Walk()` gains the same guard, returning `ErrRepoNotHeld` — a closed connection holds nothing,
  and the existing `c.held[repoID]` lookup already produces that answer today, so this is
  belt-and-braces rather than a second behaviour.

Rejected: making `handleConn` join the request goroutines before `gconn.Close()`. That means
`rpcstream.Session` growing a `WaitGroup` over every dispatched handler and `Serve` blocking on it
— which would make a disconnect *wait* for a detached, deliberately uncancellable write (G5 D8,
SPEC §6's own rule) before the socket goroutine could exit. The flag is one field and changes no
lifetime.

Rejected: `sync.Once`-guarding the whole of `Close`. It already is, for `done`; the bug is not a
double `Close`, it is an `Open` that finishes afterwards.

### D4 — `RepoEntry` gets a `tornDown` flag, and `Subscribe`/`CatFile`/`teardown` all respect it

Fixing F2 and F3 together, since they are one root cause.

```go
// RepoEntry, guarded by mu
tornDown bool
```

- `teardown()` becomes idempotent: under `mu`, if `tornDown` already, return; else set it, take the
  subscriber set, and clear it (to an **empty map, never nil** — a nil map is what F2(a) writes
  into).
- `Subscribe(id, deliver)` returns a **no-op unsubscribe** when `tornDown`, without constructing a
  subscriber and without touching the map. Its caller (`Conn.Open`) then holds a ref on a dead entry
  for a moment and releases it normally — no panic, no leak.
- The unsubscribe closure closes its subscriber **only if it actually deleted it from the map**,
  which is what kills F2(b)'s double `close`. (`sync.Once` is kept: it guards a double *call*, not
  a race with teardown.)
- `CatFile()` returns the existing session, or — if `tornDown` — a session it does not memoise…
  no. **`CatFile()` returns `nil` when `tornDown`**, and its three callers in `queries.go` treat a
  nil session as `ErrRepoTornDown` (a plain sentinel in `gitsession`, mapped by `gitrpc` through the
  existing `mapGitError` default arm to `E_INTERNAL`). Returning a live session from a dead entry is
  what F3 is; returning a fresh unmemoised one is worse (an orphan per call).

Rejected: making `Registry.Close()` respect refcounts, so teardown could never race a live holder.
That would leave watchers and `cat-file` pairs running past process shutdown for every window still
connected, which is the opposite of what `Server.Close()` wants (G2 D12 step 5). The flag makes
teardown *safe* rather than *deferred*.

### D5 — Auto-fetch is armed on `Conn.Open`, not only on entry construction

Fixing F4. `Conn.Open`, on the path where it stores a new hold, calls a new
`(*RepoEntry).ensureAutoFetch()` which re-reads `e.settings()` and calls the existing
`startAutoFetch(minutes)`. Both existing guards do the rest of the work already:

- `startAutoFetch` no-ops when a timer already exists (`autofetch.go:29`), so N windows opening one
  repository arm exactly one timer.
- It no-ops when `disabled` (same line), so a repository whose auto-fetch failed once stays off for
  the entry's life — G7 D23's own rule, preserved.

That is a three-line fix with no new state and no new lifetime, and it makes the setting's off→on
direction work without a settings-change notification channel this chapter does not have.

Rejected: re-reading the interval on every `Conn.Open` *and* rescheduling a live timer to the new
interval. `autoFetchTick` already re-reads the interval each tick (`autofetch.go:81`), so the
interval converges within one tick on its own; forcing it would restart the clock every time a
window opens.

### D6 — `Setsid` extends to local **write** spawns, and to nothing else

Resolving F6, and flagged in §11.1 because it changes behaviour for already-proven code.

`Spec.Setsid = true` on:

- `gitsession/ops.go`'s `runWriteArgv` (G5's ten `op.run` kinds and every `undo.run` replay),
- `gitsession/remote.go`'s pull integrate spawn (`remote.go:522-540`).

**Not** on any read spawn. The principle, stated so a later phase can apply it without re-deriving:
*a spawn that can write can also invoke something interactive — a gpg pinentry, a merge driver, a
clean/smudge filter — and those bypass `GIT_TERMINAL_PROMPT`. A read spawn cannot.* Reads keep
`Setpgid`, so the four-slot read pool's behaviour, the grandchild-pipe test
(`runner_test.go:231`) and everything G2–G6 proved are untouched.

`killGroup(-pid, …)` is unaffected either way: `Setsid` makes the child a session leader **and** a
process-group leader with `pgid == pid`, which is what G7 D6 already established.

### D7 — A write drops the shared caches synchronously; the watcher remains the primary invalidator

Resolving F5. One unexported method on `RepoEntry`:

```go
// invalidateAfterWrite drops exactly what a completed local write can have invalidated, without
// waiting for the watcher's own debounced signal (F5). The watcher is still the ONLY thing that
// notices a write made outside this app, and is still what fans repo.changed out to subscribers;
// this is a second line of defence for our own writes, for the case where a watch was lost
// (fsnotify Add can fail with EMFILE and G2 D10 logs-and-skips; ErrEventOverflow is documented).
func (e *RepoEntry) invalidateAfterWrite()
```

It drops `refs`, `detail`, `rangeCount` and sets `headStale` — the same four `note()` drops — and
does **not** fan anything out and does **not** mark any `Walk` stale. Called at the end of `RunOp`
(after the read-back, before returning) and at the end of `RunRemote` (same place).

Three things it deliberately does not do, each for a reason worth recording:

- **It emits no `repo.changed`.** The watcher does that, and a second emitter would double every
  event a client sees. Cross-window notification stays exactly where G2 put it.
- **It does not mark walks stale.** A `Walk` is per-connection and `Conn.markWalksStale` is reached
  from the subscriber (G6 D5); reaching from an entry into every connection's walks would invert the
  dependency and duplicate the fan-out.
- **It does not make the caches correct in the presence of a lost watch** — only *less wrong*. The
  real answer to a lost watch is the macOS fd measurement (§7.2 step 4), which is why that step
  blocks G9.

### D8 — What "revoke severs cleanly" actually guarantees, written down and then tested

Resolving F8. The guarantee this phase asserts, and the only one the code can honestly make:

1. `Revoke` writes `revoked_at` **before** closing any socket (G1 D18, unchanged and still right).
2. When `Revoke` returns, the revoked client's socket is closed, so it can issue nothing further.
3. **Session teardown is asynchronous** and completes on the connection's own goroutine: walks
   disposed (their `git log` processes killed), refs released, the linger timer armed, every
   pending credential waiter unblocked with "not answered".
4. A write or remote op already in flight is **not** killed (SPEC §6, G5 D8, G7 D19) and finishes;
   its result is delivered nowhere.
5. A re-dial with the revoked token gets `tokenRejected`; a re-dial with none gets
   `pairingRequired`.

M5's tests assert (1)–(5) with a *bounded wait* for (3) rather than assuming it has happened when
`Revoke` returns. This is a documentation fix as much as a test: G1 D18's "before the call returns"
is true of one clause and has been read as covering all five.

### D9 — What gets a test, and what does not

`AGENTS.md`'s bar names "concurrency (ordering, backpressure, cancellation, races)" first, which is
this entire phase. The discipline that keeps it from becoming a test dump is a rule, applied per
test: **a test earns its place only if it can fail for a concurrency reason.** Concretely:

**Tested (new):**

- Every fix in D3–D7, by a test that fails on the pre-fix tree (each is quoted in §3 with the
  failure it reproduces).
- M1–M6's own assertions (§3.6–§3.8).
- The simultaneous remote-op claim (F9), the simultaneous `Conn.Open`/`Conn.Close`, the
  simultaneous `Subscribe`/`teardown`, and the credential waiter's four exits raced against each
  other — all at the `gitsession` tier where `-count=10` is cheap.

**Not tested, deliberately:**

- Anything already covered by the 71 `gitsock` + 54 `gitsession` tests. This phase **adds no
  duplicate**: `TestIntegration_SecondRemoteOpIsRefusedAndCancelIsHonest`,
  `TestIntegration_WalksArePrivatePerConnection`, `TestIntegration_UndoSlotIsSharedAndAttributed`,
  `TestIntegration_TwoConnectionsReviewIndependently` and `TestIntegration_RefcountAndDisconnect
  Teardown` already exist and stay; M1 asserts what they do not.
- A sequential re-assertion of any single-connection behaviour. A test that would pass on a
  one-window build is not a matrix test.
- `invalidateAfterWrite` as a unit (D7) — it is four drops on four already-tested caches; its real
  proof is M1's cross-window assertion.

### D10 — Goroutine and process containment is a scoped helper, not a new dependency

M3's "no goroutine leak" and M6's "no orphaned git children" need a containment check. Considered
and declined: `go.uber.org/goleak` (BSD-3, well maintained, and the repo already carries test-only
modules — `go-cmp`, `testcontainers-go` — so precedent is not the obstacle).

**The requirement it does not meet**, named as `AGENTS.md` requires: goleak's model is
package-scoped verification at `TestMain`, which in `gitsock` would sit on top of 71 existing tests
that spawn real `git`, real `fsnotify` watchers and real SQLite — every one of which parks
goroutines goleak would need a hand-maintained `IgnoreTopFunction` list to tolerate, and that list
is exactly the thing that rots. What this phase needs is narrower and different in kind: *"run this
one scenario N times and assert the goroutine count returns to where it started."*

So: `assertNoGoroutineGrowth(t, n, fn)` in `gitsock/matrix_support_test.go` — record
`runtime.NumGoroutine()`, run `fn` n times, poll for the count to settle back within a small margin
over a bounded window, and on failure dump `runtime.Stack(buf, true)` (which is the part of goleak's
output that actually helps). ~25 lines, no dependency, scoped to the scenario that needs it.

The process half is Linux-specific and says so: a helper that counts `git` processes whose
`/proc/<pid>/cwd` resolves inside the fixture directory, skipped with a clear message on any other
`GOOS`.

### D11 — Stale-socket recovery is proven with a real helper process, killed with `SIGKILL`

Resolving F14. `gitsock/recovery_test.go` uses the stdlib helper-process idiom already present in
this package (`remote_test.go:127`):

- `TestHelperProcess_GitsockServer` — guarded by `KIRA_GITSOCK_HELPER=1`, it builds a `Server` over
  the `KIRA_HOME` and repo dir it is handed via env, `Start()`s it, dials its own socket as a client,
  pairs, `repo.open`s the repository (so the killed instance really does have a live `RepoEntry`,
  a watcher and a paged walk), prints `READY\n` on stdout and blocks forever.
- The parent waits for `READY`, asserts `${KIRA_HOME}/git.sock` exists, then `cmd.Process.Kill()`
  (SIGKILL — no cleanup runs, exactly like a crash), waits for the process to be reaped, and
  asserts the socket **file still exists** (nothing unlinked it).
- The parent then starts a `Server` of its own against the same `KIRA_HOME` and asserts: `Start()`
  returns nil **and listens** (the dead process's `flock` was released by the kernel), the stale
  socket was replaced rather than refused, a fresh client can pair and `repo.open` the same
  repository, and it gets a **new** `RepoEntry` (counted through `Registry.NewWatcher`) with a
  correct `RepoSummary` — no leftover state, because there is none to leak: every piece of
  `Registry` state G2–G7 added is in-process only.
- Finally, F15's containment check: no `git` process remains whose cwd is inside the fixture repo.

The one piece of on-disk state a crash *can* leave is `gitaskpass`'s `kira-askpass-*` temp
directory (G7 §10 named it). M6 asserts the new instance starts correctly with one present, and
D13(f) records that it stays inert rather than adding a startup sweep for it.

### D12 — The perf re-baseline extends G3 D22's harness, stays behind `KIRA_GIT_PERF=1`, and asserts nothing

SPEC's second known open item asks for empirical confirmation "in G3 and G8". G3 measured the graph
stream alone, on an otherwise idle transport, with one connection (F12). G8 measures what G4–G7
added, and — the part only this phase can do — measures it **with two connections**.

`gitsock/perf_test.go`, one top-level `TestG8PerfBaseline` with subtests, gated exactly as G3's is
(`testing.Short()` skip + `KIRA_GIT_PERF=1` + `exec.LookPath("git")`), reusing
`buildFastImportRepo` so a 20k-commit fixture costs one `git fast-import` and not 20k spawns:

| Probe | What it records | Why it is this phase's |
|---|---|---|
| **P-a** `graph.stream`, one connection | first-chunk, total, chunks, mean/max bytes per chunk | G3's number, re-taken on today's tree as the control |
| **P-b** `graph.stream`, **two connections concurrently on one repository** | both connections' first-chunk and total; the ratio to P-a | the four-slot read pool under two windows — G4 §10 and G5 §10 both hand exactly this question here |
| **P-c** `graph.stream`, **two connections on two different repositories** | same, plus whether either degrades | M3's perf half: independence should be near-total |
| **P-d** `commit.detail` × 50 rows, one connection vs two | mean and p95 per request | G4 D8 spends **three of four** read slots on one detail; this is the number that says whether four is right |
| **P-e** `commit.fileDiff` + `file.read` on a large patch and a large blob | bytes and milliseconds, JSON | G4 D1 chose JSON over FlatBuffers on an argument with no measurement behind it (G4 §11.1); this gives the argument numbers |
| **P-f** ranged `graph.stream` over a 200-commit range | first-chunk, total | upstream's own P7 budget (≤300 ms), on this transport |
| **P-g** chunk-size distribution across a full 20k-commit walk | min / mean / max / p99 bytes per chunk | G3 §10's own hand-forward, asked for by name |
| **P-h** watcher fan-out latency at 1, 2 and 8 subscribed connections | `git commit` → `repo.changed` received, per connection | the one number that says whether D14's coalescing fan-out scales past two windows |
| **P-i** inotify watch count for a repository with 2 000 loose refs | watches held | a Linux **proxy** for G2 §10's macOS fd question — it does not answer it (inotify costs per directory, kqueue per file) but it records the shape the macOS script compares against |

Every probe `t.Logf`s and asserts nothing. **The numbers are recorded twice**: in C9's commit
message, and appended to this plan doc as §12 (C10), because G9 (Ship) is the next reader and a
commit message is a poor place to look them up.

Rejected: asserting a threshold. Upstream's ≤300 ms was measured over in-process `postMessage` on
different hardware; this container is not the shipped platform; and a hard assertion in a suite that
runs on both would be flaky in exactly the way SPEC's own note warns about ("re-measurement, not
re-derivation").

### D13 — The six caveats prior phases handed to this phase, each answered

The prompt asks whether the earlier "approved with caveats" designs survive real concurrent stress.
Examined with the matrix in front of them:

**(a) G2 D12's `defaultLingerFor` / hidden-eviction — holds, with one refinement.** Keeping the
watcher and the caches alive through the five-minute window is right and G2's reasoning stands: a
VS Code reload re-acquires within seconds, and stopping the watcher at refcount zero would leave
every cache silently stale on re-acquire. **But the `cat-file --batch` pair is pure cost during
linger** — it holds two OS processes per repository, per five minutes, for a session nobody is
using, and its contents are content-addressed so restarting it lazily loses nothing. So:
**`Registry.release`, at refcount zero, closes the entry's `cat-file` session (leaving the watcher
and every cache alive); `CatFile()` restarts it lazily on the next use, exactly as it already
does on first use.** One method, no new state, and it is the only linger change this phase makes.

**(b) G6 D6's "no `review.end`" — holds, confirmed rather than assumed.** The worst case G6
predicted was "one idle ranged `Walk` per (connection, repository), a bounded store and no process
after five minutes". Traced here: a review walk lives on `Conn.walks[repoID].review`, and
`Conn.Close`/`CloseRepo` dispose both slots (`conn.go:239-241`, `:263-265`) before releasing the
ref. Nothing in the matrix produces a second one, because `Conn.Walk` replaces the review slot
rather than adding to it (`conn.go:314-329`). F1's leak leaks the *entry*, never the walk. **G6's
call stands; `review.end` is still not added** (D1), and M1 pins the property with a test so a later
phase does not have to re-reason it.

**(c) G7 D6's `Setsid` narrowing — does not fully hold; D6 above closes the write half.** See F6.
Reads are safe by construction and stay as they are.

**(d) G7 §10's "did anyone notice auto-fetch silently disabled itself" — answered: no, and F4 is
why.** The question G7 asked assumed a timer that runs and then stops. The matrix found the timer
frequently never *starts* (F4). D5 fixes the start; the "no visible marker when it stops" half stays
open and is explicitly **not** closed here (it needs a wire field and a `packages/git-ui` change,
both forbidden). Recorded in §10 for a post-ship phase.

**(e) G7 §10's `kiraVersion.git.path` — not moved, and F11 records the constraint.** Making it a
per-window setting would thrash `Discovery`'s single-slot cache on every alternating `app.init`.
The setting stays a VS Code key that **nothing on the server reads**, which is the state that
cannot misbehave. Moving it into Kira Studio's own settings (D16's shape from G7) is a G9+ item.

**(f) G7 §10's leaked `kira-askpass-*` temp directory — accepted, and now tested.** M6 asserts a
fresh instance starts correctly with a stale one present. No startup sweep is added: the directory
is 0700, its socket is dead with its process, and the OS reaps `$TMPDIR`.

### D14 — `Registry.Close()` keeps tearing down live entries; safety comes from D4's flag

Stated as a decision because the alternative is tempting and wrong. `Server.Close()` wants every
watcher stopped and every `cat-file` pair killed *now*, not in five minutes and not "once the last
window lets go" — the process is exiting. So `Registry.Close()` keeps ignoring refcounts, and D4's
`tornDown` flag is what makes that safe for a holder that is still finishing a request.

The visible consequence, recorded rather than hidden: a request in flight during shutdown can now
fail with `ErrRepoTornDown` instead of panicking. That is the correct outcome — the server is going
away — and it is delivered nowhere anyway, because the socket is already closed.

### D15 — `gitsock`'s new test files carry their own helpers; `integration_test.go` is not edited

A discipline rule, because §8 offers an optional parallel cut and this is what makes it possible.
`integration_test.go` holds the shared harness every existing test uses (`newIntegrationServer`,
`pairAndReady`, `openRepoOK`, `initFixtureRepo`, `testClient`). Each new file adds **only its own**
helpers, in its own `*_support_test.go` where they are shared between two of the new files:

- `matrix_support_test.go` — the two-repository fixture, `assertNoGoroutineGrowth`, the
  `pairTwoClients` shorthand, the "wait for teardown" bounded poll.
- `recovery_support_test.go` — the helper-process launcher and the `/proc`-based process scan.

Nothing in this phase edits an existing `gitsock` test file except to **delete nothing** — no
existing test is modified or removed.

### D16 — The exit run is `-count=1` scoped **plus** `-count=10` filtered, and the filter is named here

Resolving F13. Two runs, not one:

```
# 1. The scoped race suite, once — SPEC's own list + gitreview + gitaskpass (~55 s here).
go test -race -count=1 \
  ./apps/kira-studio/internal/gitclient/... ./apps/kira-studio/internal/gitaskpass/... \
  ./apps/kira-studio/internal/gitpreflight/... ./apps/kira-studio/internal/gitops/... \
  ./apps/kira-studio/internal/gitsession/... ./apps/kira-studio/internal/gitreview/... \
  ./apps/kira-studio/internal/gitrpc/... ./apps/kira-studio/internal/gitsock/... \
  ./apps/kira-studio/internal/gitstore/... ./apps/kira-studio/internal/gitwire/... \
  ./apps/kira-studio/internal/bridge/... ./apps/kira-studio/internal/

# 2. This phase's own concurrency tests, ten times, under -race.
go test -race -count=10 -run 'TestConcurrent|TestMatrix|TestRevoke|TestRecovery' \
  ./apps/kira-studio/internal/gitsession/ ./apps/kira-studio/internal/gitsock/
```

**Every test this phase adds is named with one of those four prefixes**, so the filter is a
contract rather than a guess. `-count=10` over the whole scoped list is refused deliberately: F13
measured `gitsock` at 47.5 s dominated by real sleeps and real `git` spawns in 71 *existing* tests,
so ten passes would cost ~9 minutes to re-run work that is not concurrent and cannot fail for a
concurrency reason. Ten passes of the new tests alone is the run that can actually catch a flaky
race.

If run 2 is ever red **once in ten**, that is a finding, not a retry: the plan's own rule is that a
race that reproduces at 1-in-10 gets fixed, never re-run until green.

---

## 3. The Go side, file by file

All paths under `apps/kira-studio/`.

### 3.1 `internal/gitsession/conn.go` — edited (D3, D5)

| Symbol | Change |
|---|---|
| `Conn` | new `closed bool`, guarded by the existing `mu`, documented with F1's own mechanism |
| `Close()` | sets `closed = true` inside the map-swap critical section |
| `Open()` | the final critical section gains a `if c.closed` arm: unlock, `unsubscribe()`, `release()`, return the identified summary and nil |
| `Open()` | on the path that stores a new hold, calls `h.entry.ensureAutoFetch()` (D5) after unlocking |
| `Walk()` | returns `ErrRepoNotHeld` when `closed`, before the `held` lookup |

### 3.2 `internal/gitsession/entry.go` — edited (D4, D7, D13a)

| Symbol | Change |
|---|---|
| `RepoEntry` | new `tornDown bool`, guarded by the existing `mu` |
| `teardown()` | idempotent under `mu`; sets `tornDown`; replaces `subs` with an **empty** map (never nil) |
| `Subscribe()` | returns a no-op unsubscribe when `tornDown`, constructing no subscriber; the unsubscribe closure closes its subscriber only if it actually deleted it |
| `CatFile()` | returns `nil` when `tornDown` |
| `closeCatFile()` | new, unexported — closes and nils the memoised session; called by `teardown` and by `Registry.release` at refcount zero (D13a) |
| `ensureAutoFetch()` | new — re-reads `settings()` and calls `startAutoFetch` (D5) |
| `invalidateAfterWrite()` | new — D7's four drops, no fan-out, no walk marking |

`ErrRepoTornDown` is a package-level sentinel in `entry.go`, returned by `queries.go`'s three
cat-file callers when `CatFile()` is nil.

### 3.3 `internal/gitsession/registry.go` — edited (D13a, D14)

`release()`, at refcount zero and **before** arming the linger timer, calls
`sl.entry.closeCatFile()`. `Close()` is unchanged in behaviour and gains one comment naming D14 and
`tornDown` as what makes it safe.

### 3.4 `internal/gitsession/{ops,remote}.go` — edited (D6, D7)

- `runWriteArgv` (`ops.go:289`): `Spec` gains `Setsid: true`.
- `runPullOp`'s integrate spawn (`remote.go:522-540`): same.
- `RunOp` (`ops.go:323`) and `RunRemote` (`remote.go:288`): call `e.invalidateAfterWrite()` after
  the read-back, before returning — on **every** exit path that ran a spawn, including the failure
  and cancellation ones (a half-applied write invalidates just as much as a whole one).

### 3.5 `internal/gitsession/concurrency_test.go` — new (D9, M2)

Everything here is `-race -count=10` material and nothing here touches the filesystem except where
noted. Names all begin `TestConcurrent`.

| Test | Asserts | Fails on the pre-fix tree as |
|---|---|---|
| `TestConcurrent_OpenRacingCloseNeverLeaksAHold` | 200 iterations of `Open ‖ Close`; the registry's refcount is zero (or the entry gone) every time | 160/200 leaks (F1) |
| `TestConcurrent_OpenAfterCloseIsARelease` | the deterministic ordering: `Close()` then `Open()` → entry not held | refs=1 (F1) |
| `TestConcurrent_SubscribeRacingTeardown` | 200 iterations of `Subscribe ‖ Registry.Close`; no panic, no leaked subscriber goroutine | `assignment to entry in nil map` (F2a) |
| `TestConcurrent_UnsubscribeAfterTeardown` | `Registry.Close()` then `Conn.Close()`; no panic | `close of closed channel` (F2b) |
| `TestConcurrent_CatFileAfterTeardownIsRefused` | `CatFile()` is nil after teardown, and no second session is constructed | a live session is returned (F3) |
| `TestConcurrent_RemoteOpSlotAdmitsExactlyOne` | 16 goroutines calling `claim` at once; exactly one true, `release` then admits exactly one more; `tryCancel` on the loser's view is honest | (passes today — F9's pin) |
| `TestConcurrent_CredentialWaiterFourExits` | answered / dismissed / ctx-cancelled / `Conn.Close`, each raced against the others; every one returns `("", false)` except the answer, and the waiter map is empty afterwards | (passes today — a pin against D3's `closed` flag regressing it) |
| `TestConcurrent_AutoFetchArmsOnOpen` | settings report 0 at entry construction and N afterwards; a later `Conn.Open` arms exactly one timer; a second `Open` arms none; a `disabled` entry arms none | no timer ever (F4) |
| `TestConcurrent_WalkPairIsolationUnderLoad` | two goroutines, one paging the graph walk and one the review walk on the same `Conn`+repo, 100 iterations: neither resets the other's store, `nextSeq` never goes backwards on either | (passes today — G6 D3's pin under real concurrency, which its own single-threaded test cannot give) |

The first five each carry a one-line comment naming the finding and the observed pre-fix output, so
a future reader can tell a regression test from a speculative one.

### 3.6 `internal/gitsock/matrix_test.go` + `matrix_support_test.go` — new (D2, D15)

Names begin `TestMatrix`. Two paired clients throughout; the support file adds `pairTwoClients`,
`initTwoFixtureRepos`, `assertNoGoroutineGrowth` (D10), `waitForTeardown` (a bounded poll on the
watcher counter), and `countGitProcessesUnder` (Linux-only, skipped elsewhere).

**M1 — two windows, one repository**

- `TestMatrix_M1_WriteInOneWindowIsVisibleInTheOther` — A runs `op.run` `branchCreate`; B receives
  `repo.changed{refsChanged}`; B's `refs.list` **after** that event lists the new branch; and — the
  D7 half — a `refs.list` issued by **A** immediately after its own `op.run` response, *before* any
  event, also lists it.
- `TestMatrix_M1_ReviewInOneWindowWhileTheOtherChecksOut` — the prompt's own scenario 1: A opens a
  ranged review walk and pages it; B performs a checkout; A's review list is marked stale, A's next
  `graph.loadMore` re-walks against the moved HEAD, and **B's graph walk is untouched**. This is the
  first test anywhere that runs G6's ranged walk concurrently with G5's write executor.
- `TestMatrix_M1_UndoSlotAttributionBothWays` — A deletes a branch; A's `undo.peek` has **no**
  `(window: …)` suffix and B's has it; then B deletes a tag and the attribution flips. (The existing
  `TestIntegration_UndoSlotIsSharedAndAttributed` asserts one direction only.)
- `TestMatrix_M1_DetailCacheIsSharedAndDroppedForBoth` — A and B both request one commit's detail;
  a counting `Runner` shows one set of spawns; a `git tag` in a terminal makes **both** re-fetch.
- `TestMatrix_M1_StreamStalledOnCreditsBlocksOnlyItsOwnConnection` — F10's pin: A opens
  `graph.stream` and grants no credit; B's `graph.stream`, `graph.loadMore`, `commit.detail` and
  `refs.list` all answer promptly; A's own `graph.loadMore` does not (bounded, then A cancels).

**M2 — two windows, one repository, an exclusive operation**

- `TestMatrix_M2_SimultaneousRemoteRunsAdmitExactlyOne` — A and B fire `remote.run` at the same
  instant against a real local bare remote behind the sleeping-git shim
  (`remote_test.go:837`'s technique); exactly one gets a result and the other gets
  `OperationInProgress`; the slot frees; a third attempt from **either** succeeds.
- `TestMatrix_M2_CancelFromTheNonInitiatingWindow` — A starts a killable fetch, **B** sends
  `remote.cancel`; it is honoured (the slot is shared — SPEC §6), A's result is `Cancelled`, and
  `remote.progress` reached **only A** (G7 D20's deliberate choice, never yet asserted).
- `TestMatrix_M2_LocalOpAndRemoteOpAreNotMutuallyExclusive` — A fetches while B checks out; both
  complete (G7 D11's claim, never yet tested).

**M3 — two windows, two different repositories**

- `TestMatrix_M3_FullIndependence` — A holds repo 1, B holds repo 2; a write in repo 1 produces
  `repo.changed` for **A only** (B's read deadline expires with nothing); each has its own undo
  slot, its own refs cache, its own remote-op slot (both can fetch simultaneously), and B's
  `commit.detail` for a sha that exists only in repo 1 fails cleanly.
- `TestMatrix_M3_OneConnectionTwoRepositories` — the case no test covers at all: **one** client
  opens both repositories, pages a walk in each, and the two walks do not disturb each other;
  `repo.close` on one leaves the other held.
- `TestMatrix_M3_NoGoroutineOrProcessGrowth` — 20 iterations of "pair, open both repos, page both,
  close" under `assertNoGoroutineGrowth`, with the process scan on Linux. **This is the test F1
  would have caught**, and it is written so it still would.

**M4 — one window disconnects mid-operation**

Each subtest keeps a second connection live on the same repository throughout and asserts it is
undisturbed.

- `TestMatrix_M4_DisconnectDuringRepoOpen` — F1's own end-to-end reproduction, promoted to a
  permanent regression test: send `repo.open`, close the socket without reading the response, and
  assert the entry is released and expires (counted through `Registry.NewWatcher`).
- `TestMatrix_M4_DisconnectDuringAWrite` — A starts a slow `op.run` (the sleeping-git shim on the
  write argv) and disconnects; the write **completes** (SPEC §6, G5 D8 — asserted by observing its
  effect in the repository), B sees the resulting `repo.changed`, and A's refs are released
  afterwards.
- `TestMatrix_M4_DisconnectWithAStreamOpen` — A opens `graph.stream`, grants partial credit, and
  disconnects mid-stream; A's `git log` process is killed, A's refs released, B's own stream
  unaffected.
- `TestMatrix_M4_DisconnectDuringARemoteOp` — A starts a fetch and disconnects; the fetch is **not**
  killed (G7 D19), the slot is released when it finishes, and B can then run its own remote op.
- `TestMatrix_M4_DisconnectDuringACredentialPrompt` — A's fetch against the 401 listener raises a
  `credential.request`; A disconnects without answering; the op fails **promptly** with `AuthFailed`
  (bounded assertion, not a sleep), and B — live on the same repository throughout — can
  immediately run and answer its own prompted fetch. (G7's own test covers the disconnect; the *B
  still works afterwards* half is new, and it is the four-bound design's real multi-client claim.)

### 3.7 `internal/gitsock/revoke_test.go` — new (M5, D8)

Names begin `TestRevoke`. Each asserts D8's five clauses, with a bounded `waitForTeardown` rather
than assuming synchrony (F8).

- `TestRevoke_WhileIdle` — the baseline that already exists inside
  `TestIntegration_FullPairingAndRPCLifecycle`, re-asserted here against D8's wording so the file
  is self-contained (and **not** deleted from the existing test).
- `TestRevoke_WhileHoldingAGraphWalk` — revoke mid-stream: the socket closes, the walk's `git log`
  is killed, refs released, and a re-dial with the same token gets `tokenRejected`.
- `TestRevoke_WhileHoldingAReviewSession` — same, with a ranged walk open, asserting **both** slots
  of the pair are disposed.
- `TestRevoke_WhileARemoteOpIsRunning` — revoke during a killable fetch: the fetch is not killed
  (D8 clause 4), the slot frees, and a *second, non-revoked* connection can then fetch.
- `TestRevoke_WhileACredentialPromptIsPending` — revoke with a `credential.request` outstanding: the
  waiter unblocks "not answered", the op fails `AuthFailed` promptly, nothing hangs.
- `TestRevoke_DoesNotDisturbAnotherClient` — two clients, different client ids, one repository;
  revoking one leaves the other's holds, walks, undo slot and events entirely intact.

### 3.8 `internal/gitsock/recovery_test.go` + `recovery_support_test.go` — new (M6, D11)

Names begin `TestRecovery`.

- `TestHelperProcess_GitsockServer` — the helper (D11), a no-op unless `KIRA_GITSOCK_HELPER=1`,
  exactly the shape `TestAskpassHelperProcessForGitsock` already establishes in this package.
- `TestRecovery_AfterSIGKILLWithRepositoriesOpen` — D11's full sequence, including the assertion
  that the fresh instance builds a **new** `RepoEntry` and serves a correct `RepoSummary`.
- `TestRecovery_SecondInstanceDoesNotListenOrUnlink` — G1 D5's in-process property, re-asserted here
  now that a `Registry` with watchers and walks is attached (G1's version predates all of it).
- `TestRecovery_StaleAskpassDirectoryIsInert` — D13(f): a `kira-askpass-*` directory left in
  `$TMPDIR` does not prevent a fresh broker from starting or a remote op from prompting.
- `TestRecovery_NoOrphanedGitChildren` — F15's pin, Linux-only, skipped elsewhere with a clear
  message.

### 3.9 `internal/gitsock/perf_test.go` — new (D12)

`TestG8PerfBaseline` with nine subtests (P-a…P-i), same gating as G3's `TestGraphStreamPerf`, which
**stays where it is** as the unchanged control. Every subtest `t.Logf`s a single line in the same
shape G3's does (`key=value` pairs), so the two are greppable together.

### 3.10 `main.go` — unchanged

Every fix is behind a type `main.go` already constructs. If an implementer finds themselves editing
`main.go`, something has drifted out of scope.

---

## 4. The TypeScript side — untouched

**This phase changes no TypeScript, no Vue and no root config.** Stated explicitly because
"surface the leak / the disabled auto-fetch / the second-instance state in the UI" is the obvious
next thought and is not this phase's:

- `packages/git-ui` may not change (SPEC §5), and every user-visible signal this phase might want
  would need one.
- `packages/git-ipc` may not change without a `CONTRACT_VERSION` bump, which D1 refuses.
- `apps/kira-studio-vscode` has no bug this phase found.
- Kira Studio's own frontend has one candidate — telling the *Connected editors* pane that this
  instance is not the serving one (F7) — and §11.2 puts that to a human rather than landing it.

Consequence for the proof surface: `bun run lint`, `bun run typecheck`, `bun run test:unit` and
`bun run test:e2e-real` must stay green and **unchanged**. A diff in any of them means something
drifted.

---

## 5. Dependencies and tooling

**No new dependency, in either language.** `go.mod` and `bun.lock` are expected to be **unchanged**;
a diff in either is a signal something was reached for that this plan did not sanction. D10 records
the one library that was considered (`go.uber.org/goleak`) and the requirement it does not meet.

---

## 6. Implementation order

Ten commits. `go build ./apps/kira-studio/internal/...` and
`go test ./apps/kira-studio/internal/gitsession/ ./apps/kira-studio/internal/gitsock/` run after
**each** — both are fast enough for a per-commit loop. D16's two-run race pass happens once, at C9,
per `AGENTS.md`'s "implement the whole plan first, then test once".

- **C1** `fix(gitsession): release, never store, a repo.open that finishes after its connection closed`
  — §3.1's `closed` flag and `Open`'s new arm, plus `TestConcurrent_OpenRacingCloseNeverLeaksAHold`
  and `TestConcurrent_OpenAfterCloseIsARelease`. **The most important commit in the phase**;
  it lands first and alone.
- **C2** `fix(gitsession): make RepoEntry teardown safe against a concurrent subscribe and unsubscribe`
  — §3.2's `tornDown` flag, the `Subscribe`/unsubscribe/`CatFile` guards, `ErrRepoTornDown` and its
  three call sites, plus the three `TestConcurrent_*` tests that reproduce F2a, F2b and F3.
- **C3** `fix(gitsession): arm auto-fetch when a repository is opened, not only when its entry is built`
  — §3.1's `ensureAutoFetch` call and §3.2's method, plus `TestConcurrent_AutoFetchArmsOnOpen`.
- **C4** `perf(gitsession): close the cat-file session at refcount zero, keeping the watcher and caches`
  — D13(a): `closeCatFile` plus its `Registry.release` call site, and a test that the pair is gone
  during linger and restarts lazily on re-acquire.
- **C5** `fix(gitsession): drop the shared caches when our own write completes`
  — D7's `invalidateAfterWrite` and its two call sites. (Its proof is M1's cross-window test in C7,
  per D9 — no unit test of four cache drops.)
- **C6** `fix(gitclient,gitsession): run local write spawns in their own session`
  — D6, **only if §11.1's call is yes**. One field on two spawns; if the call is no, this commit
  does not exist and §10 carries the residual risk instead.
- **C7** `test(gitsock): the two-windows/two-repos matrix over the real socket`
  — §3.6 in full (M1–M4) plus `matrix_support_test.go`. The phase's largest commit and the one most
  likely to find something new; anything it finds is fixed as its own follow-up commit, in
  `gitsession`, in the style of C1–C5.
- **C8** `test(gitsock): revoke while a connection holds a walk, a review and an in-flight remote op`
  — §3.7 (M5).
- **C9** `test(gitsock): stale-socket recovery after a hard kill, and the G8 perf re-baseline`
  — §3.8 (M6) + §3.9 (P-a…P-i), plus **D16's full two-run race pass**. The recorded numbers go in
  this commit's message.
- **C10** `docs(v1.3): record G8's measured numbers and its residual risk`
  — §12 appended to this plan doc: the perf table, the macOS gaps that block G9, and the ones that
  do not.

Dependency order: C1 before everything (every later test runs against a tree that does not leak).
C2 before C7/C8 (the matrix tears connections down constantly and would otherwise hit F2). C3–C6
are independent of each other and of C7–C9. C7 before C8 (shared support file). C9 last but for the
doc.

---

## 7. Exit criteria, and exactly how each is proven

### 7.1 What is proven automatically, in this container

Scoped per SPEC's **"Full verification scope, 2026-09-07"** note — this chapter's git packages plus
the layering test, not the whole `internal/` tree, on both sides (what the implementer runs and
what the orchestrator re-verifies).

**(a) D16 run 1 — the scoped race suite, `-count=1`, once, at C9.** Every package `ok`.
Measured cost on the pre-phase tree: **54.4 s** (F13).

**(b) D16 run 2 — this phase's own concurrency tests, `-race -count=10`,
`-run 'TestConcurrent|TestMatrix|TestRevoke|TestRecovery'`.** Green ten times out of ten. A single
red pass is a finding to fix, never a retry (D16).

**(c) `go test ./apps/kira-studio/internal/gitsession/`** — §3.5's tier. Five of its tests fail on
the pre-fix tree with the exact output quoted in F1–F4; that is the implementer's own check that
they fixed the bug rather than the test.

**(d) `go test ./apps/kira-studio/internal/gitsock/`** — M1–M6 over a real socket, real `git`, a
real local bare remote and a real 401 listener. **This is the phase's real proof.**

**(e) `go test ./apps/kira-studio/internal/`** — the layering test, with **nothing added to
`packagesExemptFromBridgeCheck`**. Every new file this phase writes is a `_test.go` in a package
that is already under the line.

**(f) `KIRA_GIT_PERF=1 go test -run 'TestGraphStreamPerf|TestG8PerfBaseline' ./…/gitsock/`** —
G3's control plus §3.9's nine probes. Numbers recorded (D12), nothing asserted.

**(g) `GIT_CONFIG_GLOBAL=/dev/null KIRA_GIT_FIXTURES=write go test ./…/porcelain/...` leaves the
tree clean** — G4 D15's machine-independence check. This phase adds no golden fixture, so a diff
here means something regenerated that should not have.

**(h) `bun run lint` / `bun run typecheck` / `bun run test:unit` / `bun run build:vscode` /
`bun run test:e2e-real` — green and *unchanged*** (§4). `test:e2e-real` adds no new spec:
`git-pairing-real.spec.ts` still asserts `CONTRACT_VERSION = 16` and Linux's
`{kind:"gitUnavailable"}`, and its continued passing is the regression check that nothing in this
phase disturbed the handshake or the un-openable path.

**(i) `git diff --stat` for the whole phase shows no file under `packages/`, no file under
`apps/kira-studio-vscode/`, no `go.mod`/`bun.lock`, and no `gitrpc/contract.go`** (D1/§4/§5).

**(j) The full unscoped backstop, once.** SPEC's note says the full tree is "worth running
occasionally (e.g. once per few phases, or **before a final merge**)". G8 is the last phase before
Ship, so it owes it: `go test ./apps/kira-studio/internal/...` (no `-race`, since the adapter
suites' container work dominates) run once at C9, as a check that nothing in this chapter ever
touched `studio`/`api`. Expect minutes; expect green.

### 7.2 What genuinely cannot be proven here — and, for this phase, which gaps block G9

Four things are structurally out of reach in this container, unchanged in kind from G3–G7 but with
sharper stakes, because after this phase there is no further hardening pass.

**Blocks G9 — must be run on real macOS hardware and must pass before Ship:**

1. **The scoped race suite on macOS (§7.1(a)+(b)).** The watcher is the **only** invalidation
   source for every shared cache (F5), and every watcher test in this repo runs on **inotify**.
   macOS uses an entirely different `fsnotify` backend (kqueue) with different semantics. A
   kqueue-specific missed signal is a *correctness* bug — two windows silently disagreeing about a
   repository — not a performance one.
2. **Real discovery.** `NewPlatformLocator` returns `unsupportedLocator` on non-darwin (G2 F18), so
   nothing in this container has *ever* executed the real `app.init` → `repo.open` path a user
   takes. Every one of the eight phases has deferred this to the same manual step; G8 is the last
   chance to run it before it ships.
3. **The two-real-VS-Code-windows walkthrough** (§7.2's script below, steps 3–9). §7.1(d) proves
   the protocol under two socket clients; it proves nothing about two real extension hosts, two
   webviews, `context.secrets` under two windows, or a credential input box appearing in the right
   one.
4. **The watcher's file-descriptor cost on a large loose-ref repository** (G2 F10/§10's own
   hand-off, unanswered for six phases). kqueue costs one fd per *file* in every watched directory;
   inotify costs none, so **no test in this repo can see it**, and P-i only records the Linux shape
   for comparison. If the number approaches `kern.maxfilesperproc` (24576 by default), `fsnotify`'s
   `Add` starts failing with `EMFILE`, G2 D10 logs-and-skips that directory, and F5's "the watcher
   is the only invalidator" becomes a live correctness bug. **This is the one measurement that can
   turn an accepted design into a ship blocker, and it has never been taken.**
5. **`kill -9` and relaunch as the real packaged app.** §7.1(d)'s M6 proves the flock/socket/
   registry half with a real process kill; macOS adds the real `.app`, the real Keychain-backed
   secrets path, and a real user's `~/.kira-studio`.

**Acceptable residual risk for a v1 launch — does NOT block G9:**

- **Real network flakiness, a real slow remote, a real TLS proxy, a real 502** (G7 §7.2's own
  list). Every classification path is proven against a local bare repository and a local 401
  listener; what is unproven is latency behaviour, which is a UX question.
- **Real SSH with an encrypted key and no agent** (G7 §7.2 item 2). The `SSH_ASKPASS` protocol is
  probed; the specific end-to-end path is not.
- **VS Code's own credential input box** — `vscode.window.createInputBox` only exists in a real
  extension host.
- **Two Kira Studio instances and F7's revoke hole** — *if* §11.2's call is to accept. Narrow
  (needs two instances), no cheap complete fix, and the client is one a human already approved.
- **`kiraVersion.git.path` still has no server-side reader** (D13e). The safe state is the current
  one; making it server-owned is a G9+ item and nothing breaks meanwhile.
- **No user-visible marker when auto-fetch disables itself** (D13d). It needs a wire field and a
  `packages/git-ui` change, both forbidden here.
- **Local write spawns' controlling terminal**, if §11.1's call is *not* to take D6. The exposure is
  a dev-launched (`bun run dev`) instance only; a packaged GUI launch has no controlling terminal
  to inherit.

**The macOS script, run once on real hardware before G8 is called done — and, since G9 is next,
treated as the chapter's pre-ship acceptance run:**

1. §7.1(a) and §7.1(b) on macOS — the same two runs on the backend that actually ships.
2. `bun run setup && bun run build && bun run build:vscode`; `bun run dev`.
3. **Two VS Code windows**, on **two different repositories**, both
   `code --extensionDevelopmentPath=…`. Pair both (the second must queue behind the first's prompt
   and show the "1 of 2 waiting" count — G1 D8, never exercised with two real windows).
4. **M1 by hand**: in window A open a branch review; in window B check out a different branch.
   A's review list marks stale and re-walks when clicked; B's graph reconciles; neither window's
   scroll position moves in the other. Delete a branch in A: B's undo button shows
   `… (window: <A's label>)` and A's does not.
5. **M2 by hand**: start a fetch in A against a real remote; B's Fetch reports "another operation is
   in progress"; B's toolbar shows **no** progress bar (G7 D20's deliberate choice); the graph in
   both reconciles when it lands.
6. **M3 by hand**: with the two windows on two repositories, confirm a write in one produces no
   activity at all in the other, and that `lsof -p $(pgrep -f 'Kira Studio') | grep -c '/\.git/'`
   scales with the number of repositories open, not with the number of windows.
7. **§7.2 blocker 4, the measurement**: on a repository with a deliberately large loose-ref set
   (`for i in $(seq 1 5000); do git branch b$i; done`, then **without** `git pack-refs`), open it,
   and record `lsof -p $(pgrep -f 'Kira Studio') | grep -c '/\.git/'` against
   `find .git/refs -type f | wc -l` and `sysctl kern.maxfilesperproc`. Record all three numbers in
   this plan's §12. **A ratio that puts a plausible repository within an order of magnitude of the
   limit is a ship blocker, not a note.**
8. **M4 by hand**: start a push in A that raises a credential prompt, then **close window A** while
   the box is open. The push fails promptly, Kira Studio stays up, and **window B is entirely
   unaffected** — still connected, still able to run its own push and answer its own prompt.
9. **M5 by hand**: with A mid-review and B mid-fetch, revoke A from Kira Studio's *Connected
   editors* pane. A re-prompts for pairing within a second; **B's fetch completes normally**.
10. **M6 by hand**: `kill -9` Kira Studio with both windows connected and both repositories open.
    Confirm no `git` process survives (`pgrep -fl git`), relaunch, and confirm both windows
    reconnect silently and both repositories reopen.
11. **The perf re-baseline on real hardware**: `KIRA_GIT_PERF=1 go test -run
    'TestGraphStreamPerf|TestG8PerfBaseline' …`, and record every number in §12 beside this
    container's. This is the second half of the answer SPEC's own known open item asks for.
12. Confirm what is *expected to still be broken*, so it is not mistaken for a regression: the stash
    list is still empty and the console still carries its one unhandled `stash.list` rejection
    (G12); "Push tag" and "Delete on remote" still fail by name (G5 D5); a dirty non-fast-forward
    pull still fails at the stash step (G7 F19).

### 7.3 The checklist

- [ ] `CONTRACT_VERSION` is **still 16** in all three places; `packages/` and
      `apps/kira-studio-vscode/` are byte-for-byte unchanged; `go.mod`/`bun.lock` unchanged (D1).
- [ ] A `repo.open` that completes after its connection closed **releases** its ref; the entry
      expires; proven both at the unit tier and end to end over the real socket (F1/D3).
- [ ] `RepoEntry.teardown()` is idempotent; `Subscribe` after it neither panics nor registers;
      unsubscribe after it does not double-close; `CatFile()` after it returns nil (F2/F3/D4).
- [ ] Opening a repository arms auto-fetch when the interval is non-zero, exactly once, and never
      resurrects a `disabled` entry (F4/D5).
- [ ] The `cat-file` pair is closed at refcount zero and restarts lazily on re-acquire; the watcher
      and the caches survive the linger window (D13a).
- [ ] A completed local write drops the refs/detail/range-count caches and marks head stale without
      emitting a second `repo.changed` and without marking any walk stale (D7).
- [ ] Every **write** spawn is `Setsid`; every **read** spawn is still `Setpgid`; `killGroup` is
      unchanged (D6 — or, if §11.1 says no, this line is struck and §10 carries the risk).
- [ ] M1: a write in one window is visible in the other, through `repo.changed`, and in the writing
      window immediately.
- [ ] M2: simultaneous `remote.run`s admit exactly one; `remote.cancel` from the non-initiating
      window is honoured; `remote.progress` reaches only the initiator.
- [ ] M3: two repositories share no cache, no slot, no undo record and no event; 20 open/close
      cycles grow neither goroutines nor `git` processes.
- [ ] M4: a disconnect during a write, a stream, a remote op and a credential prompt each leaves the
      other window fully functional; the write completes; the fetch is not killed; the prompt fails
      promptly.
- [ ] M5: revoke severs D8's five clauses, against each of the four things a connection can hold.
- [ ] M6: a `SIGKILL`ed instance's socket is recovered by a fresh one, which builds a **new**
      `RepoEntry`; no orphaned `git` child survives; a stale askpass directory is inert.
- [ ] Every new test is named `TestConcurrent…`/`TestMatrix…`/`TestRevoke…`/`TestRecovery…` so
      D16's filter is exact.
- [ ] D16's run 2 is green **ten times out of ten**.
- [ ] The perf probes run, print, and assert nothing; their numbers are in C9's commit message and
      in §12.
- [ ] No existing test was modified or deleted; `integration_test.go` is untouched (D15).
- [ ] No test, fixture or script runs `git config --global` or `--system`.
- [ ] `packagesExemptFromBridgeCheck` is unchanged.
- [ ] §7.1(a)–(j) all green; §7.2's twelve macOS steps all pass, and step 7's three numbers are
      recorded in §12.

---

## 8. Sequencing — one implementer, and why this phase's parallel case is weaker than it looks

**Recommendation: one sequential Sonnet subagent for the whole phase.**

This is the first phase where the parallel option is genuinely tempting rather than obviously wrong,
so it is examined properly rather than declined by precedent.

**The case for splitting** is real: after C1–C6 land, the four new `gitsock` files (matrix, revoke,
recovery, perf) share no source file, no type and no helper, and D15 exists precisely to keep it
that way. One implementer per matrix scenario, or a 2/2 split (M1–M4 + M5 against M6 + perf), would
be genuinely independent work in `AGENTS.md`'s own terms.

**Three things make it the wrong trade anyway:**

1. **A stress phase's output is bugs, and a bug found in `gitsock` is fixed in `gitsession`.** C1–C6
   are five fixes in three files; C7's matrix exists to find a sixth. An agent that owns M1–M4 but
   not `conn.go`/`entry.go` either hands its finding to another agent mid-flight or edits a file
   another agent is also editing — which is the failure mode the split was supposed to avoid. This
   is not a hypothetical: writing this plan produced five findings from four probes, and every one
   of them lands in `gitsession`.
2. **The independence holds only while nothing is found**, which is the opposite of what this phase
   is for. A split whose validity is conditional on the tests all passing is a split that stops
   being valid at exactly the moment it matters.
3. **It is the last phase before Ship.** A duplicated helper, a merge conflict in the final
   hardening tier, or two agents' differing ideas of what "wait for teardown" means is a bad way to
   spend the risk budget immediately before packaging.

**If the orchestrator does choose to parallelise anyway**, the only defensible cut is **C9's perf
half alone** (§3.9's `perf_test.go`): it asserts nothing, it can find no bug that loops back into a
fix, it touches no file any other commit creates, and its whole proof is that it runs and prints.
Everything from C1 to C8 stays sequential in one head.

---

## 9. Explicit non-goals for G8

| Not in G8 | Owner |
|---|---|
| `stash.list`, `stash.show`, the stash pre-flights and their `op.run` kinds | G12 |
| `op.run`'s `tagPush`/`tagDeleteRemote`, and whether they move under `remote.run` | G12/G13 |
| `preflight.reset`, `preflight.cherryPick` and their operations | G13 |
| `search.run` and the RE2-vs-`RegExp` reconciliation | G14 |
| `.vsix` packaging, DMG bundling, the *Install VS Code Integration* button, the SCM title-bar/status-bar entry points, the command-palette audit | **G9** |
| `review.db`, blob snapshots, partial-review ranges, the TTL reaper, inline AI comments | G10/G11 |
| PR badges, `branch.resolvePr`, `ghclient` | G15 |
| `git worktree` create/list/switch/remove; stacked branches | G16/G17 |
| `review.end` or any wire-level review teardown | nobody — D13(b) confirms G6 D6 rather than re-opening it |
| A user-visible marker for a self-disabled auto-fetch | post-ship — needs a wire field and a `packages/git-ui` change |
| Making `kiraVersion.git.path` server-owned | G9+ — D13(e) |
| A single-instance guard, or cross-instance revocation | unassigned — §11.2 |
| Any new RPC method, event, stream, param or wire type; any `CONTRACT_VERSION` bump | never in this phase — D1 |
| Any change to `packages/git-ui`, `packages/git-core`, `packages/git-ipc` or `apps/kira-studio-vscode` | never, per SPEC §5 / D1 |
| A hard perf assertion of any kind | never — D12 |

---

## 10. Handed forward

- **Auto-fetch still has no user-visible signal when it disables itself** (G7 §10, D13d). D5 fixes
  the half that was actually broken (it never started); the "it stopped and nobody knows" half needs
  a wire field on an existing result or event plus a `packages/git-ui` change, both forbidden here.
  A **post-ship** phase owns it; the natural carrier is a boolean on `remote.run`'s result.
- **`kiraVersion.git.path` still has no server-side reader** (G7 §10, D13e/F11). The constraint this
  phase adds: `gitclient.Discovery` is a **single-slot** cache keyed by `configuredPath`, so the
  setting must become server-owned (G7 D16's shape) rather than per-window, or the cache thrashes on
  every alternating `app.init`. **G9+**.
- **Cross-instance revocation is impossible with this design** (F7). A second, non-listening Kira
  Studio can write `revoked_at` and sever nothing. If §11.2's call is to accept, the honest minimum
  is that the *Connected editors* pane says which instance is serving — a Kira-Studio-frontend
  change this phase may not make (it would be its only UI change). **Unassigned.**
- **`Registry.Close()` still ignores refcounts** (D14). Safe now, because of `tornDown`, and
  deliberately so: shutdown must not wait for a window to let go. Any future phase that gives
  `RepoEntry` a resource whose teardown is *not* idempotent inherits this constraint.
- **`Walk.Stream` still holds the walk's mutex across `emit`** (F10, G3 §10's own item). Confirmed
  here to be a per-connection stall only, and pinned by M1's test. The one unreachable-today hang
  (`repo.close` behind a credit-starved stream) becomes reachable the moment anything in
  `packages/git-ui` calls `RepoState.close()` — which has no caller today (G6 F9). Whichever phase
  gives it one owns cancelling the stream first.
- **The four-slot read pool is still four** (G4 §10, G5 §10, both handed here). P-b and P-d give it
  numbers for the first time; the *decision* to change it — if the numbers say so — is deliberately
  left to whoever reads §12, because changing a concurrency limit on the strength of one container's
  measurement is exactly what SPEC's own note warns against.
- **The macOS loose-ref fd measurement has now been unanswered for six phases** (G2 §10). §7.2 makes
  it a G9 blocker rather than a note, because F5 established that the watcher is the *only*
  invalidation source and G8's own D7 mitigation is partial by design.

---

## 11. Two calls worth a human eye before implementation starts

Both are judgment calls the orchestrator or the user may reasonably decide differently. The plan
takes a position on each and can be implemented as written either way. Neither blocks the rest of
the phase.

### 11.1 Does `Setsid` extend to local write spawns? (F6/D6)

**As planned**: yes, to write spawns only — `op.run`'s ten kinds, `undo.run`'s replays, and pull's
integrate phase. Reads keep `Setpgid` exactly as G2–G6 proved them.

**The case for**: F6's concrete exposure is real and this container's own global git config
(`commit.gpgsign=true`, `gpg.format=ssh` — the config G4 F13 already had to work around) is a
worked example of a machine where a local write can invoke an interactive helper.
`GIT_TERMINAL_PROMPT=0` does not govern gpg or a smudge filter, and a hang there holds `Repo.Write`,
which blocks **every read in every window** (G7 F8) — the single worst blocking outcome in the whole
concurrency model.

**The case against**: G7 §11.3 already put "every spawn" to a human and the answer was "remote ops
only". Re-raising it looks like re-litigation, and it changes behaviour for code five phases have
proved. The counter is that this plan is *not* re-raising "every spawn" — it is raising the strictly
narrower "writes too", with a concrete failure that did not exist in G7's own framing, in the one
phase whose job is to find exactly this.

**If the answer is no**, C6 does not exist, the checklist line is struck, and §7.2's residual-risk
list keeps "local write spawns' controlling terminal" — honest, and dev-launch-only.

### 11.2 Is F7's cross-instance revocation hole acceptable for v1? — **security-relevant**

**The fact**: a second, non-listening Kira Studio instance renders a fully functional *Connected
editors* pane whose **Revoke** writes `revoked_at` and closes **nothing**. The revoked VS Code
window keeps a live, authenticated session — able to read every repository and run every write —
until it happens to re-handshake. A user who revokes and sees the row disappear has been told the
access is gone when it is not.

**As planned**: accept for v1, and do not build cross-instance revocation. Reasons: it needs two
Kira Studio instances (macOS LaunchServices makes an accidental second launch unusual — `open -n`
or a dev build beside a packaged one are the realistic routes); SPEC §3.2 designed the
second-instance state deliberately and gave it no channel to the first; and the client in question
is one a human already approved through Kira Studio's own pairing prompt (G1).

**The minimal honest fix, if the answer is "not acceptable"**: `gitsock.Server` already knows
whether it is `listening` (`server.go:118`). Surfacing that one boolean through
`bridge.GitClientsService` and having the *Connected editors* pane say "another Kira Studio instance
is serving these editors; revoke there" — or simply disable **Revoke** — is a small change. It is
**not in this plan** because it would be this phase's only Kira Studio frontend change and would
need a bound-method addition and a bindings regeneration; if the call is to fix it, it should be
scoped explicitly as an addition to C10 rather than assumed.

**A third option, rejected**: a single-instance guard (refuse to boot a second instance). It would
close this and several other cross-instance questions at once, but it changes a documented,
deliberate SPEC §3.2 behaviour on the strength of one finding, and it is a product decision well
outside a hardening phase.

---

## 12. Measured results

*(Appended by C10, after §7.1(f) and §7.2 step 11 have both been run. Until then this section holds
the pre-phase baseline only, so the delta is legible.)*

**Pre-phase baseline, this container (Linux, Go 1.27.0, git 2.43.0), `80b5f3f2`:**

| Measurement | Value |
|---|---|
| `TestGraphStreamPerf`, n=20 000 commits, first `graph.stream` page | `chunks=10 firstChunk=248.070416ms total=249.916742ms meanBytesPerChunk=42167 totalBytes=421676` |
| Page size / chunk size | `logsession.DefaultPageSize = 5000` rows; `walk.go` `chunkRows = 500` → 10 chunks per page |
| Shape of first paint | `firstChunk ≈ total` — the whole page is read and parsed before the first chunk is emitted; transport and FlatBuffers are not the bottleneck (F12) |
| Scoped race suite, `-count=1` | `real 0m54.413s`, of which `gitsock` is 47.518 s |
| Stale window on the shared refs cache after a local write, pre-D7 | ~210 ms (the watcher's 200 ms leading-window debounce plus inotify latency) |

**Post-phase numbers (this container):** *to be filled by C10.*

**Post-phase numbers (macOS, §7.2 step 11):** *to be filled after the manual run.*

**§7.2 step 7 — macOS watcher fd cost:** *to be filled; a ratio within an order of magnitude of
`kern.maxfilesperproc` blocks G9.*
