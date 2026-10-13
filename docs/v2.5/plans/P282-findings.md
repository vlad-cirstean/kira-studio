# P282 code review round 2: findings

Base: `cbc60ea4a` (same as P281). Diff `git diff cbc60ea4a..HEAD` at tip `fc1c2c253`. Round-1 fixer
commits `7a8865da0..fc1c2c253` (P281 B1, C1, D1, A1, A2, E1) reviewed first as unreviewed code; round-1
findings (`git show ebed928c0:docs/v2.5/plans/P281-findings.md`) not re-reported.

Severity counts: blocker 0, major 0, minor 3.

## Areas

- P281 fixes: `ade/runs.go` `ResumeRun`; `shell/quit.go` `ShouldQuit` re-ask with `prompts/quitgate.go`;
  `memory/project.go` `localKey`/`ErrNotGitRepo` with `mcpserver/ingest.go` `projectOf` and
  `memorycli/run.go`; migration `0007`, `importer/db.go` `settleVerifyPending`, `claimExtracted`,
  `claimVerify`, `claimFinalize`, `saveVerdicts`, `retryFileTx`, `finishChunk`, `recoverInterrupted`;
  `scanned`/`docClaimsMore`/`autoStartTx`, `runner.go` `plan`/`materialiseNext`, `memdoc.go`
  `finalizeDoc` hash check; `docker` `imageRegistry`/`registryLink`/`ConfirmImageRegistry`,
  `docker-ui` `useRegistryLink`, `ContainerDetail.vue`, `ResourceDetail.vue`, `ImportJobDetail.vue`.
- Rest of diff, areas round 1 did not list: `dbmcp/server.go` per-revision tool rebuild,
  `claudeheadless` suffix/space/gittool prompt sources and `RequireClaude` check, `ade/rebaseprompt.go`,
  Space `runMessage.ts` preview vars, `filelock`, `config/lock.go`, `grpcclient/call.go` deadline check,
  `aderepoconfig.go` `ApplyFolderHidden` with `hidden_rev` (migration `0034`), `adetask.go`
  `RecoverRunning` single `UPDATE ... RETURNING`, memory ranking scope boosts (`rank.go`).

## Group A: memdoc header gate (`internal/memory/importer/db.go`)

### A1. Header gate ignores a header naming another project (minor, security)

`db.go:193-196` `docClaimsMore` holds a job only for a higher origin or `scope: company`. `ApplyDoc`
(`applydoc.go:93`) stores facts under the header's own scope and project. `rank.go:119-132` gives a
fact 1.15 in its own project, more than company's 1.05. `newFile` (`db.go:147`) carries no header
project, so the gate cannot see it.

Path: an agent calls `ingest_files` on a cloned folder with `origin: agent, scope: project, project:
github.com/acme/billing`. One file is a kira-memory doc with `scope: project, project:
github.com/acme/payments`. The job auto-starts. Its facts land as payments facts and rank first in every
payments session, a project the job never named. P281 A2's own rationale (an unattended job widening
where its facts show) covers this case too. A `scope: personal` header on a project job does the same
in a smaller step (1.00 against 0.85 in other projects).

Fix: carry `DocProject` in `newFile` (`runner.go:384`). In `docClaimsMore`, also hold the job when the
header scope differs from the job's (other than a narrowing to `project` of the job's own project) or
when a `project` header names a project other than the job's. Extend the reason text to say "claim a
higher origin or another scope or project".

## Group B: verify/finalize claim cost (`internal/memory/importer`)

### B1. `loadExtracted` still normalizes chunk text once per fact (minor, performance)

P281 A1's fix had two parts; only the stored count landed. `verify.go:73-80` adds `questionableIn`, but
its only caller is `Questionable` itself. `db.go:714` `loadExtracted` still calls
`Questionable(text, fact)` per fact, so each chunk's whole text is lower-cased and re-split once per fact.
`loadExtracted` runs inside the write transaction (`_txlock=immediate`) for every settle and every claim.

Path: a file of 10 chunks of about 10 KB, 40 facts each. Settle and finalize claim each normalize about
4 MB of text while holding the memory.db write lock. A verify claim adds the same again. `store_memory`
and UI writes wait meanwhile. The cost is per file, not per tick, hence minor.

Fix: in `loadExtracted`, compute `norm := normalizeQuote(text)` once per chunk row and call
`questionableIn(norm, fact)`.

## Group C: Docker registry button (`packages/docker-ui/src/queries.ts`)

### C1. "No registry page found" stays after a later successful click (minor, UI state)

`queries.ts:142-152` `open()` sets `missingFor` when the confirm returns no URL, and never clears it.
`imageregistry.go` never caches a Hub error, so a retry can succeed.

Path: under the containerd store, the user clicks the registry button for an implied Hub image while
offline. The confirm fails and the label shows. Back online, the user clicks again: Hub answers 200 and
the page opens. The detail view still shows "No registry page found" next to a button that works,
until the user opens another image.

Fix: set `missingFor.value = ''` at the start of `open()`.

## Nothing found

- `ResumeRun` (P281 B1): queue before clear is correct under the task mutex. A `launch` failure after
  `InsertRun` leaves a newer attempt, so the stale spec on the stuck run is refused by the
  latest-attempt check, the same as before the fix.
- Quit re-ask (P281 C1): `Router.Open` is a no-op for the same id; `RevealKind` reopens a window.
  A cancel landing between a repeat `ShouldQuit` and its `Ask` goroutine needs both within microseconds:
  not a realistic path.
- Project key (P281 D1): `localKey` escapes only whitespace, keeps existing keys stable, and stays
  under the SQL CHECK. `ErrNotGitRepo` fallback and explicit error for an unusable key are right. A
  literal `%20` vs space collision is not realistic.
- Migration `0007` and the `-1` sentinel: default `-1` on upgrade, recovery of `verifying`/`finalizing`
  rows, `finishChunk`, `retryFileTx`, memdoc `storeDoc`, paused jobs and interrupted verify all keep
  `verify_pending` right; `saveVerdicts` counts against the claim-time list and `verifyBatches` fills
  missing verdicts as ambiguous, so no file loops on verify.
- Memdoc gate bypasses: `finalizeDoc` and `verifyBatches` refuse a file whose hash changed;
  `autoStartTx` has one caller (scan end, rescan included); no MCP tool starts or retries a job. A file
  swapped after scan needs an active agent, which can already pass `origin: user` to `ingest_files` and
  `store_memory`, so it is not an escalation.
- `ImportJobDetail.vue` awaiting reason alert and Start; `ConfirmImageRegistry` bound and wired; Hub
  check only on click.
- `dbmcp` per-request revision check (one stat) and locked rebuild; `claudeheadless` prompt sources;
  `rebaseprompt.go`; `runMessage.ts`; `filelock`; `grpcclient` deadline check; `ApplyFolderHidden`
  revision guard; `RecoverRunning` resume-id `CASE`.
- Standing rules in fixer code: `<script setup lang="ts">`, Tailwind, TanStack Query/mutation for the
  confirm call, no new store, tests split at the IPC boundary (flow test plus contract-driven UI spec).
