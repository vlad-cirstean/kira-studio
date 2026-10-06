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
`DirtyWorktree`, so the UI offers the wrong remedy and the auto-stash offer for a dirty switch is
not shown.

Fix: drop lines that start with `\t` (git's path-list indent) before running the substring rows,
or match each row on lines starting with `error:`/`fatal:`/`!`/`hint:` only.

## §9 candidate outcomes

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
