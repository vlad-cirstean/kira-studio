# P168 Part 16 findings: Space git session

Plan: `P168-part16-space-git-session.md`. Reviewer reports only; fixer follows §10.
Base commit `088fd66`; HEAD reviewed `78539f6` (plan commit only on top). `PI` = `apps/kira-space/internal`,
`GS` = `PI/gitsession`.

Checks at HEAD: `go vet ./apps/kira-space/internal/gitsession/...` clean;
`go test -race -count=1 ./apps/kira-space/internal/gitsession/...` `ok` (27.3 s).

## Block status

- Block 1 lifecycle: done
- Block 2 walk and reads: done
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

### F3 (low): `refsSnapshot` and `Head` write the live head with no `cacheGen` check

`GS/refs.go:100-109`, `GS/entry.go:317-336`. Owner: Stream B (`GS`).

F10 (P108) guards `statusAndInProgress`'s `setHead` (`status.go:131`) but two other writers skip it.
`refsSnapshot` calls `e.setHead` unconditionally when `%(HEAD)` names a branch, and `Head`'s lazy path
calls `setHead` after `ResolveHead` without re-checking. Scenario: `refs.list` spawns `for-each-ref`
(HEAD on `main`); a terminal `git switch feature` lands; `note` bumps `cacheGen` and sets
`headStale`; `refsSnapshot` returns and `setHead(main)` clears `headStale`. `Refs` correctly skips its
own cache write, but the head stays `main` with no stale mark. A second window's `repo.open`
(`gitrpc/handlers.go:377`) then reports `main` until some later status read or ref change corrects it.
Self-heals on the client's own `refs.list` refetch only when that refetch reaches `refsSnapshot`.

Fix: capture `gen := e.cacheGeneration()` before the spawns in `refsSnapshot` and before `ResolveHead`
in `Head`; call `setHead` only when the generation still matches (`Head` still returns the value it
resolved). Same shape as `status.go:106-133`.

### F4 (low): `diffCache` keyed by client-supplied `sha`, which may be a ref name

`GS/queries.go:273-335` (`FileDiff`); caller `PI/gitrpc/detail.go:104-109`. Owner: Stream B (`GS`).

`diffCache` is never invalidated on the premise that the key is content-addressed (`cache.go:165-168`).
`FileDiff` keys it by `(parentSha, sha, path)` where `sha` is the request's raw string; `gitrpc`
validates it only with `validRefArg` (non-empty, no leading `-`, `gitrpc/review.go:19-27`), so `HEAD`,
a branch name or an abbreviated sha pass. `baseKey` is the resolved parent from `CommitDetail`.
Scenario: `commit.fileDiff {sha:"HEAD", path:"a.txt"}` caches the patch; the user edits `a.txt` and
runs `git commit --amend` (same parent). The next identical request finds `CommitDetail` refreshed
(dropped on refsChanged) but hits the stale `diffCache` entry, returning the pre-amend patch paired
with the post-amend `change` row, until LRU eviction.

Fix: key `diffCache` (get and set) and build `FileDiffArgs` with `detail.SHA` (full sha resolved by
the `show`), not the request `sha`. `FileDiffResult.SHA` may keep echoing the request value.

### F5 (low): disposed-walk, torn-down and closed-store errors cross as `E_INTERNAL`

`PI/gitrpc/graph.go:127,139,175`, `PI/gitrpc/search.go:78`, `PI/gitrpc/handlers.go:405-411`.
`needs-other-part-file: apps/kira-space/internal/gitrpc/{graph,search,handlers}.go (Part 17)`
(Stream B, editable by this fixer).

`Walk.Status`/`ReadPage`/`Search` return `ErrRepoNotHeld` once the walk is disposed, but these handlers
map with `mapGitError`, which only knows `gitclient` kinds, so the error crosses as `E_INTERNAL`.
`c.Walk` returning a walk that a concurrent request disposes is ordinary: two `graph.loadMore` calls
with different `scope`, or `repo.close` racing `graph.status` (`Conn.Walk` disposes the old walk
outside `c.mu`, `conn.go:421-428`). Same for `ErrRepoTornDown` (any entry method racing teardown),
`gitreview.ErrStoreClosed` and `catfile.ErrInvalidRev`. The client cannot tell "repository closed
under you" from a server fault. Candidate 9 confirmed.

Fix: in `gitrpc`, wrap these results with `mapConnError` before `mapGitError` (or add the sentinels to
one shared mapper) so `ErrRepoNotHeld` and `ErrRepoTornDown` cross as `E_BAD_REQUEST` (or a dedicated
code), `ErrStoreClosed` as a retryable code. Keep `catfile.ErrInvalidRev` as `E_BAD_REQUEST`.

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
9. Reported as F5.
12. Dropped. Every write to `autoFetch.timer` outside a tick (`startAutoFetch`) refuses while a timer
   is set, and a running tick's fired timer stays in the field until the tick itself reschedules,
   pauses or disables. No path arms a second timer. A setting flip 0 to positive racing a tick's
   `pauseAutoFetch` can lose one arming until the next `Conn.Open`; negligible.
15. Dropped. `rpcstream.Session.close` (deferred inside `Serve`) cancels every active stream ctx and
   closes `done` before `handleConn`/`ServeGitStream` run their deferred `gconn.Close`, so a stream
   blocked in `creditGate.acquire` or `sendChunk` returns first and `dispose` gets `w.mu`. A wedged
   but connected peer stalls only its own conn's `graph.*` calls (D13 by design).
16. Dropped. `marks` keys are chunk boundary rows `<= store.RowCount()`, so it never exceeds the row
   count; the store grows only by explicit `graph.loadMore` pages (Part 15 §6.6 owns `gitstore`).
17. Dropped. A push or fetch moves `refs/remotes/*`, the watcher emits refsChanged and `note` runs
   `gh.drop`; `invalidateAfterWrite` skipping `gh` loses nothing. No status-derived cache exists for
   `worktreeChanged` to drop (`Status`, `WorkingDetail` are uncached).
18. Reported as F3 (head writers). `ghState` fills (`snapshotPut`, `branchCachePut`, `githubRepo`) also
   lack a generation check, but a ref move does not change open-PR state and `.git/config` edits fire
   refsChanged again; dropped for those.
