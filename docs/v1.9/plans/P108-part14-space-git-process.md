# P108 Part 14 — review plan: Space git process layer

Chunk B2, stream B position 2 (pre-plan §5.13). Gate G1 met: Part 2 landed. One Opus reviewer runs
this plan and reports findings. It fixes nothing. One Sonnet fixer then lands one commit per
finding. Tree surveyed: `b3f122b`.

Paths repo-relative. `PI` = `apps/kira-space/internal`. `A1` = Part 2's shared Go base (closed,
owned by stream A per pre-plan §3.3).

## 0. Method

- **`codegraph_explore`**, three calls: the `Runner`/`Run`/`execRunner` spawn seam and its 22
  `Run` callers; the askpass flow (`Broker`, `RunHelper`, `ShouldInterpose`, `main.go` argv shim,
  `gitsession.withAskpass`); the `catfile` size gate (`Check`/`Read`/`ErrTooLarge`,
  `ReadOneShot`/`CheckOneShot` callers in `gitsession`/`codeworkspace`).
- **`git grep` of import lines** for the exact importer set (§2). Go's `internal/` rule makes
  import lines authoritative.
- **Real git 2.43 probes** for every parser claim that depends on git's output shape. Run them in
  a scratch repo, never assume.
- **Vendored source read** where a claim depends on library behavior: Go 1.27 `os/exec`
  (`WaitDelay` against `*Pipe()` pipes), `fsnotify/fsevents` v0.2.0 (`fsevtCallback` send,
  `stop()` on the dispatch queue).

## 1. Own file set

Production files. Tests are read only where they pin a contract the review questions.

- `PI/gitclient/`: `runner.go`, `repo.go`, `discovery.go`, `errors.go`, `capabilities.go`,
  `client.go`, `clock.go`, `watcher.go`, `watcher_fsnotify.go`, `watcher_fsevents_darwin.go`
  (1849 lines).
- `PI/gitclient/porcelain/`: `records.go`, `types.go`, `log.go`, `refsnapshot.go`, `refs.go`,
  `status.go`, `show.go`, `stash.go`, `blame.go`, `diff.go`, `difftree.go`, `workingdiff.go`,
  `mergetree.go`, `worktree.go`, `reset.go`, `review.go` (2439 lines), plus `testdata/**`.
- `PI/gitclient/catfile/`: `batch.go`, `session.go` (402 lines).
- `PI/gitclient/logsession/session.go` (408 lines).
- `PI/ghclient/`: `runner.go`, `discovery.go`, `api.go`, `pr.go`, `remote.go`, `errors.go`,
  `status.go`, `doc.go` (962 lines).
- `PI/gitpath/gitpath.go` (46 lines).
- `PI/gitaskpass/`: `broker.go`, `helper.go`, `interpose.go`, `prompt.go`, `wire.go` (391 lines).

About 6.5k production lines plus 7.3k test lines. Correction to §5.13: `catfile` and
`logsession` are subpackages of `gitclient`, not separate chunks.

## 2. One hop: callers

From import lines, production only.

- **`gitclient`**: `gitsession/{conn,entry,ops,queries,refs,registry,remote,stack,status,
  subscriber,walk,worktree}.go`, `gitrpc/{handlers,wire}.go`, `gitsearch/scan.go`,
  `codeworkspace/{enumerate,files,session}.go`, `bridge/codeworkspace.go`, `main.go`
  (`wireGit`).
- **`porcelain`**: 17 `gitsession` files, `gitrpc/{detail,graph,incremental,wire}.go`,
  `gitpreflight/{stash,status}.go`, `gitreview/{project,resolve}.go`, `gitstore/{encode,pack,
  store}.go`, `gitsearch/scan.go`, `codeworkspace/files.go`.
- **`catfile`**: `gitsession/{entry,incremental,ops,queries,stack}.go`,
  `codeworkspace/{diff,session}.go`.
- **`logsession`**: `gitsession/walk.go`, `gitrpc/graph.go`.
- **`ghclient`**: `gitsession/{entry,gh,registry}.go`, `gitrpc/wire.go`.
- **`gitpath`**: `gitrpc/{detail,graph,handlers,search,settings,worktree}.go`,
  `gitreview/normalize.go`, plus own-chunk `repo.go`, `watcher.go`, `porcelain/{refs,worktree}.go`.
- **`gitaskpass`**: `gitsession/{conn,remote}.go`, `gitrpc/handlers.go`, `main.go` (argv shim
  `askpass`, `wireGit`).
- **Correction:** `gitops`, `gitprepare`, `gitvsix`, `gitwire` import none of this chunk.
  `gitops` builds argv that `gitsession` feeds to `gitclient.Run`. `gitprepare` and `gitvsix`
  mirror `ghclient`'s runner shape. Review them only for that argv/shape contract.

## 3. One hop: callees

- `internal/toolexec` (`IsExecutable`, from both discovery files) and `internal/localsock`
  (`Listen`, `RandHex`, from `gitaskpass/broker.go`). Both are A1, closed. Treat as correct. A
  finding that needs an edit there is a stream-A handoff (§3.3), not an in-place fix.
- **Correction:** `pathsafe` and `kirapaths` are not imported by this chunk.
- External: the user's `git` and `gh` binaries, `fsnotify`/`fsevents`, Go `os/exec`.

## 4. Edge cases to weight

1. **Argument injection.** Every builder that takes a caller string (`ShowMetadataArgs`,
   `MergeBaseArgs`, `FileDiffArgs`, `SingleRefArgs`, `RangeSubjectsArgs`, `LeftRightCountArgs`,
   `ReadOneShot`, `CheckOneShot`). Confirm a dash-leading value is rejected upstream
   (`gitrpc.validRefArg`, `gitsession.validOpArg`) or sits after `--`. `ghclient`:
   `--hostname <host>` from a remote URL, and path/query escaping of owner/repo/sha/branch.
2. **Porcelain framing against adversarial output.** 0x1f inside any field that is not last
   (author/committer name and email, tagger name, stash reflog subject). Unknown `%D` tokens
   (`grafted` in shallow clones, `replaced` from replace refs). Quoted paths in non-`-z` output
   (`merge-tree --name-only`). Rename path records mistaken for header records. Newlines in
   worktree paths under LF framing.
3. **Inherited user config that changes output shape.** `diff.suppressBlankEmpty`, `color.*`,
   `log.*`, `status.*`. Check each against `configOverrides` and explicit flags.
4. **Parse-error recovery.** What a streaming consumer (`logsession`, `gitsearch`) leaves behind
   after one bad record: live process, dropped batch remainder, `readCount` drift.
5. **Process lifecycle.** Pipe EOF against orphaned grandchildren (hooks), `WaitDelay` reach,
   `Close` idempotence, escalate-timer pid reuse, reclaim-timer races, cancellation reaching every
   blocked read.
6. **`catfile` protocol.** Size gate across two processes (TOCTOU on a mutable rev like
   `HEAD:<path>`). Non-`missing` replies (`ambiguous`). Circuit-breaker recovery. Pipelined write
   against an early read error. Missing ctx on persistent requests. Unbounded `ReadOneShot`.
7. **Credentials.** Askpass token/op-id exposure (env, argv, logs). Shim quoting (`$`, backtick,
   `\` inside double quotes). Helper fail-closed paths. `SSH_ASKPASS_PROMPT` variants.
   `ShouldInterpose` precedence. `GH_TOKEN` never touched.
8. **Environment hygiene.** Inherited `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` retargeting
   spawns. Compare `ghclient`'s own `GH_REPO=` clear.
9. **Watchers.** fsevents `Close` D10 sequence against a `run` goroutine parked mid-forward.
   fsnotify refs-tree growth. NFC classification.
10. **Repo gate.** `Read`/`Write` slot accounting on cancellation. Writer starvation under
    continuous reads.
11. **Identity edge cases.** `symbolic-ref --short` disambiguation (`heads/<b>` when a tag shares
    the name). SHA-1-only literals (`EmptyTreeSHA`, `UncommittedBlameSHA`, `isHexSha40`) in a
    SHA-256 repository.

## 5. Watch items from pre-plan §5.13

- NUL/0x1f parsing: CRLF subjects, empty bodies, trailers, signed commits, renames, binary and LFS
  diffs. `porcelain/testdata` covers the subject-last cases only.
- `cat-file --batch` size gate (`Check` before `Read`, `ErrTooLarge`) and the newline-in-rev
  fallback.
- `Repo.Read`/`Write` slot accounting against cancellation.
- Askpass credential handling.

## 6. Out of scope

- RPC-layer validation itself (`gitrpc`, Part 17) and `gitsession` logic (Part 16). Read them only
  to size a finding's blast radius.
- Pairing trust: a paired client setting `git.path` to an arbitrary binary is a Part 17 question.
  Pairing requires user approval.
- Generated `gitwire` code (pre-plan §6).
