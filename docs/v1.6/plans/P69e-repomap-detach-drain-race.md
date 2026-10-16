# P69e — `TestDetachDrainsInFlightCall`'s `-race` failure

Plan for SPEC row P69e. Closes the Open entry logged during P69c's implementation in
`docs/v1.6/mcp-repo-map-issues.md` ("P69c (implementation) — `internal/repomap`'s
`TestDetachDrainsInFlightCall` fails under `-race` …"). Small phase: one synchronization fix, one
added assertion, one doc update. Every claim below was re-checked against the live source and a
throwaway worktree at `12d0d515`, not carried over from the log's prose.

## 1. Problem

`go test -race -run TestDetachDrainsInFlightCall -count=20 ./internal/repomap/` fails on current
`v1.6` HEAD (`12d0d515`), 3 invocations out of 3. At `-count=5` it fails on 2 of 3 invocations; a
single `-count=1` run usually passes. The race is probabilistic, so a verification step that runs
the test once proves nothing — §6 requires repeats.

```
WARNING: DATA RACE
Write at 0x000002036550 by goroutine 25:
  repomap.TestDetachDrainsInFlightCall.func1()
      attach_test.go:155 +0x30
  runtime.deferreturn()
Previous read at 0x000002036550 by goroutine 40:
  repomap.(*repoInstance).close.1()
      instance.go:212 +0x85
  sync.(*Once).doSlow()
Goroutine 40 (finished) created at:
  repomap.(*Server).Detach()
      attach.go:173 +0x40d
  repomap.TestDetachDrainsInFlightCall.func3()
      attach_test.go:216 +0x49c
```

The address is the package-level `readyTimeout` (`server.go:44`, a `var` so tests can lower it).

## 2. Confirmed current state

- `Server.Detach` (`attach.go:155-177`) removes the key under `reposMu`, closes `inst.done`, then
  spawns `go func() { inst.inflight.Wait(); inst.close() }()`. Nothing anywhere holds a handle on
  that goroutine — not the `Server`, not the caller.
- `repoInstance.close` (`instance.go:202-227`) reads `readyTimeout` at `:212`, inside
  `closeOnce.Do`. The read is `case <-time.After(readyTimeout):` in a `select`; Go evaluates every
  channel operand when the `select` is set up, so the read happens even in the test's case, where
  `syncDone` is pre-closed and the other case wins immediately.
- `TestDetachDrainsInFlightCall` (`attach_test.go:152-227`) writes `readyTimeout = time.Minute` at
  `:154` and restores it in a `defer` at `:155`, which runs when the **outer** test function
  returns — after both subtests, and with no wait on either drain goroutine.
- **The log says "the test's third subtest"; the live source has two** (`:157` and `:194`). The
  doc comment lists three guarantees, and the first subtest carries two of them. Both subtests call
  `Detach` (`:172` inside a goroutine, `:216` directly), so **both** leak a drain goroutine — the
  trace above names only the second because whichever goroutine happens to still be inside
  `close()` when the outer `defer` fires is the one reported. Fixing only the reported subtest
  would leave the race live.
- No other test in the package leaks a goroutine that reads `readyTimeout`. `index_test.go`'s three
  swaps (`:52`, `:69`, `:96`) each join their own goroutine through a channel receive before
  returning, and `Server.Close` runs `close()` synchronously.
- `Detach` has two production callers, `bridge/repomap.go:422` (`onRepoRemoved`) and `:527`
  (a revoked grant); `Server.Close` has one, `bridge/repomap.go:373` (`stopLocked`). All three hold
  `RepoMapService.mu`.

### 2.1 The race is test-only — verified, not assumed

The SPEC row asks planning to confirm this rather than assume it.

- `readyTimeout` is written in exactly four places, all tests (`attach_test.go:154`,
  `index_test.go:53/70/97`). In a production binary it is written once at init and only ever read,
  so the racing pair cannot form there.
- The drain goroutine's own work is not racy against anything else the process does: `close()`
  touches `cancel`, `syncDone`, `watcher`, `lock` (under `lockMu`) and `idx.Close()`. `idx.Close()`
  is `codeparse.Session.Close`, which takes `cacheMu` then `parserMu` and resets both maps, so a
  second concurrent or later call is safe. `close()` never touches the shared `Store`.
- `codeindex.Store.Close` (`db.go:130`) is mutex-guarded and idempotent.

**One real, narrow product gap did surface** (§3.1 fixes it as part of the same change):
`Server.Close` closes every *attached* instance and then the shared store, but never joins a drain
goroutine an earlier `Detach` left running. So a quit immediately after a revoke can return with
that instance's watcher stop and sync-lock release still pending, and can close the store while a
drain is outstanding. Harmless today only because `close()` happens not to query the store — an
invariant nothing states or enforces.

## 3. Fix

### 3.1 `Server` tracks its own drain goroutines (`attach.go`, `server.go`)

```go
// server.go, in Server, after initialSyncSem:
// detachWG counts Detach's own asynchronous drain goroutines (attach.go) — Close joins them.
detachWG sync.WaitGroup
```

```go
// attach.go, Detach:
close(inst.done)
s.detachWG.Add(1)
go func() {
    defer s.detachWG.Done()
    inst.inflight.Wait()
    inst.close()
}()
```

`Server.Close` joins them, after its own per-instance loop and **before** `s.store.Close()`:

```go
s.detachWG.Wait()

_ = s.store.Close()
```

Two lines of product code plus one field. This is what makes `detachWG` product state rather than a
test-only hook: it closes §2.1's gap, and `Close`'s own doc sentence ("drains and closes every
attached instance") becomes true of a just-detached one too. `sync` is already imported in
`server.go`.

No deadlock: the drain waits only on `inst.inflight`, and `Detach` has already closed `inst.done`,
so a handler blocked in `waitReady` returns "repository access was revoked" immediately instead of
waiting out `readyTimeout`. `internal/repomap` imports nothing from `internal/bridge`
(`internal/layering_test.go` enforces it), so a handler can never reach back for
`RepoMapService.mu`, which `stopLocked` holds across `Close`. The new wait is the same unbounded
posture `Close`'s existing `inst.inflight.Wait()` already has.

### 3.2 The test joins the drain before its `defer` restores `readyTimeout` (`attach_test.go`)

Two helpers, beside `newDrainTestInstance`:

```go
// detachDrained reports Server.Detach's own asynchronous drain goroutine (attach.go) finishing: the
// returned channel closes once every drain outstanding at call time has run close(). Call it after
// Detach, and only where no further Detach can start (sync.WaitGroup forbids an Add from zero
// concurrent with a Wait).
func detachDrained(s *Server) <-chan struct{} {
	drained := make(chan struct{})
	go func() { s.detachWG.Wait(); close(drained) }()
	return drained
}

// mustDrain waits that channel out, bounded — a stuck drain fails the test instead of hanging it.
func mustDrain(t *testing.T, drained <-chan struct{}) {
	t.Helper()
	select {
	case <-drained:
	case <-time.After(5 * time.Second):
		t.Fatal("Detach's drain goroutine did not finish within 5s")
	}
}
```

Both subtests take `drained := detachDrained(s)` right after their `Detach`, and end with
`mustDrain(t, drained)`:

- Subtest 1: `mustDrain` goes **after** `inst.inflight.Done()` at `:191` — that `Done` is what
  releases the drain.
- Subtest 2: after the `select` on `waitDone`. The drain there is released by the waiting
  goroutine's `defer got.inflight.Done()`, which runs *after* its send on `waitDone`, so the outer
  test can otherwise return first. This subtest is the one the trace named.

The bound is 5s, not `t.Deadline`: a stuck drain then fails with a sentence naming it, instead of
hanging until the package's 10m timeout with no explanation.

Placement is per-subtest, not `t.Cleanup`: `newDrainTestInstance` registers `idx.Close`/`store.Close`
cleanups, and an explicit call keeps "wait for the drain, then let the helper's cleanups close the
index" visible in reading order rather than resting on LIFO cleanup ordering.

### 3.3 Pin the drain guarantee the test is named for

Verified in a throwaway worktree: with §3.2's waits alone, replacing `Detach`'s whole drain
goroutine with a synchronous `inst.close()` — i.e. deleting the guarantee the test exists to prove —
**still passes** (`-count=3`, clean). Subtest 1's own evidence is `graph.SearchSymbols` succeeding
after `Detach`, and that query reads the `Store`, which `close()` never touches, so nothing observable
breaks.

The handle §3.1 adds closes that hole in 7 lines. In subtest 1, between `Detach` and
`inflight.Done()`:

```go
drained := detachDrained(s)

// The drain half is asynchronous and must still be waiting: inflight is held below.
select {
case <-drained:
    t.Fatal("Detach closed the instance while a call was still in flight")
case <-time.After(50 * time.Millisecond):
}
```

Verified both ways: passes 20/20 against the real `Detach`, and fails on the first run against the
synchronous-close mutation (`Detach closed the instance while a call was still in flight`).

This **adds** an assertion; it removes and weakens none. §6.5 is the check that nothing else about
the test's meaning moved.

### 3.4 Rejected alternatives

- **Drop the `readyTimeout` override from the test entirely** (`:153-155`). Removes the write, so
  the race goes with it, and the default 25s still dwarfs the subtest's own 2s assertion window
  today. Rejected: the assertion's strength would then depend on a product constant nobody would
  think to check when tuning it, and the drain goroutine would still outlive the subtest, still
  touching an index the subtest's cleanup is closing.
- **Make `readyTimeout` an `atomic.Int64`.** Fixes the race class at six read sites and one type
  change, for a variable production never writes. More product churn than the race justifies, and
  it would leave the unjoinable goroutine — the actual defect — in place.
- **Give `repoInstance` a `closed chan struct{}` closed at the end of `close()`.** Equivalent
  waiting power, but every `repoInstance` literal must then initialise it or `close()` closes a nil
  channel and panics; `attach_test.go` and `newPickTestServer` both build literals directly. The
  `Server`-level `WaitGroup` needs no initialisation and is the level the goroutine is actually
  spawned at.
- **`inst.closeOnce.Do(func() {})` as a join point.** `sync.Once.Do` does block until a concurrent
  first `Do` returns, but if the drain has not entered `close()` yet the test wins the `Once` and
  the real `close()` silently never runs — it would change what the test exercises.
- **Making subtest 1 a genuine use-after-close detector** (an in-flight call that touches the parser
  session or watcher, so a premature `close()` trips `-race`). Real, and out of scope: §3.3's
  ordering assertion pins the guarantee at this phase's size.

## 4. Test

No new test. The phase's whole subject is `TestDetachDrainsInFlightCall` itself, which already sits
on `CLAUDE.md`'s bar as concurrency coverage (ordering, cancellation) — §3.2 makes it race-clean and
§3.3 makes its named guarantee fail-detectable.

No test is added for `Close`'s new `detachWG.Wait()`: it is one line whose behaviour is exercised by
every existing `Close` path, and a dedicated test would restate a `WaitGroup`.

## 5. Commits

1. `fix(repomap): track Detach's drain goroutines so Close and the test can join them` —
   `attach.go`, `server.go`, `attach_test.go` (§3.1, §3.2, §3.3 together: the test changes do not
   compile without the field, and splitting them would land a knowingly-red `-race` commit).
2. `docs(P69e): close the detach-drain race finding in the dogfooding log` — needs commit 1's SHA,
   so it lands second.

Plus this plan's own commit, `docs(P69e): plan repomap detach-drain race fix`.

## 6. Verification

All in `apps/kira-studio`, on the real worktree (a fresh `git worktree` has no
`frontend/dist`, so `go build ./...` fails there on the `embed` pattern — an environment artifact,
not a code result).

1. **Baseline first, before touching anything**: `go test -race -run TestDetachDrainsInFlightCall
   -count=20 ./internal/repomap/`, 3 invocations. Expect a `DATA RACE` in every one — that is the
   3/3 measured at `12d0d515`. If it passes 3/3, stop and report: the repro has changed, and the
   rest of this plan is written against a race that is no longer firing.
2. `go test -race -run TestDetachDrainsInFlightCall -count=20 ./internal/repomap/`, 3 invocations
   after the fix. All three must be clean. Then `-count=100` once (measured on the prototype: clean,
   12.8s).
3. `go test -race ./internal/repomap/...` clean, and `-count=5` clean (the
   pre-fix tree fails this too, 1 invocation of 2 measured).
4. `go build ./...` and `go vet ./...` clean.
5. **Semantics check.** Read the final `attach_test.go` diff and require: no existing assertion,
   error string or `t.Fatal` message changed or deleted; `readyTimeout = time.Minute` and its
   `defer` restore unchanged; both subtests still assert what §2 records them asserting. The diff
   adds two helpers, two `detachDrained` calls, two `mustDrain` calls and §3.3's select — nothing
   else.
6. **Mutation check** for §3.3, in a scratch copy or reverted immediately, never committed: replace
   `Detach`'s drain goroutine with a synchronous `inst.close()` and confirm
   `go test -race -run TestDetachDrainsInFlightCall -count=1 ./internal/repomap/` now **fails** with
   "Detach closed the instance while a call was still in flight". Restore before committing, and
   confirm the restore with `git diff` before the commit lands.

Prototype numbers behind these steps, measured at `12d0d515` in a throwaway worktree with exactly
§3's diff (+2 lines `attach.go`, +5 `server.go`, +31 `attach_test.go`): `-count=20` clean 3/3,
`-count=50` clean, `-count=100` clean, package `-count=5` clean, `go vet ./internal/...` clean.

## 7. Doc update

In `docs/v1.6/mcp-repo-map-issues.md`, the "P69c (implementation) — `internal/repomap`'s
`TestDetachDrainsInFlightCall` fails under `-race` …" entry: change the heading's trailing `Open.`
to ``Fixed (`<sha>`).`` and append a ``**Fix (P69e, `<sha>`)**:`` paragraph, the format every closed
entry there uses. Content: `Server` now counts its own drain goroutines, `Close` joins them, and the
test waits one out before its `defer` restores `readyTimeout`. Record the two corrections this phase
found against the entry's own prose — the test has two subtests, not three, and **both** leaked a
drain goroutine — plus §3.3's mutation result and the post-fix numbers from §6.

No `docs/ARCHITECTURE.md` change: it documents neither `Detach`'s drain nor `Close`'s ordering, and
this phase adds no user-visible behaviour. No "Known open items" entry: the item being closed was
never listed there.

## 8. Out of scope

- Converting `readyTimeout` to an atomic, or to a per-instance field (§3.4).
- Auditing other packages for the same "test mutates a package var a background goroutine reads"
  shape. `internal/repomap`'s own three other swaps are verified safe (§2); anything wider is a
  separate sweep.
- Strengthening subtest 1 into a genuine use-after-close detector (§3.4).
- Bounding `Close`'s wait on in-flight calls. The new `detachWG.Wait()` inherits the unbounded
  posture `Close`'s existing `inst.inflight.Wait()` already has; changing that is a `Close`
  lifecycle decision, not this race.
