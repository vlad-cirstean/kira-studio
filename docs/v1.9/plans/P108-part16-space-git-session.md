# P108 Part 16 — review plan: Space git session

Chunk B4, stream B position 4 (pre-plan §5.15). Parts 13, 14 and 15 landed first. One Opus reviewer
runs this plan and reports findings. It fixes nothing. One Sonnet fixer then lands one commit per
finding. Tree surveyed: `6875ad2`.

Paths repo-relative. `PI` = `apps/kira-space/internal`. `B2` = Part 14 (`gitclient`, `ghclient`,
`gitaskpass`, closed). `B3` = Part 15 (`gitpreflight`, `gitops`, `gitreview`, `gitsearch`,
`gitprepare`, `gitstore`, closed).

## 0. Method

- **`codegraph_explore`**, three survey calls: registry/conn lifecycle (`Registry`, `acquire`,
  `release`, `expire`, `Close`, `Conn.Open`/`CloseRepo`/`Close`, `gitsock.Server.Close`, `wireGit`);
  the walk state machine (`walkForSlot`, `WalkFor`/`ReviewWalkFor`, `Conn.Walk`, `walkPair`,
  `readPageLocked`, `logsession.Session.ReadPage`); remote ops (`RunRemote`, `runPullOp`,
  `wantsRebaseMerges`, `PushPreflight`, `opSlot`, `EnsureAutoFetch`). More calls during review to
  size blast radius.
- **`git grep` of import lines** for the exact importer set (§2). Go's `internal/` rule makes import
  lines authoritative.
- **Real git probes** in a scratch repo for any claim resting on git's output or on-disk state.
- **Cross-chunk touches re-verified**, not trusted: Part 14 F2 (`walk.go`), Part 14 F18
  (`working.go`), Part 15 F1 and F6 (`remote.go`). Each is read against this chunk's full context.

## 1. Own file set

`PI/gitsession/`, production files (9,396 lines): `autofetch.go`, `cache.go`, `comments.go`,
`conn.go`, `entry.go`, `gh.go`, `incremental.go`, `ops.go`, `opslot.go`, `preflight.go`,
`queries.go`, `refs.go`, `registry.go`, `remote.go`, `review.go`, `search.go`, `stack.go`,
`stash.go`, `status.go`, `subscriber.go`, `walk.go`, `working.go`, `worktree.go`. Tests
(`*_test.go`, about 7.5k lines) read only where they pin a contract the review questions.

## 2. One hop: callers

From import lines, production only.

- **`PI/gitrpc`** (Part 17, next): `comments`, `detail`, `gh`, `graph`, `handle`, `handlers`,
  `incremental`, `ops`, `refs`, `remote`, `reset`, `review`, `search`, `settings`, `stack`,
  `stash`, `wire`, `worktree`. Symbol level: `Conn` (every handler resolves one), `Conn.Walk`/
  `WalkFor`/`ReviewWalkFor`, `RepoEntry.RunRemote`/`RunOp`/`PushPreflight`/`PullPreflight`,
  `Conn.Open`/`CloseRepo`/`ProvideCredential`.
- **`PI/gitsock/server.go`**: `NewConn` per accepted connection, deferred `Conn.Close`,
  `Registry.Close` after `wg.Wait` on shutdown.
- **`PI/bridge/{gitstream,github}.go`**, **`PI/appcore/deps.go`**: host-side registry wiring.
- **`apps/kira-space/main.go`** `wireGit`: `NewRegistry`, `Settings`/`RepoSettingsGet`/
  `RepoSettingsSet` hooks, `ReconcileAutoFetch` on a settings change.

`gitrpc` is not yet reviewed. Treat its on-disk state as the caller contract. A boundary bug whose
fix lands there is still a finding here.

## 3. One hop: callees

- `PI/gitclient` (`Repo.Read`/`Write`, `Run`, `Identify`, `NewRepoWatcher`), `catfile`,
  `logsession`, `porcelain`; `ghclient`; `gitaskpass` (broker, env). B2, closed: treat as correct.
- `gitpreflight`, `gitops`, `gitreview`, `gitsearch`, `gitprepare`, `gitstore`. B3, closed.
- `PI/storage/model` (settings types only).
- **Correction to §5.15:** `gitaskpass` is a callee, not a caller (gitsession imports it; nothing
  in it imports gitsession). `codeworkspace` is not imported by gitsession at all. `PI/storage` is
  reached only through `storage/model` types; repo settings persistence arrives via main.go hooks.

## 4. Edge cases to weight

1. **Registry lifecycle.** `acquire` identify-outside-lock then construct: two concurrent first
   acquires for one repo (duplicate watcher/entry). Linger timer firing (`expire`) racing a
   re-acquire that cancels it (`Stop` returning false). `Close` racing an in-flight `acquire` or a
   pending `expire`. Release after `Close`. `closeCatFile` at refcount zero racing a reader.
2. **Conn lifecycle.** `Open` after `Close` (closed flag), duplicate concurrent `Open`,
   `CloseRepo` racing `Walk`. Subscriber callbacks firing into a closed conn. Credential waiters
   on disconnect.
3. **Walk state machine.** `walkForSlot` (I2-47) correctness against `Walk`'s slot choice. Walk
   disposed by `CloseRepo`/spec change while a `ReadPage`/`Stream` holds it outside `Conn.mu`.
   Stale marking vs a read in flight. Part 14 F2's `resetLocked` on error: store/offset
   consistency, what the next read and `Status` see, error vs `Stale` retry interplay.
4. **Remote ops.** `opSlot` claim/release/cancel; killable phases; cancellation mid-fetch vs the
   pull's integrate write; lease check vs gate resolution (Part 15 F1: double resolve, TOCTOU);
   askpass lifetime; cache invalidation on every exit. Part 15 F6's `wantsRebaseMerges`
   (explicit-override vs config-derived strategy: open limitation to re-assess).
5. **Local ops.** `RunOp` undo slot, in-progress re-checks, cache invalidation on error paths,
   stash/stack/worktree writes under `Repo.Write`, restack undo, prepare runner cancel.
6. **Caches.** Invalidation ordering vs a concurrent reader repopulating stale data
   (generation counters), unbounded growth, keys missing a discriminator.
7. **Auto-fetch.** Timer reschedule after teardown, settings change mid-tick, quiet-only entries,
   tick overlapping a user remote op.
8. **Review/comments/incremental.** Store calls keyed by repo; incremental review session state
   across walk resets.
9. **Worktree/gh/search.** Path validation, argv injection, `gh` auth errors, search cancellation.

## 5. Watch items from pre-plan §5.15

- P107 I2-47 extracted `walkForSlot` for `WalkFor`/`ReviewWalkFor`.
- Registry holds and per-connection routing (D18), auto-fetch timers, protected branches.

## 6. Out of scope

- B2/B3 internals beyond the boundary (closed). Part 17's `gitrpc`/`gitsock` internals except as
  the caller contract. `git-ipc` wire changes: a finding needing one is still reported, with the
  contract change named as the fix direction.
- Style nits. Findings must be real bugs: correctness, concurrency, leaks, error handling.
