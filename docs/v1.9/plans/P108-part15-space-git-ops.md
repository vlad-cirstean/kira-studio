# P108 Part 15 — review plan: Space git preflight, ops, review, search and graph store

Chunk B3, stream B position 3 (pre-plan §5.14). Parts 13 and 14 landed first. One Opus reviewer
runs this plan and reports findings. It fixes nothing. One Sonnet fixer then lands one commit per
finding. Tree surveyed: `50531fc`.

Paths repo-relative. `PI` = `apps/kira-space/internal`. `A1` = Part 2's shared Go base (closed,
owned by stream A per pre-plan §3.3). `B2` = Part 14 (`gitclient`, `ghclient`, closed).

## 0. Method

- **`codegraph_explore`**, two survey calls: the conflict state machine (`ContinueArgs`/
  `AbortArgs`/`SkipArgs`/`sequencerArgs`, `ClassifyInProgress`, `operationOf`, its TS twin
  `git-core/src/model/operation.ts`, caller `gitsession.prepareSequencerVerb`); the review store
  (`gitreview.Store`, `ensureOpen`/`conn`, `AddComment`, `sweepDB`/`Purge`, `gitsession`'s
  `AddComment`/`NewStore` callers, `gitstore.Store.Append`). More calls during review to size
  blast radius.
- **`git grep` of import lines** for the exact importer set (§2). Go's `internal/` rule makes
  import lines authoritative.
- **Real git probes** in a scratch repo for any claim resting on git's on-disk state or output
  shape (`rebase-apply` under `git am`, `stash` output, `grep`/`log -G` on binary content).
- **Mirror check.** `gitstore` encode against `git-ipc` `graphChunkCodec.ts`; `gitpreflight`
  classifiers against their `git-core/src/model` TS ports where one exists.

## 1. Own file set

Production files. Tests read only where they pin a contract the review questions.

- `PI/gitpreflight/`: `checkout.go`, `cherrypick.go`, `operation.go`, `pull.go`, `push.go`,
  `reset.go`, `revert.go`, `stack.go`, `stash.go`, `status.go`, `undo.go`, `worktree.go`
  (2,489 lines). Pure classifiers, no I/O.
- `PI/gitops/`: `branch.go`, `checkout.go`, `cherrypick.go`, `conflict.go`, `errors.go`,
  `fetch.go`, `progress.go`, `pull.go`, `push.go`, `remote.go`, `reset.go`, `revert.go`,
  `stack.go`, `stash.go`, `tag.go`, `worktree.go` (1,213 lines). Argv builders, stderr
  classifiers, progress parser, state-file reader.
- `PI/gitreview/`: `comments.go`, `db.go`, `export.go`, `migrate.go`, `normalize.go`,
  `project.go`, `ranges.go`, `reaper.go`, `resolve.go`, `snapshot.go`, `store.go`,
  `migrations/{embed.go,0001_g11_review.sql,0002_g13_comments.sql}` (1,504 lines Go).
- `PI/gitsearch/`: `dialect.go`, `doc.go`, `literal.go`, `matcher.go`, `query.go`, `scan.go`
  (920 lines).
- `PI/gitprepare/`: `doc.go`, `output.go`, `runner.go`, `script.go` (690 lines).
- `PI/gitstore/`: `encode.go`, `intern.go`, `pack.go`, `sha.go`, `store.go` (382 lines).
- `PI/gitwire/`: FlatBuffers-generated (`// Code generated … DO NOT EDIT`). Out of scope as
  code (pre-plan §6); reviewed only as the schema `gitstore/encode.go` writes against.

About 7.2k production lines plus 8.1k test lines.

## 2. One hop: callers

From import lines, production only.

- **`gitpreflight`**: `gitsession/{cache,entry,ops,preflight,remote,stack,status,worktree}.go`,
  `gitrpc/{refs,remote,reset,stack,stash,wire,worktree}.go`, own-chunk `gitops/conflict.go`.
- **`gitops`**: `gitsession/{autofetch,gh,ops,preflight,remote,stack,stash,status,worktree}.go`.
- **`gitreview`**: `gitsession/{comments,entry,incremental,registry,review}.go`,
  `gitrpc/{review,wire}.go`.
- **`gitsearch`**: `gitsession/search.go`, `gitrpc/search.go`.
- **`gitprepare`**: `gitsession/worktree.go` only.
- **`gitstore`**: `gitsession/walk.go`, `gitrpc/graph.go`.
- **`gitwire`**: own-chunk `gitstore/encode.go` only.

`gitsession` (Part 16) and `gitrpc` (Part 17) are not yet reviewed. Treat their current on-disk
state as the caller contract. A finding whose fix lands in them is noted as such, not deferred:
the fixer edits the caller when the bug is at the boundary.

## 3. One hop: callees

- `PI/gitclient`, `PI/gitclient/porcelain` (B2, closed). Treat as correct.
- `internal/sqlitex` (A1, closed) via `gitreview/db.go`. A needed edit there is a stream-A
  handoff (§3.3).
- `PI/config` (`KiraSpaceHome`, `EnsureLayout`), `PI/gitpath`.
- **Correction to §5.14:** no chunk package imports `PI/storage`. `gitreview` owns its own
  `review.db` through `sqlitex.Open`, separate from `kira.db`.
- External: the user's `git` binary (through `gitsession` spawns), `/bin/sh` for `gitprepare`
  scripts, `regexp` (RE2) for `gitsearch`, FlatBuffers Go runtime.

## 4. Edge cases to weight

1. **Conflict state machine.** `ClassifyInProgress` precedence against real state dirs:
   `rebase-apply` created by `git am` (not a rebase), `rebase-apply` lacking `head-name`/`onto`
   reads, stale `sequencer/` after a finished pick, bisect plus merge. Continue/abort/skip per
   kind against what git accepts; `Can*` flags against `*Args` returns (P107 I2-46 table).
   Partial resolution: `UnmergedCount` gate against a truncated path list.
2. **Stderr classifiers (`gitops/errors.go`).** Locale (`LC_ALL`), multi-line hints, git version
   wording drift, a classifier matching a substring that also appears in a path or ref name.
3. **Progress parser.** `\r`-separated frames, split reads mid-frame, percentages over 100,
   non-UTF-8 remote messages, unbounded line buffers.
4. **Argv injection.** Every builder taking a caller string (branch, tag, remote, stash ref,
   worktree path, pathspec). Confirm dash-leading values are rejected upstream or sit after
   `--`/`--end-of-options`.
5. **Preflight classifiers.** Checkout/reset/revert/cherry-pick/stash/push/pull/worktree
   matrices: every blocker reachable, no silent "safe" on unknown input, detached HEAD, unborn
   branch, SHA-256 widths, protected-branch flags. Stack restack plan correctness (cycles,
   missing parents, merged parents, ordering).
6. **Review store.** Transaction boundaries: read-modify-write spanning statements outside one
   tx; `upsertSession` races between two connections; `Purge`/sweep racing a mark or comment
   (FK cascade, orphan rows). `Close` against in-flight `conn()` callers and a reaper tick.
   Reopen after `Close`. `keyedMutex` refcount leak. Migration idempotence and version gate.
   `PRAGMA incremental_vacuum` inside or outside a tx.
7. **Review projection.** Range arithmetic (`ranges.go`): merge/split at boundaries, empty and
   whole-file ranges, CRLF/no-trailing-newline files, binary/non-text refusal, line-count
   off-by-one. Anchor resolution tiers (`resolve.go`) under renames and deleted files.
8. **Search.** Literal-to-regex escaping, case folding on non-ASCII, dialect translation of user
   regex into git's (`-G`/`--grep`) and RE2, adversarial input (NUL, invalid UTF-8, huge
   patterns), catastrophic cost, result caps, cancellation killing the scan process.
9. **Prepare runner.** Script output capture caps, UTF-8 splitting, ANSI stripping, process-group
   kill on cancel, orphaned grandchildren holding pipes, env/cwd hygiene, concurrent runs on one
   worktree.
10. **Graph store.** `Append` after a width change (sha1 fixed by first record), parent-offset
    overflow, interner growth, `PackSlice` offset rebasing at slice bounds, decorations keyed by
    absolute row, concurrent `Append` against a reader packing a slice (who holds the lock).
    Encode against the TS decoder's expectations (field order, identifier, empty vectors).

## 5. Watch items from pre-plan §5.14

- P107 I2-46 table-drove `ContinueArgs`/`AbortArgs`/`SkipArgs`: check per-op flags.
- `gitwire` against `git-ipc/src/generated` and `graphChunkCodec.ts` (Part 17 owns them; read
  only).

## 6. Out of scope

- `gitsession` and `gitrpc` logic beyond the boundary contract (Parts 16 and 17).
- Generated `gitwire` source.
- `gitclient`/`ghclient` internals (Part 14, closed).
