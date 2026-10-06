# P168 Part 15 findings: Space git preflight, ops, review, search, prepare, graph store, op log

Plan: `P168-part15-space-git-ops.md`. Reviewer: one Opus pass, report only.
Base commit (tree surveyed by plan): `73c7f40`. HEAD reviewed: `ce8e679` (plan commit only on top;
no Part 15 file changed). Worktree `p168-stream-b`.

## Checks

- `go vet` over the seven packages: clean.
- `go test -race -count=1` over the seven packages: 7 ok, `gitreview/migrations` no tests.

## Block status

- Block 1 `gitprepare`: done.

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

## §9 candidate outcomes

- 9 (tick after flush): reported F1 (mechanism differs: the late tick wins the last batch, so
  `flush` has nothing to wait on).
- 10 (nil `Env`, scrub gaps): every production caller passes `BuildEnv` output
  (`gitsession/worktree.go:503`, `ade/setup.go:327`, `deploy.go:38`, `runs.go:552`,
  `runs.go:494` to `adeagent`, which only falls back to `os.Environ()` on nil). Nil-env part
  dropped. Scrub gaps reported F3.
- 11 (doc stale): reported F4.

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
