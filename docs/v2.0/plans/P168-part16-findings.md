# P168 Part 16 findings: Space git session

Plan: `P168-part16-space-git-session.md`. Reviewer reports only; fixer follows §10.
Base commit `088fd66`; HEAD reviewed `78539f6` (plan commit only on top). `PI` = `apps/kira-space/internal`,
`GS` = `PI/gitsession`.

Checks at HEAD: `go vet ./apps/kira-space/internal/gitsession/...` clean;
`go test -race -count=1 ./apps/kira-space/internal/gitsession/...` `ok` (27.3 s).

## Block status

- Block 1 lifecycle: done
- Block 2 walk and reads: done
- Block 3 ops and undo: done
- Block 4 stack and worktree: done
- Block 5 remote and auto-fetch: done
- Block 6 review: done
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
resolved). Same shape as `status.go:106-133`. `ResolveReviewBase` (`GS/review.go:157-214`) has the same
gap for `RememberRangeCount`: a count computed before a refsChanged is stored after `note` dropped the
slot and seeds the next ranged walk's `PrecomputedTotal`; guard it the same way.

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

### F6 (medium): multi-argv op failing after its first write reports failure and drops its undo

`GS/ops.go:1209-1249` (`RunOp`), producers `prepareBranchDelete` (`ops.go:458-499`),
`prepareBranchCreate` (`ops.go:426-449`), `prepareBranchRename` (`ops.go:507-525`). Owner: Stream B
(`GS`).

`runWriteArgvList` stops at the first failing argv and reports `failedAt`. `RunOp` then treats any
`opErr` as "not succeeded": `OK: false`, `record = nil`, `e.undo.Set(nil)`. Only the auto-stash case
(`failedAt > 0 && autoStashApplied`) mentions that an earlier argv already wrote. Scenarios:

- `branchDelete` of a stack parent: argv 0 `branch -d topic` succeeds, argv 1 `config
  branch.child.kirastackparent …` fails (`.git/config.lock` held by an external git or IDE). Result:
  `OK: false`, branch gone, children still name it, and no undo although
  `captureBranchDeleteUndo` built a record that restores both. Recovery needs the reflog by hand.
- `branchCreate` with `track` (candidate 7, real git 2.43 probe): `branch nb main` succeeds,
  `branch --set-upstream-to=origin/nope nb` exits 128 ("the requested upstream branch 'origin/nope'
  does not exist"). Result `OK: false` while `nb` exists (and with `checkout`, HEAD moved to it). A
  retry then fails `AlreadyExists`.
- `branchRename` with stack children: rename succeeds, a child fix-up fails; children keep the old
  name, result says the rename failed.

Fix: when `failedAt > 0`, the primary write landed. For an undoable kind, still `Set` the prepared
undo record (its replay restores ref and config). Append one sentence naming what landed and what
did not (generalise the auto-stash message: "Branch nb was created; setting its upstream failed.").
Keep `OK: false`. Add a real-git test for the branch-delete-with-child case (inject the failure with a
held `config.lock`).

### F7 (medium): branch-delete undo replays `config --get-regexp` output line by line

`GS/ops.go:1008-1022` (`captureBranchDeleteUndo`). Owner: Stream B (`GS`).

The capture splits `config --get-regexp ^branch\.<name>\.` stdout on `\n` and replays each line as
`config <key> <rest>`. Real git 2.43 probe: a multi-line value (`git branch --edit-description`
writes one) prints its continuation lines raw:

```
branch.topic.description first line
core.hooksPath /tmp/evil
branch.topic.merge refs/heads/a
branch.topic.merge refs/heads/b
```

Undo then writes `config core.hooksPath /tmp/evil`: any description line shaped `<section>.<key>
<value>` becomes an arbitrary local config write (hooks path, `core.fsmonitor`, `alias.*`), and any
other continuation line makes `git config` fail mid-replay after the ref was recreated. Multi-valued
keys collapse: replaying `config branch.topic.merge a` then `config branch.topic.merge b` leaves only
`b` (probe: `--get-all` prints `refs/heads/b`). Values are local config the user or a tool wrote, so
this is integrity, not remote injection.

Fix: capture with `config -z --get-regexp` (records `key\nvalue\0`), split on NUL then the first
`\n`, and replay each as `config --add <key> <value>` (the section is gone after the delete, so
`--add` reproduces multi-valued keys exactly). Add a real-git test with a multi-line description and
a two-valued key.

### F8 (low): `UndoRun` takes the record before validating it and replays argv one write each

`GS/ops.go:1281-1321`. Owner: Stream B (`GS`).

Candidate 6: `e.undo.Take(id)` runs before `session.Check`; any non-`ErrMissing` check error
(cat-file circuit open after 3 spawn failures, F1's closed-session race, a transient spawn error)
returns a Go error and the record is gone for good. Candidate 5: the replay loop calls `runWriteArgv`
per argv, one `Repo.Write` each. Branch-delete undo is `update-ref` plus N `config` writes plus child
pointers; another window's op can interleave between them, and a later argv failing leaves the ref
recreated without its config. `RunOp` already uses `runWriteArgvList` for this reason (P108 F12).

Fix: `Peek` and validate first, `Take` only once the check passed (compare id again on `Take`); or on
a non-`ErrMissing` check error restore the record only if the slot is still empty. Replace the loop
with one `runWriteArgvList(ctx, record.Replay)`.

### F9 (low): post-write read-back error hides a completed write and loses its undo

`GS/ops.go:1228-1249` (`RunOp`), `GS/ops.go:1323-1330` (`UndoRun`), `GS/remote.go:399-406`
(`RunRemote`: a completed push or pull answers a Go error the same way). Owner: Stream B (`GS`).

Candidate 10. After a successful write, `statusAndInProgress` or `Head` failing returns
`OpResult{}, err`. `e.undo.Set(record)` runs after both reads, so the undo record captured before the
write is dropped (the slot was already cleared at `ops.go:1203`). The client sees `E_INTERNAL` (or a
mapped git kind) for an op that did run. Part 14's stricter `ResolveHead` (`8462e1f`) widens this:
`Head` spawns whenever the watcher bumped `cacheGen` between the write and the read-back (our own
write triggers it), and now fails on any non-1 verify exit instead of reporting unborn.

Fix: `e.undo.Set(record)` immediately after the write succeeds, before the read-back. On a read-back
error after a write, return the `OpResult` with `OK` reflecting the write, `Head` from the last known
value (`e.head` under `headMu`) and `InProgress` nil, logging the read error, rather than a Go error.

### F10 (low): hard-reset undo refused by `reset --keep` classifies as `Unknown`

`PI/gitops/errors.go:100-176` (`classifyOpErrorRules`). `needs-other-part-file:
apps/kira-space/internal/gitops/errors.go (Part 15)` (Stream B, closed; editable by this fixer).

Real git 2.43 probe: `reset --keep HEAD~1` with an edit to a file the reset touches prints
`error: Entry 'f' not uptodate. Cannot merge.` / `fatal: Could not reset index file to revision
'HEAD~1'.` (exit 128). No rule matches, so `UndoRun` reports `Kind: "Unknown"`. The message is the raw
stderr, so the UI cannot say "your edits since the reset block this undo". `update-ref` refusing a
recreated ref (`reference already exists`) maps to `AlreadyExists`, which is fine.

Fix: add a row before the generic ones: `not uptodate. cannot merge` maps to `DirtyWorktree`. Extend
`TestUndoRun_HardResetUndoKeepsEditsMadeSince` to assert `undo.Error.Kind`.

### F11 (medium): ref-moving undo replays never check the ref is still where the op left it

`GS/stack.go:592-624` (`buildRestackUndo`), `GS/ops.go:901-911` (cherry-pick undo), `GS/ops.go:847-861`
(hard-reset undo via `UndoResetArgs`), `GS/ops.go:1281-1321` (`UndoRun`). `needs-other-part-file:
apps/kira-space/internal/gitpreflight` (`UndoRecord`, Part 15, Stream B, editable by this fixer).

Part 15 made branch/tag-delete undo refuse when the ref was recreated (`RecreateRefArgs`). The other
ref-moving replays still move unconditionally. The undo slot is cleared only by the next in-app op,
so a commit made in a terminal or IDE leaves it armed. Scenarios:

- Restack A, B, C (HEAD on A). User runs `git switch C && git commit` in a terminal, then clicks Undo.
  Replay `update-ref refs/heads/C <oldTipC>` (two-argument form, no expected old value) drops the new
  commit from C; `reset --keep <oldTipA>` likewise drops any commit made on A since.
- Cherry-pick, then a terminal commit on the same branch, then Undo: `reset --keep <prev>` with a
  clean tree moves the branch back past the new commit and rewrites the worktree.
- Hard reset, then a commit, then Undo: same `--keep` replay.

`RecoverySha` existence is the only pre-check. Commits survive only in the reflog.

Fix: record the post-op tips on the `UndoRecord` (new field, e.g. `ExpectedTips map[ref]sha`, set
after the op succeeds: HEAD for reset/cherry-pick, every restacked branch for restack). `UndoRun`
verifies them before replaying and answers `{ok:false}` with a "changed since" message on mismatch,
like the recreated-ref case. For the restack `update-ref` lines use the three-argument form with the
post-restack tip as the expected old value.

### F12 (low, design-decision): auto-fetch disables itself for the entry's life on any failure

`GS/autofetch.go:414-428` (`autoFetchTick`).

Every non-OK result except `OperationInProgress`, and every Go error, calls `disableAutoFetch`,
which only teardown resets. The doc names AuthFailed as the case; `NetworkFailed` (laptop asleep,
offline, VPN down), `RemoteNotFound` after a remote rename, and a Go error from the post-fetch
read-back (F9) disable it the same way. ADE's board Conn never releases its holds
(`ade/board.go:283`), so for any repository ADE touched the entry lives as long as the app: one
offline tick turns auto-fetch off until restart, silently (no UI marker, per the code's own comment).
Which kinds count as transient (reschedule, maybe with backoff) versus permanent is a product call
on D23. Not proposed as a fix.

### F13 (low): auto-fetch tick racing teardown runs an uncancellable fetch on a dead entry

`GS/autofetch.go:390-416`, `GS/entry.go:434-437`, `GS/remote.go:293-299`. Owner: Stream B (`GS`).

`autoFetchTick` reads `disabled` once, then calls `pickAutoFetchRemote` and `RunRemote`. `teardown`
can run in between: `stopAutoFetch` cannot stop a timer that already fired, and `remoteOp.forceCancel`
finds nothing claimed yet. The tick then claims the slot on the torn-down entry and runs `git fetch
--prune` with `context.WithoutCancel(Background)` that nothing will ever cancel, then the read-back
spawns. Reached at linger expiry and at `Registry.Close` during quit. One stray network fetch per
race; no state corruption.

Fix: after `remoteOp.claim` succeeds in `RunRemote`, check `e.tornDown` under `e.mu` and release and
return `ErrRepoTornDown` when set (covers every caller); in `autoFetchTick` re-read `disabled` right
before `RunRemote`.

### F14 (medium): review line count derived from a non-text record's zero `LineCount`

`GS/incremental.go:395-437` (`FileDelta` tiers 1 and 2), consumer `GS/incremental.go:728-738`
(`MarkFile`), `GS/incremental.go:670` (`ReviewFileDiff`). Owner: Stream B (`GS`).

`readSnapshotSource` stores `LineCount: 0` for `ContentTooLarge` (over `gitreview.MaxSnapshotBytes`,
1 MiB), `ContentBinary` and `ContentAbsent`. `FileDelta` then uses `rec.LineCount` as the base:

- Tier 1 computes `rec.LineCount + sumHunkDelta(parsed.Hunks)`. G31 F7 re-measures only when the
  patch is `BodyTooLarge`. A file marked at 1.2 MiB (tooLarge, `LineCount` 0) and trimmed to 0.9 MiB by
  one hunk deleting 3,000 lines yields `currentLineCount = -3000`. A binary-to-text change has no
  hunks (`Binary files differ`), so the result is 0 for a text file of N lines.
- Tier 2 `snapshotUnavailable` (history rewritten, record not text) returns `rec.LineCount` (0) as
  the current count.

`MarkFile` adopts `delta.CurrentLineCount` whenever the current content is text, so a ranged mark is
clamped to 0 or a negative bound and silently stores nothing, and the record is written with that
`LineCount`. Tier 0 then keeps returning the bad count for as long as the blob is unchanged, so the
file can never take a ranged mark. `ReviewFileDiff` sends the same value as `LineCount` to the client.

Fix: in `FileDelta`, when `rec.ContentKind != gitreview.ContentText`, measure the current count
directly (`readCurrentContent` plus `countLines`, as the slow path does) in tiers 1 and 2; keep the
hunk arithmetic only for a text record. Add a real-git test: mark a >1 MiB file, shrink it below the
cap, mark a range, assert the stored range and `LineCount`.

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
5. Reported as F8.
6. Reported as F8.
7. Reported as F6 (real git probe confirms the partial write).
8. Reported as F7 (real git probe).
9. Reported as F5.
10. Reported as F9.
11. Reported as F12 (permanent disable, design-decision) and F13 (teardown race).
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
22. Dropped. `undo_guard_test.go` runs real git (`initUndoGuardRepo`, `runGitQ`) and asserts the refs
   and worktree after the refused replay, not argv shape. It does not assert `Error.Kind`; F10 adds
   that.
20. Dropped. `RunPrepare` and `worktreeRemove` of the same worktree are both user actions, the remove
   needs the typed token once the script dirtied the tree, and the script then fails on a missing
   directory with no app state left inconsistent. `prepareWorktreeRemove` could refuse while
   `e.prepare` is running on `target.Path`; noted, not reported.
19. Dropped. A clobbered `reviewRangeCountSlot` makes the other window's `TakeRangeCount` miss and
   logsession count itself (`review.go:31-42`, D9 fallback). Cost only, never wrong data.
