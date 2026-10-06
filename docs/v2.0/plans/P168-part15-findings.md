# P168 Part 15 findings: Space git preflight, ops, review, search, prepare, graph store, op log

Plan: `P168-part15-space-git-ops.md`. Reviewer: one Opus pass, report only.
Base commit (tree surveyed by plan): `73c7f40`. HEAD reviewed: `ce8e679` (plan commit only on top;
no Part 15 file changed). Worktree `p168-stream-b`.

## Checks

- `go vet` over the seven packages: clean.
- `go test -race -count=1` over the seven packages: 7 ok, `gitreview/migrations` no tests.

## Block status

- Block 1 `gitprepare`: done.
- Block 2 `gitops`: done.
- Block 3 `gitpreflight`: done.
- Block 4 `gitreview` store: done.
- Block 5 `gitreview` logic: done (no findings).
- Block 6 `gitsearch`: done.
- Block 7 `gitstore` and mirror: done (no findings).

## Findings

### F1 (medium) `gitprepare` tick can deliver the final batch after `Run` returns

`apps/kira-space/internal/gitprepare/runner.go:113-130`, `output.go:247-253`.

`Run` closes `tickerDone` and calls `flush` without waiting for the ticker goroutine to exit. A
`tick()` already past `<-ticker.C` can take `mu` first and claim the last pending lines with a
ticket. `flush` then finds `pending` empty, reserves no ticket and returns at once, so nothing
makes `flush` wait for that ticket's `onBatch`. `Run` returns while the tick goroutine is still in
`finishDelivery`. `Spec.OnBatch` doc (`runner.go:39-41`) promises "never called again after Run
returns".

Scenario: a script prints its last lines less than 100 ms after an earlier batch (so `write`
leaves them pending), then exits; the ticker fires during `cmd.Wait`'s return. Effects:
- `ade/setup.go:334-352`: `runSetup` appends `logEvent` "exited with status N" and calls
  `sink.flush()`; the late `sink.add` lands after it, re-arms the 250 ms sink timer, and the
  stored log shows script output after the outcome line.
- `ade/runs.go:553-559`: same, output stored after the run is completed.
- `gitsession/worktree.go:514-523`: a `worktree.progress` event can reach the client after the
  `worktree.prepare` result.

Fix: give the ticker goroutine a `done` channel; after `close(tickerDone)` wait for it to exit
before `collector.flush()`. Then every tick's delivery finishes before `flush`, and `flush`'s own
delivery is last.

### F2 (low) `gitprepare` retained transcript keeps lines after a dropped one, with no gap marker

`apps/kira-space/internal/gitprepare/output.go:296-305` (comment at `11-15`).

`addLineLocked` rejects a line only when that line would push `finalBytes` past 256 KiB. A
later, shorter line that still fits is appended. The comment says "Once either cap is hit, every
further line is ... no longer added". Scenario: a script prints one 300 KiB line (minified JSON,
a base64 blob; `maxUnterminatedBuf` lets lines reach 1 MiB), then `error: build failed`. Result:
`Output` holds the lines before and after, silently missing the middle; `Truncated` is true but
the reader cannot tell where. For `ade/deploy.go:50-57` the first sha-like stdout line after a
gap is accepted as the deployed sha.

Fix: once a line is rejected, latch truncation and stop appending to `final` (match the comment),
or append one marker line at the gap.

### F3 (low) `gitprepare` env scrub misses keys `gitclient` itself treats as redirects

`apps/kira-space/internal/gitprepare/script.go:62-77`.

`gitclient/runner.go:176-178` strips `GIT_NAMESPACE`; `scrubbedEnvKeys` does not. Also absent:
`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` (injected
config, e.g. `credential.helper` or `core.sshCommand`), `GIT_SSH_COMMAND`. No code in the app
sets these (`git grep Setenv` empty); they arrive only from the server's parent env (a launcher
script, an IDE task, a server started from inside a git hook or `git -c ...` alias). Then every
`git` call inside a prepare script, ADE setup/stage script, or the ADE agent (`ade/runs.go:494`)
runs with prefixed refs or injected config. `doc.go:39-40` claims no git variable is inherited.

Fix: add `GIT_NAMESPACE`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT` and strip every
`GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*` by prefix.

### F4 (low) `gitprepare/doc.go` safety claims stale since ADE and `adeagent` became callers

`apps/kira-space/internal/gitprepare/doc.go:1-3, 37-38, 44, 49`.

False today:
- "the one place in this entire chapter that spawns a shell over a command the app did not
  build": `adeagent/process.go:94-95` builds a shell argv for the agent; ADE stage commands
  (`ade/runs.go:446`, `substitute(def.Prompt, …, true)`) and deploy scripts (`ade/deploy.go:36`)
  also spawn through it.
- "never runs implicitly: only right after a creation ... or an explicit Re-run": ADE runs the
  same `WorktreePrepareScript` on task-branch creation and launches (`ade/setup.go:302`,
  `runs.go:291,843`, `launches.go:59`, `board_writes.go:301`) with no sha256 staleness check.
- "A hard 15-minute timeout, unconditional, no setting raises it": `Spec.Timeout` is required and
  `ParsePrepareTimeout` reads a per-repo setting (P145).
- "At most one prepare run per repository": ADE's `claimSetup` is per branch and independent of
  `gitsession`'s slot, so N branch setups plus a `worktree.prepare` run concurrently.
No code depends on these claims, but they are the package's stated security argument. Script text
comes from user-entered app settings and workflows, not repo files, so no trust-boundary breach.

Fix: rewrite the doc to list every caller and which guard each has.

### F5 (medium) `BranchCreateArgs` with `track`: always a usage error, and a dash value deletes branches

`apps/kira-space/internal/gitops/branch.go:10-16`; caller `gitsession/ops.go:425-441`.

`git branch` has no `-t <upstream>`: `-t`/`--track` is a flag (optionally `=direct|inherit`). The
argv `branch <name> <start> -t <track>` makes `<track>` a third positional. Probed on git 2.43:
- `git branch nb main -t origin/main`: exit 129, usage text. So `branchCreate` with
  `checkout: false` and any `track` never creates the branch.
- `git branch keep1 keep2 -t -D`: exit 0, "Deleted branch keep1", "Deleted branch keep2".
  `op.Track` is never passed through `validOpArg` (`ops.go:428-433` checks `name`/`startPoint`
  only) and `gitrpc` has no `Track` check. An `op.run` request
  `{kind:"branchCreate", name:"main", startPoint:"release", checkout:false, track:"-D"}` from any
  paired client force-deletes two branches, bypassing `branchDelete`'s preflight and undo.
The in-app `BranchDialog.vue:56` always sends `track: undefined`, so the bug is latent for the
built-in UI but live on the wire contract (`git-ipc/src/contract.ts:923`).

Fix: build `branchCreate` without `-t`, then append `BranchSetUpstreamArgs(name, track)` (the
`checkout: true` arm already does this, `ops.go:438-441`); run `validOpArg("track", …)` on a
non-nil `Track`. Drop the `track` parameter from `BranchCreateArgs`.
`needs-other-part-file: apps/kira-space/internal/gitsession/ops.go (Part 16)`.

### F6 (low) `ClassifyOpError` still matches user paths listed in git's own error text

`apps/kira-space/internal/gitops/errors.go:59-170` (rule table), `173-184`.

F4 anchored only the conflict markers. Rows ahead of `DirtyWorktree`/`UntrackedWouldBeOverwritten`
still run `strings.Contains` over the whole stderr, which for those two errors lists every
affected path, one per tab-indented line (probed: `error: Your local changes to the following
files would be overwritten by checkout:\n\t<path>`). A dirty path containing `already exists`,
`repository not found`, `connection refused`, `fetch first`, `is not fully merged`,
`conflicts in index` or `hook declined` (paths may contain spaces) is classified as that earlier
kind. Example: dirty `docs/errors/already exists.md`, then switch: `AlreadyExists` instead of
`DirtyWorktree`, so the UI renders the remedy story of the wrong kind.

Fix: drop lines that start with `\t` (git's path-list indent) before running the substring rows,
or match each row on lines starting with `error:`/`fatal:`/`!`/`hint:` only.

### F7 (medium) `DirtyPaths` drops a staged rename's source path; checkout preflight says clean, git refuses

`apps/kira-space/internal/gitpreflight/status.go` `DirtyPaths` (the `"renamed"` arm emits only
`e.Path`, never `e.OriginalPath`); consumers `gitsession/preflight.go:75` (checkout),
`:223`, `:643` (stash pop), `:694`, `ops.go:403`, `stack.go:484`.

Probe (git 2.43): commit `a`; branch `t` changes `a`; on `main`, `git mv a b`. Status v2:
`2 R. … b\ta`. `git diff --name-only -z HEAD t` lists `a`. `ClassifyCheckout` gets
`Dirty=[b]`, `Rewritten=[a]`: no overlap, verdict `cleanCarry`, no `autoStash`/`discard` route.
`git switch --no-guess t` then fails: "Your local changes to the following files would be
overwritten by checkout: a". The user is told the switch is safe and offered no stash route;
the op returns `DirtyWorktree`. Same gap for `ClassifyStashPop` (`localOverwritePaths` misses a
stash touching the rename source).

Fix: in `DirtyPaths` (and `DirtySplit` for the staged side) also emit `OriginalPath` for
`"renamed"` entries, `Tracked: true`. `cherryPickCommitPaths` already counts both names
(`gitsession/preflight.go:433-435`); this aligns the dirty side.

### F8 (medium) Undo replays carry no staleness guard; an undo after outside changes overwrites them

`apps/kira-space/internal/gitops/tag.go:29-31` (`UndoTagArgs`), branch-delete replay built inline
at `gitsession/ops.go:1010` (`update-ref refs/heads/<name> <sha>`), reset replay
`gitsession/ops.go:852` (`ResetArgs(op.Mode, prevOID)`); slot `gitpreflight/undo.go`.

The slot is cleared only by the next app write or teardown (`gitsession/entry.go:449`,
`ops.go:1197,1243`), never by an outside change (terminal, another tool). `UndoRun` checks only
that `RecoverySha` still exists (`ops.go:1284`). Scenarios:
- Delete tag `v1` in the app; recreate `v1` at another commit in a terminal; click Undo:
  `update-ref refs/tags/v1 <old>` silently moves the new tag. Same for a branch recreated after
  delete: its new commits become unreachable.
- `reset --hard` in the app (typed confirmation shown for the dirt it destroyed); keep editing
  files; click Undo: replay is `reset --hard <prev>`, destroying the new edits with no
  confirmation. `reset --keep <prev>` (the cherry-pick undo's own choice, `ops.go:902`) restores
  the same commit and refuses instead of destroying.

Fix: use the expected-old-value form for ref recreation (`update-ref <ref> <sha> ""`, which
refuses if the ref now exists); replay a hard reset with `--keep`. `UndoTagArgs` is a Part 15
file; the branch and reset replays are
`needs-other-part-file: apps/kira-space/internal/gitsession/ops.go (Part 16)`.

### F9 (low) `BuildStacks` memoizes a budget-limited result; order of names decides who is an orphan

`apps/kira-space/internal/gitpreflight/stack.go` `resolveStackBase` (budget check stores
`resolveBroken` in `memo`) and `BuildStacks` (fresh `budget` per candidate, shared `memo`).

When a chain is longer than `MaxStackedBranches` (64) and the deepest branch sorts first, its walk
exhausts the budget at the node 64 hops up and memoizes that node, plus every node between, as
broken. Later candidates within 64 of the base hit the memo and inherit it. Probe (throwaway
test, removed): a 70-branch chain named so depth `i` sorts before depth `i-1` gives 5 stacked and
65 orphans; the branch at depth 6 is reported `parentMissing` though its parent exists. With
names in the opposite order, 64 are stacked. `ClassifyRestack` then reports `parentMissing` for
an intact branch.

Fix: do not memoize a result caused by budget exhaustion (or memoize depth and compare), so each
node's verdict is independent of which candidate reached it first.

### F10 (low) `gitreview.Store` has no closed state: concurrent `Close` panics, use after `Close` reopens and leaks a reaper

`apps/kira-space/internal/gitreview/store.go:87-105`, `db.go:24-58`, `reaper.go`
`startReaperLocked`.

- `Close` releases `openMu` while waiting on `reapDone` but leaves `reapStop` set. A second
  `Close` entering in that window sees `reapStop != nil` and calls `close(reapStop)` again:
  panic "close of closed channel". Today's callers are sequential (`gitsock/server.go:350` then
  `main.go:226`), so this is latent; the doc comment promises idempotence without that caveat.
- After `Close` sets `sqlDB = nil`, any `conn()` (a review RPC still in flight on the bridge's
  native git stream, which `gitSock.Close` does not drain, or an ADE `SetPinned`/`Purge` racing
  quit) runs `ensureOpen` again: reopens review.db, re-runs migrations and the startup sweep, and
  starts a new reaper goroutine nothing will ever stop or join. At quit this is a leaked goroutine
  and a DB handle open past `Registry.Close`; in tests it is a goroutine leak per store.

Fix: add a `closed bool` under `openMu`; `Close` sets it and nils `reapStop` before unlocking;
`ensureOpen` returns an `ErrStoreClosed` once closed.

### F11 (low) repo-id NFC collision keeps the stale row and drops the pinned one

`apps/kira-space/internal/gitreview/normalize.go` `normalizeSessionRepoIDs`
(`UPDATE OR REPLACE review_session SET repo_id = ?`).

Probe (throwaway test, `sqlitex.Open` with `_foreign_keys=1`, removed): an NFC session (pinned,
one file mark, one comment) and an NFD session for the same branch. After `normalizeStoredPaths`:
1 session, 0 files, 0 comments, `pinned=0`, no FK violations. The cascade does run (no orphans),
but the surviving row is always the renamed NFD one, whatever its age or pin. The doc comment
accepts losing one side; it predates `pinned` (P150) and does not consider that the NFC row is the
one the current build writes to, so it is the live one. A pinned session, which `Purge` and the
sweep deliberately keep, is lost on the next lazy open.

Fix: on collision delete the NFD row instead (`DELETE … WHERE repo_id = ? AND EXISTS (NFC row for
same branch)` before the rename), or keep the row with the newer `last_used_at` and OR the
`pinned` flags.

### F12 (low) `Decompress` reads the whole flate stream before checking the length

`apps/kira-space/internal/gitreview/snapshot.go` `Decompress` (`io.ReadAll(r)`).

`content_bytes` is capped at `MaxSnapshotBytes` (1 MiB) on write (`gitsession/incremental.go:313`)
but `Decompress` trusts nothing about the stream. A corrupt or tampered BLOB (flate expands up to
about 1032:1, so a 1 MiB row inflates to about 1 GiB) is fully allocated before the length check
rejects it, on every `review.fileDiff`/mark read of that path. Requires a damaged review.db, so
low.

Fix: `io.ReadAll(io.LimitReader(r, int64(want)+1))`, and reject `want > MaxSnapshotBytes`.

### F13 (low) Regex dialect diverges from JS for `\xHH`, `\u{…}`, `[\b]`, `[\S]`, so hit sets depend on what was loaded

`apps/kira-space/internal/gitsearch/dialect.go` `translateEscape` (`passthroughEscapeChars` has
no `x`; `\u{` branch in `translateUnicodeEscape`; `\S` in a class passed through; `\b` in a
class passed through).

The client matches loaded rows with JS `new RegExp(source, 'i'|'')` (no `u` flag,
`packages/git-core/src/search/query.ts:79`); the server matches the tail with this translation,
and `buildCommitHits` concatenates both (`doc.go:33-35` promises a hit never depends on which page
was loaded). Probed (Go `Compile` vs bun `RegExp`):
- `\x41` vs `"A"`: JS true, Go false (Go emits a literal `x41`; `"x41"`: JS false, Go true).
- `\u{41}` vs `"A"`: JS false (Annex B: `u` repeated 41 times; `\u{3}` matches `"uuu"`), Go true.
  `\u{1F600}` vs the emoji: JS false, Go true.
- `[\b]` (JS: backspace): Go returns `ErrInvalidPattern` ("invalid escape sequence: `\b`").
- `[\S]` vs NBSP: JS false, Go true (RE2's `\S` is ASCII-only; the out-of-class arm already
  rewrites it, the in-class arm does not).
The opt-in differential test (`KIRA_GIT_DIFFERENTIAL=1`, run here, green) misses these because its
subjects never contain the code points involved and `\x` is not in `diffAtoms`.

Fix: add `\xHH` (exactly two hex digits, else identity `x`) to the table; treat `\u{…}` as JS
non-`u` does (identity `u` then the brace text as a quantifier or literal); in a class map `\b`
to `\x{08}` and `\S` to a negated Unicode-whitespace set (or reject in-class `\S` as
unsupported). Add `\x41`, `\u{3}`, `[\b]`, `[\S]` rows to `searchConformance.json`
(`needs-other-part-file: packages/git-core/testdata/searchConformance.json (Part 18)`).

### F14 (low) `Scan`'s time box cannot fire while git emits nothing

`apps/kira-space/internal/gitsearch/scan.go:105`, `178`, `206-225`.

The deadline is tested only after a parsed record, every 1024 records. `readScanChunk` blocks in
`Read` with no deadline. `LogScanArgs` is a `--topo-order` walk: without a commit-graph, git
computes the whole walk before printing the first record, and any slow pack or cold cache does the
same. For that whole stall the scan holds one of the repository's four `Repo.Read` slots
(`gitsession/search.go:59`) and `Complete=false` never comes back after 5 s as `DefaultScanBudget`
promises; only a supersede or disconnect ends it.

Fix: run a `time.AfterFunc(budget, …)` that closes the process, and have `scanRound` map a read
error after that timer fired to the `Complete=false` result instead of an error.

### F15 (low) `Scan` reports a protocol error ahead of git's own failure

`apps/kira-space/internal/gitsearch/scan.go:122-129`.

On EOF with an unterminated field or record, `Scan` returns "unterminated trailing field/record"
after `Close`, never calling `Wait`, so git's exit status and stderr are discarded. Part 14 fixed
the same ordering in `logsession.finishEOFLocked` (`gitclient/logsession/session.go:261-282`:
"git's own failure (its stderr) outranks the partial record"). Scenario: git is killed (OOM,
signal) or dies mid-flush on a corrupt object after writing a partial buffer; search answers an
opaque framing error instead of the classified git failure the paging walk shows for the same
repo.

Fix: mirror `finishEOFLocked`: compute the protocol error, `Wait`, return `Classify`'s error if
any, else the protocol error.

## §9 candidate outcomes

- 1 (double `Close` panic): real but no concurrent caller today; reported as part of F10.
- 2 (reopen after `Close`, orphan reaper): reported F10.
- 3 (`Delete` notifies with zero rows): true (`store.go:389-394` ignores `RowsAffected`), but
  `ade.onReviewChange` (`ade/ghsync.go:214-245`) only queues an unmark when the path is in the
  GitHub-synced ledger, and the queued worker reconciles; a spurious notify costs one recompute.
  Observer runs under `Store.Lock` and does two kira.db reads: latency only. Dropped.
- 4 (`UPDATE OR REPLACE` cascade, pin): probed; cascade fires, no orphans; pin and live data lost
  on collision. Reported F11.
- 5 (`Decompress` unbounded): reported F12 (low; needs a corrupt DB).
- 6 (`SchemaTooNewError`): `ensureOpen` returns it unwrapped and not memoised; every review call
  fails with "database schema_version (N) is newer than this build knows about (M) — refusing to
  run against a downgraded app", which is clear, not opaque. Only a stale comment
  (`migrate.go:17-18` says `startupfail` classifies it; a lazy open never reaches startup). No
  failure. Dropped.
- 20 (`ProjectRanges` zero-length or deletion-only hunks): every caller's diff uses
  `--unified=3` (`porcelain/diff.go:17,35`, `review.go:40`), so a hunk with `OldLines == 0` only
  occurs for an empty old side (`@@ -0,0 +1,N @@`), which has no stored ranges to project.
  Insertions inside a file always carry context, so `mapWithinHunk` maps them through context
  lines; deleted lines drop (comment becomes `removed`); ranges past EOF are clamped. A `-U0`
  caller would break the pure-insertion arm (old line `OldStart` would get the hunk's offset);
  none exists. Dropped.
- 7 (`Scan` protocol-error paths skip `Wait`, mask stderr): `Close` kills and reaps
  (`gitclient/runner.go` `killAndWait`), so no zombie; masking is real. Reported F15.
- 8 (budget only between chunks): reported F14. The reader goroutine does not leak: `Close`
  closes stdout, `Read` returns, and the channel has buffer 1.
- 9 (tick after flush): reported F1 (mechanism differs: the late tick wins the last batch, so
  `flush` has nothing to wait on).
- 10 (nil `Env`, scrub gaps): every production caller passes `BuildEnv` output
  (`gitsession/worktree.go:503`, `ade/setup.go:327`, `deploy.go:38`, `runs.go:552`,
  `runs.go:494` to `adeagent`, which only falls back to `os.Environ()` on nil). Nil-env part
  dropped. Scrub gaps reported F3.
- 11 (doc stale): reported F4.
- 12 (dash-leading remote or stack-config values): remote names are rejected at `gitrpc`
  (`gitrpc/remote.go:73,99` `validRefArg`) for push/fetch/pushPreflight; autofetch takes remotes
  from `git remote` output (local config only, already code execution for whoever can write it).
  `RebaseOntoArgs` parent/branch are branch names; base is checked in block 3. Lead dropped for
  these; a different unguarded builder parameter (`Track`) is reported as F5.
- 13 (`git am` as rebase): `ClassifyInProgress` (`gitpreflight/operation.go:132-145`) maps
  `rebase-apply/applying` to rebase with every `Can*` false. `prepareSequencerVerb`
  (`gitsession/ops.go:965-984`) ignores the `Can*` flags and would still run `rebase --continue`
  for a client that skips the UI gate, but probed git 2.43 refuses all three verbs on an `am`
  session ("It looks like 'git am' is in progress. Cannot rebase.", exit 128, state untouched).
  No harm. Dropped.
- 14 (stash `-m` newline): probed, git collapses the newline into a space in the reflog
  (`stash list` shows `On main: line1 line2 x`). Parsing unaffected. Dropped.
- 15 (`hexToBytes` panic, mixed `shaWidth`): `porcelain.ParseLogRecord` does not validate the
  sha, but `%H`/`%P` are always hex from git, and the NUL framing cannot be shifted by commit
  text: probed a commit object whose message contains NULs (written with
  `hash-object --literally`); `git log --format=%s` truncates at the first NUL, and identity
  fields are C strings too, so no crafted record can put non-hex bytes in field 0 while keeping
  valid timestamps. A repository has one object format for all `log` output. Unreachable.
  Dropped.
- 17 (`checkedOutElsewhere` first only): the loop breaks after the first blocked branch; the
  verdict is still `blocked`, and a re-run reports the next one. UX only, no wrong outcome.
  Dropped.
- 18 (`ConfirmToken` trailing slash or `/`): `filepath.Base` strips trailing slashes; `/` is
  either the main worktree (blocked `mainWorktree`) or not a worktree (blocked `notAWorktree`); `prepareWorktreeRemove` re-derives the token
  from the same fresh preflight. Dropped.
- 19 (multi-sha revert verdict): by contract, prediction covers `Shas[0]` only and
  `PredictedFor` names it on the wire (`gitpreflight/revert.go`), so the client can say so;
  git's own sequencer stops at the conflicting sha and `isSequence` drives Abort. Dropped.

## Coverage

### Block 1 `gitprepare`

Reviewed: `runner.go`, `script.go`, `output.go`, `doc.go`; callers `gitsession/worktree.go`
`RunPrepare`, `ade/{setup,deploy,runs,logsink}.go`, `adeagent/process.go` `Run`;
`internal/procgroup` `GracefulCancel`. Checked and clean: argv built by composite literal (no
interpolation), stdin null, `Setsid`, group SIGKILL after timeout (F8 holds), `ErrWaitDelay` keeps
transcript (F7 holds), `cmd.Start` failure path, CSI/OSC stripping incl. unterminated sequences
and BEL/ST, invalid UTF-8, ticket ordering of write/tick/flush (aside from F1). `fish`/`nu`
accept `-l -c`; NUL in script fails `Start` with an error (surfaced). A panicking `onBatch` would
strand later tickets, but no production `onBatch` can panic (emit/append only); not reported.

### Block 2 `gitops`

Reviewed: all 16 files. Callers: `gitsession/ops.go` (`opTable`, `prepareSequencerVerb`,
`runWriteArgvList`, `validOpArg`, `prepareBranchCreate`, `prepareWorktreeRemove`,
`captureStashDropUndo`), `remote.go` (`runFetch`, `runPushFamily`, `RunRemote` protected gate),
`stack.go:813-860`, `gitrpc/remote.go` validation. Probes (git 2.43, isolated `HOME`): `am`
session verbs, stash message newline, checkout path-list stderr, `branch -t`. Checked and clean:
continue/abort/skip table per kind (bisect reset only, unmergedOnly refused), sequencer todo
verbs (git writes full `pick`/`revert` for cherry-pick/revert sequences; CRLF trimmed),
`gitDir` per-worktree reads, `ParsePushPorcelain` flags incl. delete (`:dst`) and tab-free refs,
`ExtractRemoteMessage`, `ProgressParser` CR/LF split and 64 KiB cap, `Throttle`, every
`validOpArg`-guarded builder parameter, `worktree remove` path (resolved against `worktree list`),
`-m` values (option arguments, never options), `PullConfigArgs`/`BranchConfigRegexpArgs`
`QuoteMeta` (F5 of P108 holds), auto-stash partial failure (`ops.go:1207`). No parser reads
coloured output (§7 colour item holds).

### Block 3 `gitpreflight`

Reviewed: all 12 files. Callers read: `gitsession/preflight.go` (checkout, revert parents,
`predictCherryPick`, `cherryPickCommitPaths`), `stack.go` (`RestackPreflight`,
`resolveBranchBase`, `runRestackPlan`, `dirtyPathStrings`), `ops.go` undo captures and
`UndoRun`, `status.go:77` cap. Probes: staged rename vs checkout (F7), stack budget (F9). Checked
and clean: in-progress precedence (rebase > merge > cherry-pick > revert > sequencer todo >
bisect > unmergedOnly), `am` gating (F3 of P108 holds), pull strategy precedence and boolean
synonyms (F6 of P108 holds), `ResolveRebaseMerges`, protected-branch glob (`**` literal),
`ClassifyPush`, reset destroys/typed confirmation, cherry-pick blockers, stash pop/branch,
worktree add/remove, `DetectCycleFrom`, cycle detection inside `resolveStackBase`, F9 of P108
(refless parent becomes orphan) holds, `UndoSlot.Take` id check (no race: one mutex). Root
commit cherry-pick prediction folds to `unknown` (merge-tree on missing `sha^1` exits 128).
A recorded `kirastackbase` that does not resolve as a commit falls back to merge-base, so a
dash-leading config value never reaches `RebaseOntoArgs` (lead 12 base half).

### Block 4 `gitreview` store

Reviewed: `db.go`, `migrate.go`, `migrations/{0001,0002,0003}.sql`, `migrations/embed.go`,
`store.go`, `reaper.go`, `snapshot.go`, `normalize.go`, `comments.go`, `export.go`. Callers:
`gitsession/registry.go:109,309` (`NewStore`, `Close`), `main.go:200-240` shutdown order,
`gitsock/server.go:300-355`, `ade/ghsync.go:205-245` (`SetObserver`, `onReviewChange`),
`gitsession/incremental.go:292-314,776` (size cap, `Put`); `internal/sqlitex` `Open`, `Migrate`,
`SchemaTooNewError`. Probe: NFC/NFD collision (F11). Checked and clean: migration order and
FK shape (`review_range` cascades from `review_file`, comments from session), `upsertSession`
read-back, `Put` atomicity (file + ranges in one tx, notify after commit), `Touch` never creates,
`SetPinned` creates by design, `sweepDB`/`Purge` skip pinned, `incremental_vacuum` only after
deletes, `keyedMutex` refcount (release via `sync.Once`), `RemoveComment` scoped by session
subquery (no cross-session delete), `ClearComments`, `SortAnchored` total order,
`FormatComments` (body is the user's own text; no app data injected). G32 round-3 #6 holds (paths
never NFC-rewritten).

### Block 5 `gitreview` logic

Reviewed: `ranges.go`, `project.go`, `resolve.go`. Blast radius read: `gitsession/incremental.go`
(`ProjectRanges` at 670, 735; line-count note at 406-412), `gitsession/comments.go:195-246`.
Checked and clean: `Normalize` drops inverted ranges and merges adjacent/overlapping, `Subtract`
splits and consumes correctly, `Expand(0)` is nil, `CountLines` normalizes first, projection
offset bookkeeping across multiple hunks, clamp with `newLineCount` 0. `resolve.go`: `findRef`
prefers a local branch over a remote one with the same short name (a local branch literally named
`origin/x`); git's own rev resolution prefers `refs/heads/` the same way, so the chosen base
names the same object git would use. Not a finding. Nothing real in this block.

### Block 6 `gitsearch`

Reviewed: `scan.go`, `query.go`, `dialect.go`, `literal.go`, `matcher.go`, `doc.go`; tests read:
`scan_test.go` helpers, `differential_test.go` setup. Caller `gitsession/search.go` (`searchGen`
supersede, `Repo.Read`). Probes: Go `Compile` vs bun `RegExp` (F13); differential test run with
`KIRA_GIT_DIFFERENTIAL=1` (500 x 4 x 200, green). Checked and clean: no user text reaches argv
(`Options.Args` is `LogScanArgs(spec)`, which ends with `--` after Part 14's `WalkArgs` change and
nothing is appended after it — §7 item 1 holds); lookaround and backreference rejection; whole-word
wrap incl. top-level alternation; sha-prefix arm (4-40 hex, lower-cased); literal fold path and
byte boundaries; `Total` exact past `Limit`; hits capped at 200; cancellation kills the child.
Test isolation: `scan_test.go` spawns git with the real `HOME` (reads `~/.gitconfig`, writes
nothing); `gitclient`'s `-c` overrides neutralise the config keys that could change parsed output,
and P154's `RunWithTempHomes` only isolates app homes, not `HOME`. Not a leak under P154.

### Block 7 `gitstore` and mirror

Reviewed: `store.go`, `intern.go`, `sha.go`, `pack.go`, `encode.go`; caller
`gitsession/walk.go:225-330` (`Append`, `PackSlice`, `marks` dictionary bases); mirror
`packages/git-ipc/src/graphChunkCodec.ts` (`toWire`/`fromWire`, `readDecorationRef`,
`copyColumn`) and `schema/gitwire.fbs` (Part 17, read). Probe: NUL in a commit message (lead 15).
Checked and clean: field set and order match the schema; uint32 columns written little-endian and
read through `Uint32Array` over a copied buffer (LE on every target); decoration kinds
`branch|remoteBranch|tag|head|stash` match both sides, stash index in `name`, `head` without
name; `refs` vector always present (schema `required`); `From`/`To` and chunk-relative rows;
dictionary deltas (`ValuesFrom(base)` plus `marks[to]`) stay cumulative and consistent with what
the client already holds; `Clear` resets the interner with the store; `clampTimestamp` clamps
negatives to 0; `estimateChunkSize` is only the builder's initial capacity (flatbuffers grows), so
an underestimate costs a copy, not correctness. No eviction is by design (a walk is bounded by
what the client pages in). Nothing real in this block.
