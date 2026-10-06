# P168 Part 16 findings: Space git session

Plan: `P168-part16-space-git-session.md`. Reviewer reports only; fixer follows §10.
Base commit `088fd66`; HEAD reviewed `78539f6` (plan commit only on top). `PI` = `apps/kira-space/internal`,
`GS` = `PI/gitsession`.

Checks at HEAD: `go vet ./apps/kira-space/internal/gitsession/...` clean;
`go test -race -count=1 ./apps/kira-space/internal/gitsession/...` `ok` (27.3 s).

## Block status

- Block 1 lifecycle: done
- Block 2 walk and reads: pending
- Block 3 ops and undo: pending
- Block 4 stack and worktree: pending
- Block 5 remote and auto-fetch: pending
- Block 6 review: pending
- Block 7 GitHub and ADE facts: pending
- Block 8 tests and §7: pending

## Findings

### F1 (low): `release` closes cat-file session a re-acquirer may already hold

`GS/registry.go:211-222`, `GS/entry.go:380-413`. Owner: Stream B (`GS`).

`release` arms linger and unlocks `reg.mu`, then calls `entry.closeCatFile()`. `CatFile()` hands its
caller the `*catfile.Session` pointer and drops `catfileMu` before the caller issues `Check`/`Read`.
Sequence: conn A `CloseRepo` drops refs to 0, unlocks `reg.mu`; ADE `openRepo` (blocked on `reg.mu`
with `Identify` done) re-acquires, then immediately calls a queuefacts method, `CatFile()` returns the
old session S; A's `closeCatFile` closes S (`cancelSpawn` plus `proc` nil). B's request then hits
`ensureStarted` with a cancelled `spawnCtx` and fails (`context canceled`, `E_INTERNAL` on the wire).
Window is microseconds; outcome is one failed request, retry succeeds (next `CatFile()` builds fresh).

Fix: detach the session under `reg.mu` and close it outside both locks. In `release`, while still
holding `reg.mu`, take `catfileMu`, move `e.catfile` to a local and nil the field (no blocking: no
`Close` yet), unlock both, then `Close()` the local. A re-acquirer can only reach `CatFile()` after
`reg.mu` unlocks, so it always builds a fresh session. Lock order `reg.mu` then `catfileMu` is safe:
`CatFile()` never takes `reg.mu`.

### F2 (low): `eagerResolveClosedBranches` outlives teardown and has no cancel

`GS/entry.go:259`, `GS/gh.go:517-542`. Owner: Stream B (`GS`).

`note` starts `go e.eagerResolveClosedBranches()` with `context.Background()`. It runs up to 8
`ResolveBranchPr` calls (each up to one `ensureSnapshot` plus one `PullsForBranch` `gh` spawn and
REST call) with no tie to entry life. Scenario: refsChanged then linger expiry (or `Registry.Close` at
quit): `teardown` returns while the pass keeps spawning `git remote get-url` and `gh api` for a dead
entry, then calls `e.review.Branches`/`Purge` on a store `Registry.Close` already closed
(`ErrStoreClosed`, logged as a warning). Nothing joins it, so `-race` tests and quit can still have it
running. Cost note: `branchCache` is dropped on every refsChanged, so a branch with a stored review
session but no PR yet (local review before opening a PR) is re-queried with `PullsForBranch` on every
refsChanged at least 1 s apart (`eagerPurgeMinGap`): a commit made in a terminal costs up to 8 `gh`
spawns.

Fix: give `RepoEntry` a context created in `newRepoEntry` and cancelled first thing in `teardown`;
the eager pass uses it and returns on `ctx.Err()` between branches. Skip the pass when `tornDown`.
The per-signal cost is D8 behaviour; leave as is unless the fixer adds a negative cache that survives
`gh.drop` (would be a behaviour change, not required here).

## §9 candidates

1. Dropped. `Registry.acquire` after `Close` does build an untracked entry, but only reachable at
   quit: `gitsock.Server.Close` refuses new conns and joins handlers first (`server.go:300-351`),
   ADE closes its Conn before (`main.go:216`), the only late caller is a bridge native stream, and the
   process exits right after `teardown`. No user-visible effect; no reuse of a closed
   `Registry` exists (only `main.go:226` and `gitsock/server.go:350` call `Close`).
2. Reported as F1.
3. Reported as F2.
4. Dropped. `acquire` returns an entry still in `reg.entries` with refs ≥ 1; `expire` refuses
   refs ≠ 0, so only `Registry.Close` can tear it down between acquire and `Subscribe`. Quit-only, same
   reasoning as candidate 1.
12. Dropped. Every write to `autoFetch.timer` outside a tick (`startAutoFetch`) refuses while a timer
   is set, and a running tick's fired timer stays in the field until the tick itself reschedules,
   pauses or disables. No path arms a second timer. A setting flip 0 to positive racing a tick's
   `pauseAutoFetch` can lose one arming until the next `Conn.Open`; negligible.
